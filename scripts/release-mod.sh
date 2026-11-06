#!/usr/bin/env bash
# The release bot (rules: docs/releasing.md). Releases one mod, the one named; no other mod's version or files move.
#
#   scripts/release-mod.sh <mod> [--bump patch|minor|major] [--dry-run]
#
# Version: the highest tag <mod>@X.Y.Z plus the bump; no tag → 0.0.1, whatever plugin.json says and whatever --bump.
# Notes: subjects of the commits touching plugins/<mod>/ since that tag (PR titles: main is squash-only).
# Writes plugin.json, CHANGELOG.md and the marketplace entry through a squash-merged bot PR, tags the merge commit,
# opens the GitHub Release, then rebuilds `release`. The branch is not named release/...: `release` itself exists,
# so git cannot create a ref under it.
# A dispatch that finds an earlier run stopped after its merge finishes that release instead of starting a new one.
# --dry-run prints the plan and writes nothing; it needs neither gh nor claude.
set -euo pipefail

fail() { echo "release-mod: $*" >&2; exit 1; }

mod=
bump='patch'
dry=false
while [ $# -gt 0 ]; do
  case "$1" in
    --bump) bump=${2:-}; shift ;;
    --dry-run) dry=true ;;
    -*) fail "unknown option $1" ;;
    *) [ -z "$mod" ] || fail "one mod per release"; mod=$1 ;;
  esac
  shift
done
[ -n "$mod" ] || fail "usage: release-mod.sh <mod> [--bump patch|minor|major] [--dry-run]"
[[ "$mod" =~ ^[a-z0-9][a-z0-9-]*$ ]] || fail "'$mod' is not a mod name"
case "$bump" in patch | minor | major) ;; *) fail "bump must be patch, minor or major, not '$bump'" ;; esac

cd "$(git rev-parse --show-toplevel)"
manifest=plugins/$mod/.claude-plugin/plugin.json
changelog=plugins/$mod/CHANGELOG.md
marketplace=.claude-plugin/marketplace.json
[ -d "plugins/$mod" ] || fail "no such mod: plugins/$mod/ does not exist"
[ -f "$manifest" ] || fail "$manifest does not exist"
[ "$(jq -r .name "$manifest")" = "$mod" ] || fail "$manifest does not name the mod $mod"

if [ "$dry" = false ]; then
  git fetch -q --tags origin main
  git fetch -q origin release 2>/dev/null || true
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || fail "a release runs from the tip of main"
fi

# Tags, the GitHub Release and `release` for a version whose bot PR is already merged. Each step skips itself when done.
publish() {
  local version=$1 tag_commit=$2 build_commit=$3 tag=$mod@$1
  if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    git tag -a "$tag" -m "$tag" "$tag_commit"
    git push -q origin "refs/tags/$tag"
  fi
  if ! gh release view "$tag" >/dev/null 2>&1; then
    git show "$tag_commit:$changelog" | awk -v h="## $version" '$0 == h { on = 1; next } /^## / { on = 0 } on' \
      | gh release create "$tag" --verify-tag --title "$tag" --notes-file -
  fi
  scripts/build-release.sh "$build_commit" --push
  echo "release-mod: released $tag"
}

# True when the tag's GitHub Release exists and `release` serves that version.
published() {
  local served
  served=$(git show "origin/release:$marketplace" 2>/dev/null | jq -r --arg mod "$mod" '.plugins[] | select(.name == $mod) | .version')
  [ "$served" = "$1" ] && gh release view "$mod@$1" >/dev/null 2>&1
}

last=$(git tag --list --sort=-v:refname "$mod@*" | grep -E "^$mod@[0-9]+\.[0-9]+\.[0-9]+$" | sed -n '1s/.*@//p' || true)
tag=${last:+$mod@$last}
range=${tag:+$tag..}HEAD

# A bot PR merged after the last tag: that run stopped before tagging.
stopped=$(git log --format='%H %s' "$range" -- "plugins/$mod" \
  | sed -nE "s/^([0-9a-f]+) chore\(release\): $mod@([0-9]+\.[0-9]+\.[0-9]+).*/\1 \2/p" | sed -n 1p)
if [ -n "$stopped" ]; then
  read -r stopped_commit stopped_version <<<"$stopped"
  if [ "$dry" = true ]; then
    echo "release-mod: $mod@$stopped_version is merged but not tagged; a real run finishes it"
    exit 0
  fi
  publish "$stopped_version" "$stopped_commit" HEAD
  exit 0
fi

if [ -n "$tag" ] && git diff --quiet "$tag" HEAD -- "plugins/$mod"; then
  if [ "$dry" = true ] || published "$last"; then
    echo "release-mod: nothing changed in plugins/$mod since $tag; nothing released"
    exit 0
  fi
  echo "release-mod: $tag is tagged but not fully published; finishing it"
  publish "$last" "$tag" HEAD
  exit 0
fi

if [ -z "$last" ]; then
  [ "$bump" = patch ] || echo "release-mod: first release of $mod is always 0.0.1; ignoring --bump $bump"
  next=0.0.1
else
  IFS=. read -r major minor patch <<<"$last"
  case "$bump" in
    patch) next=$major.$minor.$((patch + 1)) ;;
    minor) next=$major.$((minor + 1)).0 ;;
    major) next=$((major + 1)).0.0 ;;
  esac
fi
notes=$(git log --format='- %s' "$range" -- "plugins/$mod")

if [ "$dry" = true ]; then
  printf 'mod: %s\nlast version: %s\nnext version: %s\nnotes:\n%s\n' "$mod" "${last:-none}" "$next" "$notes"
  exit 0
fi

claude plugin validate --strict "plugins/$mod/" || fail "$mod does not pass claude plugin validate --strict"
claude plugin test "plugins/$mod/" || fail "$mod does not pass claude plugin test"

branch=bot/release-$mod-$next
title="chore(release): $mod@$next"
git switch -q -c "$branch"

new=$(jq --arg v "$next" '.version = $v' "$manifest")
printf '%s\n' "$new" >"$manifest"

new=$(jq --arg mod "$mod" --arg v "$next" --arg url "${GITHUB_REPOSITORY:-nokiy/claude-code-mods}" \
  --arg description "$(jq -r .description "$manifest")" '
  if any(.plugins[]; .name == $mod) then
    (.plugins[] | select(.name == $mod) | .version) = $v
  else
    .plugins += [{
      name: $mod,
      source: { source: "git-subdir", url: $url, path: ("plugins/" + $mod), ref: "release" },
      description: $description,
      version: $v
    }]
  end' "$marketplace")
printf '%s\n' "$new" >"$marketplace"

[ -f "$changelog" ] || printf '# %s\n\n' "$mod" >"$changelog"
new=$(sed '/^## /,$d' "$changelog"; printf '## %s\n\n%s\n\n' "$next" "$notes"; sed -n '/^## /,$p' "$changelog")
printf '%s\n' "$new" >"$changelog"

git add -- "$manifest" "$changelog" "$marketplace"
git commit -q -m "$title"
# The bot's PR gets no CI (GITHUB_TOKEN starts no run), so this is its gate, before anything leaves the runner.
scripts/build-release.sh HEAD --check

# A run that stopped before merging left this branch and its open PR; deleting the branch closes the PR.
if git ls-remote --exit-code --heads origin "$branch" >/dev/null; then
  git push -q origin --delete "$branch"
fi
git push -q origin "HEAD:refs/heads/$branch"
pr=$(gh pr create --base main --head "$branch" --title "$title" --body "$notes")

# Mergeability of a just-opened PR is computed asynchronously, so the first attempts may be refused.
merged=false
for attempt in 1 2 3 4 5 6; do
  if gh pr merge "$pr" --squash; then
    merged=true
    break
  fi
  echo "release-mod: merge attempt $attempt refused"
  sleep 5
done
[ "$merged" = true ] || fail "could not merge $pr; main is unchanged. Read the refusal above: the ruleset or the repo's Actions setting may block it"

commit=$(gh pr view "$pr" --json mergeCommit -q .mergeCommit.oid)
[ -n "$commit" ] || fail "$pr has no merge commit"
git fetch -q origin main
git push -q origin --delete "$branch" || echo "release-mod: could not delete $branch"
publish "$next" "$commit" "$commit"

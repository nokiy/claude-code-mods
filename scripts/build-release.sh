#!/usr/bin/env bash
# The release-packaging gate and builder (rules: docs/release-packaging.md). It makes the tree marketplace installs
# read: <rev>'s root files and marketplace.json, plus each mod marketplace.json lists, without any test file.
# Every mode first enforces both rules:
#   1. every marketplace.json entry installs from git-subdir plugins/<name> at ref `release`;
#   2. the stripped tree holds no test code (by name, or any file importing `claude-code/testing`) and every
#      mod in it passes `claude plugin validate --strict`.
#
#   scripts/build-release.sh [<rev>] --check   gate only, writes nothing   (CI on every PR · pre-push to main)
#   scripts/build-release.sh [<rev>]           also build the release commit locally and print it
#   scripts/build-release.sh [<rev>] --push    also push it to `release`   (scripts/release-mod.sh only)
#
# A build takes each listed mod's files from its own tag <mod>@<version>, the version in <rev>'s marketplace.json,
# so a mod changed on main but unreleased ships unchanged; a listed mod without that tag fails the build.
# --check takes them from <rev> instead: it gates what the next release of each mod would ship, a PR's change
# included, and needs no tags, so it runs in CI's shallow checkout.
# Stripped: plugins/*/tests/, every *.test.ts / *.test.tsx under plugins/, plugins/*/tsconfig.json,
# plugins/*/package.json (tags from before the release bot hold one). Unlisted mods are never added.
# Root files (scripts/, docs/) stay: installs copy only plugins/<mod>.
# The release commit's parents are the previous release tip and <rev>, so the branch only grows (never
# force-pushed); a tree equal to the current tip's makes no new commit. <rev> defaults to main.
set -euo pipefail

src=main
mode=build
for arg in "$@"; do
  case "$arg" in
    --push) mode=push ;;
    --check) mode=check ;;
    *) src=$arg ;;
  esac
done
src=$(git rev-parse --verify "$src^{commit}")
short=$(git rev-parse --short "$src")
fail() { echo "build-release: $*" >&2; exit 1; }

# Rule 1: installs read only the release branch.
bad=$(git show "$src:.claude-plugin/marketplace.json" | jq -r '.plugins[]
  | select((.source | type) != "object" or .source.source != "git-subdir" or .source.ref != "release"
      or .source.path != ("plugins/" + .name))
  | .name' 2>/dev/null | tr '\n' ' ') || fail "marketplace.json at $short is not readable JSON"
[ -z "$bad" ] || fail "marketplace.json at $short: these entries do not install from git-subdir plugins/<name> at ref release: $bad"

# Rule 2: the stripped tree is clean and every mod still loads.
index=$(mktemp)
out=$(mktemp -d)
trap 'rm -rf "$index" "$out"' EXIT
export GIT_INDEX_FILE=$index
git read-tree "$src"
git ls-files -- plugins | git update-index --force-remove --stdin
while read -r mod version; do
  from=$src
  if [ "$mode" != check ]; then
    from=$mod@$version
    git rev-parse -q --verify "refs/tags/$from^{commit}" >/dev/null || fail "no tag $from: $mod is listed at a version never released"
  fi
  git read-tree --prefix="plugins/$mod/" "$from:plugins/$mod" || fail "$from holds no plugins/$mod"
done < <(git show "$src:.claude-plugin/marketplace.json" | jq -r '.plugins[] | "\(.name) \(.version)"')
{ git ls-files -- plugins | grep -E '^plugins/[^/]+/(tests/|tsconfig\.json$|package\.json$)|\.test\.tsx?$' || true; } \
  | git update-index --force-remove --stdin
tree=$(git write-tree)
unset GIT_INDEX_FILE

git archive "$tree" | tar -x -C "$out"
# Independent of the strip patterns: any file that imports the test kit is test code, whatever its name.
left=$( { find "$out/plugins" -path '*/tests/*' -o -name '*.test.ts' -o -name '*.test.tsx' -o -name tsconfig.json;
          grep -rl "claude-code/testing" "$out/plugins" || true; } | sort -u | tr '\n' ' ')
[ -z "$left" ] || fail "test code left in the release tree: ${left//$out\//}"
for d in "$out"/plugins/*/; do
  claude plugin validate --strict "$d" >/dev/null || fail "$(basename "$d") does not validate without its tests"
done

if [ "$mode" = check ]; then
  echo "build-release: $short passes the release gate"
  exit 0
fi

git fetch -q origin release 2>/dev/null || true
tip=$(git rev-parse -q --verify "origin/release^{commit}" || true)
if [ -n "$tip" ] && [ "$(git rev-parse "$tip^{tree}")" = "$tree" ]; then
  echo "build-release: release already matches $short"
  exit 0
fi

commit=$(git commit-tree "$tree" ${tip:+-p "$tip"} -p "$src" -m "release: $short without tests")
echo "build-release: $(git rev-parse --short "$commit") from main $short"
if [ "$mode" = push ]; then
  git push -q origin "$commit:refs/heads/release"
fi

#!/usr/bin/env bash
# Builds the `release` branch from a main commit: the same tree without any test files, which is what
# marketplace installs read (each entry's source is `git-subdir` at ref `release`). Run by
# .github/workflows/release.yml on every push to main; runs locally too.
#
#   scripts/build-release.sh [<main sha>] [--push]
#
# Stripped: plugins/*/tests/, every *.test.ts / *.test.tsx under plugins/, and plugins/*/tsconfig.json (type-check
# tooling that points at types only a development load writes). Nothing else changes.
# The new commit's parents are the previous release tip and the main commit, so the branch only grows
# (never force-pushed). The stripped tree is checked with `claude plugin validate --strict` per mod
# before anything is written; a tree equal to the current tip's makes no new commit.
set -euo pipefail

src=main
push=false
for arg in "$@"; do
  case "$arg" in
    --push) push=true ;;
    *) src=$arg ;;
  esac
done
src=$(git rev-parse --verify "$src^{commit}")

index=$(mktemp)
out=$(mktemp -d)
trap 'rm -rf "$index" "$out"' EXIT
export GIT_INDEX_FILE=$index

git read-tree "$src"
git ls-files -- plugins | { grep -E '^plugins/[^/]+/(tests/|tsconfig\.json$)|\.test\.tsx?$' || true; } | git update-index --force-remove --stdin
tree=$(git write-tree)
unset GIT_INDEX_FILE

git archive "$tree" | tar -x -C "$out"
for d in "$out"/plugins/*/; do
  claude plugin validate --strict "$d" >/dev/null
done
if find "$out/plugins" -path '*/tests/*' -o -name '*.test.ts' -o -name '*.test.tsx' -o -name tsconfig.json | grep -q .; then
  echo "build-release: test files left in the tree" >&2
  exit 1
fi

git fetch -q origin release 2>/dev/null || true
tip=$(git rev-parse -q --verify origin/release^{commit} || true)
if [ -n "$tip" ] && [ "$(git rev-parse "$tip^{tree}")" = "$tree" ]; then
  echo "build-release: release already matches $(git rev-parse --short "$src")"
  exit 0
fi

commit=$(git commit-tree "$tree" ${tip:+-p "$tip"} -p "$src" -m "release: $(git rev-parse --short "$src") without tests")
echo "build-release: $(git rev-parse --short "$commit") from main $(git rev-parse --short "$src")"
if $push; then
  git push -q origin "$commit:refs/heads/release"
fi

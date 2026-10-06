#!/usr/bin/env bash
# Links scripts/hooks/pre-push into this clone's git hooks (idempotent). The release gate it runs is also enforced
# by CI, so a clone without it can still not publish test code; the hook only fails earlier.
set -euo pipefail
root=$(git rev-parse --show-toplevel)
hooks=$(git rev-parse --path-format=absolute --git-path hooks)
target="$hooks/pre-push"
if [ -e "$target" ] && [ "$(readlink "$target")" != "$root/scripts/hooks/pre-push" ]; then
  echo "install: $target exists and is not ours; leaving it alone" >&2
  exit 1
fi
ln -sf "$root/scripts/hooks/pre-push" "$target"
echo "install: pre-push → scripts/hooks/pre-push"

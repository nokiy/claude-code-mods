# Releasing a mod

How a mod in this marketplace goes from `dev` to an installable release.

## Version rule

- **Every release bumps only the last digit** of that mod's version: `0.0.1` → `0.0.2` → `0.0.3`. The first two digits change only when the owner asks for it.
- Each mod keeps its own version and its own tag; releasing one mod does not change another's version.
- A mod's `plugins/<mod>/.claude-plugin/plugin.json` `version` and its entry in `.claude-plugin/marketplace.json` are always equal.

## Branches

- `main` — released, with tests. It stays the default branch: `/plugin marketplace add` reads `marketplace.json` from it.
- `release` — built, never edited by hand: `main` without test files (`plugins/*/tests/`, `*.test.ts(x)`, `plugins/*/tsconfig.json`). `.github/workflows/release.yml` runs `scripts/build-release.sh` on every push to `main`; every marketplace entry's source is `git-subdir` at ref `release`, so installs get only the mod's code. The branch only grows (each build's parents are the previous tip and the `main` commit).
- `dev` — accepted, not yet released. Feature branches (`feature/<issue>-<slug>`) are cut from `dev` and merge back into it through a PR.

## Steps

1. **Bump**: on a branch from `dev`, raise the last digit in the mod's `plugin.json` and its `marketplace.json` entry. Several mods may be bumped for one release; each gets its own +1.
2. **Check locally**: `claude plugin validate .`, `claude plugin validate --strict plugins/<mod>`, `claude plugin test plugins/<mod>`.
3. **Merge into `dev`** through a PR; CI runs the same checks.
4. **Release PR**: open a PR from `dev` into `main`; CI runs again; merge it. The merge triggers the `release-branch` workflow; wait for it to pass (`gh run list --workflow release.yml`).
5. **Tag** the merge commit on `main`: `<mod>-vX.Y.Z` (for example `agent-monitor-v0.0.1`), one tag per released mod, and push the tags.
6. **Sync back**: merge `main` into `dev`, so both carry the release merge.
7. **Verify the install** in a throwaway config, never your own: `CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin marketplace add nokiy/claude-code-mods`, then `claude plugin install <mod>@nokiy-mods` with the same `CLAUDE_CONFIG_DIR`; it must install the new version, and the installed folder must hold no `tests/`, `*.test.*` or `tsconfig.json`.

Tickets close when their `Closes #n` reaches `main`.

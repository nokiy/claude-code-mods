# Releasing a mod

How a mod in this marketplace goes from a merged PR to an installable release. A bot (changesets, `.github/workflows/release.yml` job `version`) does the bumping, tagging and changelog.

## Public and unlisted mods

- **Public**: listed in `.claude-plugin/marketplace.json`, and a workspace in the root `package.json` (the two lists are equal; `scripts/sync-plugin-versions.mjs --check` and CI hold it). Only these are installable, versioned by the bot and shipped on `release`.
- **Unlisted**: in `plugins/` but not in `marketplace.json`. Developed and tested here like any mod (CI validates and tests every `plugins/*/`), loaded on the owner's machine through `CLAUDE_CODE_PLUGIN_DIRS`, readable in the public repo, but not installable through the marketplace and left out of `release`. Their `plugin.json` version stays put until they go public.
- **Making a mod public**: add `plugins/<mod>/package.json` (`name`, `version` equal to its `plugin.json`, `"private": true`), add it to the root `workspaces`, add its `marketplace.json` entry (`git-subdir` source at ref `release`, see `release-packaging.md`), run `npm install` to refresh the lock, and add a changeset for its first release.

## Version rule

- **Every release bumps only the last digit**: `0.0.1` → `0.0.2`. Changesets are always `patch`; `minor` / `major` only when the owner asks.
- Each public mod keeps its own version and its own tag, `<mod>@X.Y.Z` (for example `paste-peek@0.0.1`).
- `plugins/<mod>/package.json` owns the version; the bot copies it into `plugin.json`, the `marketplace.json` entry and `package-lock.json`.

## Branches

- `main` — the only working branch and the default (`/plugin marketplace add` reads `marketplace.json` from it). Every change is a branch from `main` and a squash-merged PR back into it.
- `release` — `main` without test code and without unlisted mods, built by CI, never written by hand; installs read only this branch (`release-packaging.md`).
- `changeset-release/main` — the bot's Version PR branch; never written by hand.

## Steps

1. **Changeset with the change**: a PR that changes a public mod carries `.changeset/<mod>-<what>.md` (format: `.changeset/README.md`). `npx changeset` writes one interactively.
2. **Merge the PR** into `main`. CI ran on it. The `version` job opens or refreshes the PR **chore: version plugins**, which bumps versions and writes `CHANGELOG.md`. The `build` job leaves `release` alone while changesets are pending.
3. **Release**: when ready, merge **chore: version plugins** (squash). The `version` job then tags each bumped mod `<mod>@X.Y.Z` and opens its GitHub Release; the `build` job rebuilds `release`. Check both: `gh run list --workflow release.yml`.
4. **Verify the install** in a throwaway config, never your own: `CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin marketplace add nokiy/claude-code-mods`, then `claude plugin install <mod>@nokiy-mods` with the same `CLAUDE_CONFIG_DIR`; it must install the new version, and the installed folder must hold none of the files `release-packaging.md` strips.

Several changes may wait in one Version PR; merging it releases them all. Tickets close when their `Closes #n` reaches `main`.

# Releasing a mod

How a mod in this marketplace goes from a merged PR to an installable release. Each mod is released on its own, on command, by a bot on GitHub (`.github/workflows/release.yml`, logic in `scripts/release-mod.sh`). Merging to `main` publishes nothing and leaves `release` as it is.

## The command

The owner says 「发 <mod>」; that is one command:

```
gh workflow run release.yml -f mod=<mod>
```

- `-f bump=minor` or `-f bump=major` only when the owner asks; the default raises the last digit.
- `-f dry-run=true` prints the mod, its last and next version and the notes, and writes nothing.

Watch it: `gh run watch $(gh run list --workflow release.yml -L 1 --json databaseId -q '.[0].databaseId')`.

The run fails when `plugins/<mod>/` does not exist, or when the mod does not pass `claude plugin validate --strict` or `claude plugin test`. A mod with nothing changed under `plugins/<mod>/` since its tag ends green, says so, and releases nothing. Releases run one at a time; a second dispatch waits for the first.

## Public and unlisted mods

- **Public**: listed in `.claude-plugin/marketplace.json`. Only these are installable and shipped on `release`.
- **Unlisted**: in `plugins/` but not in `marketplace.json`. Developed and tested here like any mod (CI validates and tests every `plugins/*/`), loaded on the owner's machine through `CLAUDE_CODE_PLUGIN_DIRS`, readable in the public repo, but not installable through the marketplace and left out of `release`.
- **Making a mod public**: release it. The bot knows every folder under `plugins/`, so a new mod needs no registering; its first release adds the `marketplace.json` entry from its `plugin.json`.

## Version rule

- The version source is the highest tag `<mod>@X.Y.Z`. Each mod has its own version and tags.
- A mod's first release is `0.0.1`, whatever `plugin.json` says; `bump` is ignored.
- Every later release adds one to the last digit: `0.0.1` → `0.0.2`. `minor` gives `0.1.0`, `major` gives `1.0.0`.

## Branches

- `main` — the only working branch and the default (`/plugin marketplace add` reads `marketplace.json` from it). Every change is a branch from `main` and a squash-merged PR back into it.
- `release` — what installs read: every public mod at its own tag, without test code; built by the bot, never written by hand (`release-packaging.md`).
- `bot/release-<mod>-<version>` — the bot's PR branch, deleted after the merge; never written by hand.

## What a release does

1. **Notes**: the subjects of the commits touching `plugins/<mod>/` since the last tag, all of its history on a first release. `main` is squash-only, so these are PR titles; write them for the changelog.
2. **Files**: writes the `plugin.json` version, prepends the notes to `plugins/<mod>/CHANGELOG.md` under the version heading, and writes the mod's `marketplace.json` version (adding the entry on a first release).
3. **Merge**: runs the release gate, opens the PR `chore(release): <mod>@<version>` from the bot branch and squash-merges it with `GITHUB_TOKEN`.
4. **Publish**: tags the merge commit `<mod>@<version>`, opens the GitHub Release with the notes, and rebuilds `release`, where only this mod moves.

If a run stops after step 3, dispatch the same mod again: it finishes that release instead of raising the version.

## After a release

**Verify the install** in a throwaway config, never your own: `CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin marketplace add nokiy/claude-code-mods`, then `claude plugin install <mod>@nokiy-mods` with the same `CLAUDE_CONFIG_DIR`; it must install the new version, and the installed folder must hold none of the files `release-packaging.md` strips.

Tickets close when their `Closes #n` reaches `main`, which is not when their mod is released.

## Testing the bot

`scripts/release-mod.sh <mod> --dry-run [--bump minor]` runs locally in any clone with the tags fetched, and needs neither `gh` nor `claude`.

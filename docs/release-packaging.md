# Release packaging

What a released mod contains, and the gates that hold it. The release steps themselves live in `releasing.md`.

## The rule

A release ships the public mods' code only (public = listed in `marketplace.json`; unlisted mods stay out of `release`, see `releasing.md`), each mod as it was at its own tag. No test code reaches an install:

- `plugins/*/tests/`
- every `*.test.ts` / `*.test.tsx` under `plugins/`
- `plugins/*/tsconfig.json` (type-check tooling; it points at types only a development load writes)
- `plugins/*/package.json` (tags from before the release bot hold one)
- any file that imports `claude-code/testing`, whatever its name

Tests stay where development needs them: `main` and its PR branches keep them, CI runs them, and this machine hot-loads the working tree with them (`CLAUDE_CODE_PLUGIN_DIRS`). Loading a mod with its tests beside it is harmless: the engine loads only the modules `hooks/hooks.json` names, so no test file ever runs in a session.

## How installs stay clean

| Branch | Holds | Written by |
| --- | --- | --- |
| `main` | all code **with** tests; `marketplace.json` is read from here | squash-merged PRs, the bot's release PRs included |
| `release` | every mod in `marketplace.json` from its own tag `<mod>@<version>`, **without** test code; `marketplace.json` and the other root files from the commit being released; no unlisted mods. One commit per release (parents: previous tip + that `main` commit; never force-pushed) | `scripts/release-mod.sh` through `.github/workflows/release.yml` only |

Every `marketplace.json` entry installs from `{ "source": "git-subdir", "url": "nokiy/claude-code-mods", "path": "plugins/<name>", "ref": "release" }`, so `/plugin install` copies the stripped folder.

A mod changed on `main` but not released ships unchanged: `release` holds its tagged files until it is released. The bot tags the mod being released before it builds; a listed mod without the tag of its `marketplace.json` version fails the build.

## Gates

One script, `scripts/build-release.sh`, holds both checks; every gate runs it, so they cannot drift:

1. every marketplace entry installs from `git-subdir plugins/<name>` at ref `release`;
2. the stripped tree (listed mods only) has no test code (by the list above) and every mod in it passes `claude plugin validate --strict`.

`--check` runs them on the listed mods as they are at the checked commit, which is what their next release would ship, and needs no tags. `--push` runs them on the tree it is about to publish, each mod from its tag.

| When | Gate | On failure |
| --- | --- | --- |
| every ready PR into `main` | `ci.yml` step *Release gate*: `build-release.sh HEAD --check` | the PR's check is red; do not merge |
| a local `git push` to `main` | `scripts/hooks/pre-push` runs the same `--check` | the push is refused |
| a local `git push` to `release` | `scripts/hooks/pre-push` | always refused: only the workflow writes `release` |
| a release, before its PR is pushed | `scripts/release-mod.sh` runs the same `--check` on the bot's commit (its PR gets no CI) | nothing leaves the runner; the run is red |
| a release, before `release` moves | `build-release.sh --push` runs the same checks on the tagged tree | nothing is pushed to `release`; the run is red; dispatch the mod again once fixed |

Install the local hook once per clone: `scripts/hooks/install.sh`. CI holds the same gates, so a clone without the hook still cannot publish test code; the hook only fails earlier. A push to any other branch is never checked: those branches carry tests by design.

## Adding a mod or a test layout

- The bot writes a new mod's `marketplace.json` entry with the `git-subdir` source above on its first release; the gate refuses anything else.
- A test file must import `claude-code/testing` (every `claude plugin test` file does), so even a new name or folder is caught. If a test helper does not import it, keep it under `plugins/<mod>/tests/`.

## Checking a release by hand

`docs/releasing.md`, *After a release*: install into a throwaway `CLAUDE_CONFIG_DIR` and confirm the installed folder holds none of the files listed above.

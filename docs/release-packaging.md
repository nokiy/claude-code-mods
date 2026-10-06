# Release packaging

What a released mod contains, and the gates that hold it. The release steps themselves live in `releasing.md`.

## The rule

A release ships a mod's code only. No test code reaches an install:

- `plugins/*/tests/`
- every `*.test.ts` / `*.test.tsx` under `plugins/`
- `plugins/*/tsconfig.json` (type-check tooling; it points at types only a development load writes)
- any file that imports `claude-code/testing`, whatever its name

Tests stay where development needs them: `dev`, feature branches and `main` keep them, CI runs them, and this machine hot-loads the working tree with them (`CLAUDE_CODE_PLUGIN_DIRS`). Loading a mod with its tests beside it is harmless: the engine loads only the modules `hooks/hooks.json` names, so no test file ever runs in a session.

## How installs stay clean

| Branch | Holds | Written by |
| --- | --- | --- |
| `main` | released code **with** tests; `marketplace.json` is read from here | release PRs from `dev` |
| `release` | `main` **without** test code, one commit per build (parents: previous tip + the `main` commit; never force-pushed) | `.github/workflows/release.yml` only |

Every `marketplace.json` entry installs from `{ "source": "git-subdir", "url": "nokiy/claude-code-mods", "path": "plugins/<name>", "ref": "release" }`, so `/plugin install` copies the stripped folder.

## Gates

One script, `scripts/build-release.sh`, holds both checks; every gate runs it, so they cannot drift:

1. every marketplace entry installs from `git-subdir plugins/<name>` at ref `release`;
2. the stripped tree has no test code (by the list above) and every mod in it passes `claude plugin validate --strict`.

| When | Gate | On failure |
| --- | --- | --- |
| every PR into `dev` or `main` (release PRs included) | `ci.yml` step *Release gate*: `build-release.sh HEAD --check` | the PR's check is red; do not merge |
| a local `git push` to `main` | `scripts/hooks/pre-push` runs the same `--check` | the push is refused |
| a local `git push` to `release` | `scripts/hooks/pre-push` | always refused: only the workflow writes `release` |
| every push to `main` | `release.yml` builds with the same checks before pushing `release` | nothing is pushed; the run is red |

Install the local hook once per clone: `scripts/hooks/install.sh`. CI holds the same gates, so a clone without the hook still cannot publish test code; the hook only fails earlier. A push to `dev` or a feature branch is never checked: those branches carry tests by design.

## Adding a mod or a test layout

- A new mod's `marketplace.json` entry uses the `git-subdir` source above from its first release; the gate refuses anything else.
- A test file must import `claude-code/testing` (every `claude plugin test` file does), so even a new name or folder is caught. If a test helper does not import it, keep it under `plugins/<mod>/tests/`.

## Checking a release by hand

`docs/releasing.md` step 7: install into a throwaway `CLAUDE_CONFIG_DIR` and confirm the installed folder holds none of the files listed above.

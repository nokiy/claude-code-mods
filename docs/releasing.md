# Releasing a mod

How a mod in this marketplace goes from `dev` to an installable release.

## Version rule

- **Every release bumps only the last digit** of that mod's version: `0.0.2` → `0.0.3`, `0.5.1` → `0.5.2`. The first two digits change only when the owner asks for it.
- Each mod keeps its own version and its own tag; releasing one mod does not change another's version.
- A mod's `plugins/<mod>/.claude-plugin/plugin.json` `version` and its entry in `.claude-plugin/marketplace.json` are always equal.

## Branches

- `main` — released. Marketplace installs read it, so it stays the default branch.
- `dev` — accepted, not yet released. Feature branches (`feature/<issue>-<slug>`) are cut from `dev` and merge back into it through a PR.

## Steps

1. **Bump**: on a branch from `dev`, raise the last digit in the mod's `plugin.json` and its `marketplace.json` entry. Several mods may be bumped for one release; each gets its own +1.
2. **Check locally**: `claude plugin validate .`, `claude plugin validate --strict plugins/<mod>`, `claude plugin test plugins/<mod>`.
3. **Merge into `dev`** through a PR; CI runs the same checks.
4. **Release PR**: open a PR from `dev` into `main`; CI runs again; merge it.
5. **Tag** the merge commit on `main`: `<mod>-vX.Y.Z` (for example `agent-monitor-v0.5.1`), one tag per released mod, and push the tags.
6. **Sync back**: merge `main` into `dev`, so both carry the release merge.
7. **Verify the install**: from a clean Claude Code config, `claude plugin marketplace add nokiy/claude-code-mods`, then `claude plugin install <mod>@nokiy-mods`; it must install the new version.

Tickets close when their `Closes #n` reaches `main`.

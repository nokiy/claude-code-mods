# .changeset

Pending changes of the public mods: the root `package.json` `workspaces`, equal to the `marketplace.json` entries. One file per change, named `{mod}-{what}.md`, in the same PR as the change:

```markdown
---
paste-peek: patch
---

What changed, in one or two sentences a user can read.
```

- The frontmatter key is the mod name from `plugins/<mod>/package.json`. Mark every change `patch` (the version rule: last digit +1); `minor` / `major` only when the owner asks.
- The body goes verbatim into the mod's `CHANGELOG.md` and its GitHub Release. Nobody edits `CHANGELOG.md` by hand.
- Unlisted mods (in `plugins/` but not in `marketplace.json`) take no changesets: they are not released.

Release flow → [docs/releasing.md](../docs/releasing.md)

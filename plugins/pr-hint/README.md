# pr-hint

Show the pull request of your current branch right on the prompt hint row, and hover it to see the spec, the integration branch and how far every ticket has come.

[中文说明](README.zh-CN.md)

> Requires Claude Code ≥ 2.1.287, the GitHub CLI (`gh`) authenticated for the repo, and a fullscreen terminal for the hover.

## What it does

When the branch your session is on has an **open** pull request, the hint row (the line with `bypass permissions on`, `accept edits on`, ...) gets a summary appended on the same row:

```
▸▸ bypass permissions on · PR #15 Add dark mode — settings page and editor · merged 2/4 · accepted 1/4
```

The mode phrase keeps its colour, the PR title takes all remaining width, and on narrow rows the counts drop first, then the title shrinks.

Hover the row and a band above the prompt opens:

```
╭──────────────────────────────────────────────────────────────────────────╮
│ PR #15 Add dark mode — settings page and editor                          │
│ Spec #12 Dark mode · integration branch dev ← spec/12-dark-mode          │
│ CI ✓3/3 · merged 2/4 · accepted 1/4                                      │
│ ● #14 in progress ✓1/3 R1 Theme toggle · feat/14-theme-toggle · 2 commits behind │
│ ● #16 not started no acceptance table Save settings                      │
│ ● #13 merged ✓0/2 Color names · feat/13-color-names                      │
│ ● #11 done ✓4/4 Dark palette                                             │
│ Open PR · updated 5 min ago                                              │
╰──────────────────────────────────────────────────────────────────────────╯
```

Top to bottom: the PR title, the Spec and the integration branch (`base ← head`), CI and the counts, one line per ticket (nothing is dropped), then the PR link and its update time. Tickets are ordered in progress, not started, merged, done.

With no PR, or a merged or closed one, the mod does nothing and the hint row and band stay as Claude Code draws them.

## Spec and tickets

The issues the PR closes (`Closes #N` in its body) are read. The one labelled `spec` is the **Spec**; it is shown on its own line and is left out of every count. The rest are **tickets**.

## How a ticket's status is derived

From the local git repository only (no `git fetch`, no model calls):

| Status | Rule |
| --- | --- |
| not started | no branch named `*/<N>-*` (or `<N>-*`) exists |
| in progress | some branch of the ticket is ahead of the PR head |
| merged | every branch of the ticket is merged into the PR head |
| done | the issue is closed, or its acceptance table (a table whose header has `State` and `Rounds`) is all ✓ |

`✓k/n` is the acceptance table's progress and `R<n>` its highest Rounds value. `merged a/b` counts merged and done tickets; `accepted c/d` counts done ones. `N commits behind` tells how many commits the ticket's branch has that the PR head does not.

## Refresh

On session start and after every turn (PR, tickets and git status), and every 60 s for the PR only. Data comes from `gh pr view`, `gh issue view`, `git branch -a` and `git rev-list --count`, run in the session's directory.

## Settings

Open **/config** and pick pr-hint.

| Setting | Default | Meaning |
| --- | --- | --- |
| Language | `auto` | `auto` follows Claude Code's language setting, then the locale; `en` or `zh` forces one. English is the default. |

## Install

In Claude Code (2.1.287 or later):

```
/plugin marketplace add nokiy/claude-code-mods
/plugin install pr-hint@nokiy-mods
```

The first command adds this repository as a plugin marketplace (once); the second installs the mod from it. Start a new session afterwards.

## License

MIT

# pr-hint

Show the pull request of your current branch right on the prompt hint row, with a card (hover the hint row to preview it, click to pin it open) showing the spec, the integration branch and how far every ticket has come.

[中文说明](README.zh-CN.md)

> Requires Claude Code ≥ 2.1.287 and the GitHub CLI (`gh`) authenticated for the repo.

## What it does

When the branch your session is on has an **open** pull request, the hint row (the line with `bypass permissions on`, `accept edits on`, ...) gets a summary appended on the same row:

```
▸▸ bypass permissions on · PR #15 Add dark mode — settings page and editor · merged 2/4 · accepted 1/4
```

The mode phrase keeps its colour, the PR title takes all remaining width, and on narrow rows the counts drop first, then the title shrinks.

Hover the hint row to preview a card above the prompt; it hides when the pointer leaves. Click the `▸` just before `PR #N` to pin it open (it turns into `▾`), click it again to unpin:

```
╭──────────────────────────────────────────────────────────────────────────╮
│ PR #15 Add dark mode — settings page and editor                        ↻ │
│ Spec #12 Dark mode · integration branch dev ← spec/12-dark-mode          │
│ CI ✓3/3 · merged 2/4 · accepted 1/4                                      │
│ ● #14 in progress Theme toggle · feat/14-theme-toggle · 2 commits behind │
│ ● #16 not started Save settings                                          │
│ ● #13 merged Color names · feat/13-color-names                           │
│ ● #11 accepted Dark palette                                              │
│ Open PR · updated 5 min ago · refreshed just now                         │
╰──────────────────────────────────────────────────────────────────────────╯
```

Top to bottom: the PR title, the Spec and the integration branch (`base ← head`; with no Spec, a single ticket takes the Spec's place as `Ticket #N · title`, several tickets show the branches alone), CI and the counts, one line per ticket (nothing is dropped), then the PR link, its update time on GitHub and when pr-hint last read it (`refreshed`). The `↻` button at the card's top right refreshes by hand (see Refresh). Tickets are ordered in progress, not started, merged, accepted. A `↻N` after CI counts checks still running.

The PR shown always belongs to the current directory: after a `cd`, a `/clear` or a repo switch the old PR is gone at the next redraw and the new directory's is read. With no PR, or a merged or closed one, the band and the hint row stay as Claude Code draws them, except when the `← N agents` pill is present: then the pill is removed and that frame's line is redrawn from the text (with a PR the pill is hidden to make room).

## Spec and tickets

The issues the PR closes (`Closes #N` in its body) are read. The one labelled `spec` is the **Spec**; it is shown on its own line and is left out of every count. The rest are **tickets**.

## How a ticket's status is derived

From the local git repository only (no `git fetch`, no model calls):

| Status | Rule |
| --- | --- |
| not started | no branch named `*/<N>-*` (or `<N>-*`) exists |
| in progress | some branch of the ticket is ahead of the PR head |
| merged | every branch of the ticket is merged into the PR head |
| accepted (green dot) | the issue is closed, or its acceptance table (a table whose header has `State` and `Rounds`) is all ✓ |

`merged a/b` counts merged and accepted tickets; `accepted c/d` counts accepted ones. `N commits behind` tells how many commits the ticket's branch has that the PR head does not.

## Refresh

Three tiers, each on its own timer, never overlapping (a tick that finds another refresh running is skipped) and redrawing only when something changed. Session start and the end of every turn run a full refresh (PR, tickets and git status); one asked for while another refresh is running waits for it instead of being dropped.

| Every | Reads | Recomputes ticket statuses when |
| --- | --- | --- |
| 20 s | `git for-each-ref` (local, no network) | the branches and their commits differ from the last look: local merges, new commits, deleted branches |
| 60 s | `gh pr view` | the PR's head commit or closing issues changed |
| 5 min | `gh issue view` for each closing issue | an issue closed or its acceptance table changed (a ticket turns accepted) |

**Manual refresh:** press `↻` on the card for a full refresh (it waits for a running one to finish; the button reads `refreshing…` meanwhile and ignores extra presses). When it ends a toast says what changed (`PR #23 updated: merged 0/1 → 1/1 · CI ✓1/1`), `PR #23 is up to date`, or `No open PR on this branch`, even if the card has been closed. The footer's `refreshed` time moves on full and 60 s fetches and on `↻`, not on the 20 s and 5 min local recomputes.

Git status uses `git branch -a` and `git rev-list --count`; everything runs in the session's directory.

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

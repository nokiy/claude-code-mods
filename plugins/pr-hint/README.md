# pr-hint

Show the pull request of your current branch right on the prompt hint row, with a card (hover the hint row to preview it, click to pin it open) showing how far the delivery has come (a progress bar, `Tickets d/n`, the Spec) and where every ticket stands.

[中文说明](README.zh-CN.md)

> Requires Claude Code ≥ 2.1.287 and the GitHub CLI (`gh`) authenticated for the repo.

## What it does

When the branch your session is on has an open pull request (or, with none open, a merged one), the hint row (the line with `bypass permissions on`, `accept edits on`, ...) gets the PR and its state appended on the same row:

```
▸▸ bypass permissions on · PR #15 Add dark mode — settings page and editor · Ready
```

The state is the PR's own, the same for a single-ticket and a multi-ticket delivery: `Draft` (yellow, being built) → `Ready` (magenta, waiting for acceptance) → `Merged` (green, done; shown only while the branch still sits on the commit that was merged, so a long-lived `dev` that moved on after a `dev → main` release shows nothing). The mode phrase keeps its colour, the PR title takes all remaining width, and on narrow rows the state drops first, then the title shrinks.

Hover the hint row to preview a card above the prompt; it hides when the pointer leaves. Click the ` ▸ ` just before `PR #N` (padded to three cells so it is easy to hit) to pin it open (it turns into `▾`), click it again to unpin:

```
╭──────────────────────────────────────────────────────────────────────────╮
│ PR #15 Add dark mode ████████░░░░░░░░ Tickets 2/4 · Spec #12  ↻ refresh  │
│ ◐ 1 running                                                              │
│ ● #14 running Theme toggle · feat/14-theme-toggle · 2 commits behind     │
│ ● #16 not started Save settings                                          │
│ ● #13 Merged Color names · feat/13-color-names                           │
│ ● #11 accepted Dark palette                                              │
│ Open PR · fetched 2 min ago                                              │
╰──────────────────────────────────────────────────────────────────────────╯
```

Top to bottom: a two-line header, one line per ticket (nothing is dropped), then the PR link and when pr-hint last fetched from GitHub (`fetched`, the only time shown). The header's first line is `PR #N`, the PR title as written (cut with `…` when it does not fit), a 20-cell progress bar (it shrinks toward 10 cells only on a narrow card), then right after it `Tickets d/n` (`d` counts the tickets that are Merged or accepted) and `Spec #N` when the PR has one; no PR state word and no percentage. The second line counts the tickets in flight: `◐ N running`. With [agent-monitor](../agent-monitor) also installed, it goes on with what this PR's subagents spent, `≈$1.25 · 86.2k tokens · 12m34s (subagents only)` (the main session is not counted; no `≈$` when no price is known), and `blocked ×N` when hooks refused their tool calls; without agent-monitor, or before it has seen a subagent of this PR, the line is `◐ N running` alone. The `↻ refresh` button at the card's top right refreshes by hand (see Refresh). Ticket status words are English in both languages: `not started`, `running`, `Merged`, `accepted`. Tickets are ordered running, not started, Merged, accepted. A leading `[mod]` scope tag on a ticket title (as in `[pr-hint] Edit form`) is left off the card.

The PR shown always belongs to where the session is: the **repository root plus the branch**. A `cd` into a subfolder of the same repository changes nothing; a `cd` to another repository, a `git checkout` of another branch, or a `/clear` elsewhere hides the old PR at once and reads the new place's (see Refresh). Only a PR whose head branch lives in this repository counts; a fork's PR of the same branch name is ignored. With no PR, or only a closed one, the band and the hint row stay as Claude Code draws them, except when the `← N agents` pill is present: then the pill is removed and that frame's line is redrawn from the text (with a PR the pill is hidden to make room).

## Spec and tickets

The issues the PR closes (the ones GitHub links to it, else the `Closes #N` lines of its body) are read. The one labelled `spec` is the **Spec**; its number ends the card's first line, and it is not a ticket. The rest are **tickets**.

## How a ticket's status is derived

From the local git branches plus the PR's commit headlines (no `git fetch`, no model calls), first match wins:

| Status | Rule |
| --- | --- |
| accepted (green dot) | the issue is closed, or its acceptance table (a table whose header has `State` and `Rounds`) is all ✓ |
| running | a ticket branch (`*/<N>-*` or `<N>-*`) is the PR head, or is ahead of it |
| Merged | a PR commit headline names the ticket: `<type>(#N): …`, `<type>(<scope>): … (#N)` (what a fast-forward merge leaves), `<type>（<scope>）：… #N` (the number ends the headline), or a `Merge …` headline naming a `/N-` branch. A branch that is merged alone does not count, and neither does a passing mention such as `chore: absorb #N` |
| not started | none of the above |

A ticket's status colours its own line on the card only; nothing is counted on the hint row. `N commits behind` tells how many commits the ticket's branch has that the PR head does not.

## Refresh

Two tiers, each on its own timer, never overlapping (a tick that finds another refresh running is skipped). The 20 s tier redraws only when the refs it reads changed; every gh fetch redraws, because its `fetched` time moves. Session start and the end of every turn run a full refresh (PR, tickets and git status); one asked for while a full refresh is already running waits for that one and shares its answer instead of starting another.

| Every | Reads | Recomputes ticket statuses when |
| --- | --- | --- |
| 20 s | local git only, no network: the repository root, the checked-out branch and `git for-each-ref` | the branches and their commits differ from the last look: local merges, new commits, deleted branches. When the root or branch differs from where the last fetch ran (a PR found or not), it triggers a full refresh, so a `git checkout` onto a branch that has a PR shows it within 20 s, not 5 min |
| 5 min | one `gh api graphql` request: the PR (resolved by `gh` from the session directory's repository and current branch), its CI and commits, and every closing issue | always (a full refresh) |

Only a PR into a non-default branch, which GitHub links to no issue, costs a second request: its `Closes #N` issues by number. Need fresher data sooner? Press the button, or end a turn.

A failed fetch (gh exits non-zero, times out, answers something unreadable or with GraphQL errors) is not "no PR": the PR already shown stays, with its old `fetched` time. Only a successful answer with no open PR, and no merged PR the branch still sits on, clears it.

**Manual refresh:** press ` ↻ refresh ` on the card for a full refresh (it joins a running one; the button reads `refreshing…` meanwhile and ignores extra presses). When it ends a toast says what changed (`PR #23 updated: Draft → Ready · CI ✓1/1`), `PR #23 is up to date`, `No PR on this branch`, or `Fetch failed, try again later`, even if the card has been closed. The footer's `fetched` time is the last successful answer from GitHub; the 20 s git recompute does not move it.

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

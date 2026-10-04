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

Hover the hint row to preview a card above the prompt; it hides when the pointer leaves. Click the ` ▸ ` just before `PR #N` (padded to three cells so it is easy to hit) to pin it open (it turns into `▾`), click it again to unpin:

```
╭──────────────────────────────────────────────────────────────────────────╮
│ PR #15 Add dark mode — settings page and editor                ↻ refresh │
│ Spec #12 Dark mode · integration branch dev ← spec/12-dark-mode          │
│ CI ✓3/3 · merged 2/4 · accepted 1/4                                      │
│ ● #14 in progress Theme toggle · feat/14-theme-toggle · 2 commits behind │
│ ● #16 not started Save settings                                          │
│ ● #13 merged Color names · feat/13-color-names                           │
│ ● #11 accepted Dark palette                                              │
│ Open PR · fetched 2 min ago                                              │
╰──────────────────────────────────────────────────────────────────────────╯
```

Top to bottom: the PR title, the Spec and the integration branch (`base ← head`; with no Spec, a single ticket takes the Spec's place as `Ticket #N · title`, several tickets show the branches alone), CI and the counts, one line per ticket (nothing is dropped), then the PR link and when pr-hint last fetched from GitHub (`fetched`, the only time shown). The `↻ refresh` button at the card's top right refreshes by hand (see Refresh). Tickets are ordered in progress, not started, merged, accepted. A leading `[mod]` scope tag on a ticket title (as in `[pr-hint] Edit form`) is left off the card. A `↻N` after CI counts checks still running.

The PR shown always belongs to where the session is: the **repository root plus the branch**. A `cd` into a subfolder of the same repository changes nothing; a `cd` to another repository, a `git checkout` of another branch, or a `/clear` elsewhere hides the old PR at once and reads the new place's (see Refresh). Only a PR whose head branch lives in this repository counts; a fork's PR of the same branch name is ignored. With no PR, or a merged or closed one, the band and the hint row stay as Claude Code draws them, except when the `← N agents` pill is present: then the pill is removed and that frame's line is redrawn from the text (with a PR the pill is hidden to make room).

## Spec and tickets

The issues the PR closes (the ones GitHub links to it, else the `Closes #N` lines of its body) are read. The one labelled `spec` is the **Spec**; it is shown on its own line and is left out of every count. The rest are **tickets**.

## How a ticket's status is derived

From the local git branches plus the PR's commit headlines (no `git fetch`, no model calls), first match wins:

| Status | Rule |
| --- | --- |
| accepted (green dot) | the issue is closed, or its acceptance table (a table whose header has `State` and `Rounds`) is all ✓ |
| in progress | a ticket branch (`*/<N>-*` or `<N>-*`) is the PR head, or is ahead of it |
| merged | a PR commit headline names the ticket: `<type>(#N): …`, `<type>（<scope>）：… #N` (the number ends the headline), or a `Merge …` headline naming a `/N-` branch. A branch that is merged alone does not count, and neither does a passing mention such as `chore: absorb #N` |
| not started | none of the above |

`merged a/b` counts merged and accepted tickets; `accepted c/d` counts accepted ones. `N commits behind` tells how many commits the ticket's branch has that the PR head does not.

## Refresh

Two tiers, each on its own timer, never overlapping (a tick that finds another refresh running is skipped). The 20 s tier redraws only when the refs it reads changed; every gh fetch redraws, because its `fetched` time moves. Session start and the end of every turn run a full refresh (PR, tickets and git status); one asked for while a full refresh is already running waits for that one and shares its answer instead of starting another.

| Every | Reads | Recomputes ticket statuses when |
| --- | --- | --- |
| 20 s | local git only, no network: the repository root, the checked-out branch and `git for-each-ref` | the branches and their commits differ from the last look: local merges, new commits, deleted branches. When the root or branch differs from where the last fetch ran (a PR found or not), it triggers a full refresh, so a `git checkout` onto a branch that has a PR shows it within 20 s, not 5 min |
| 5 min | one `gh api graphql` request: the PR (resolved by `gh` from the session directory's repository and current branch), its CI and commits, and every closing issue | always (a full refresh) |

Only a PR into a non-default branch, which GitHub links to no issue, costs a second request: its `Closes #N` issues by number. Need fresher data sooner? Press the button, or end a turn.

A failed fetch (gh exits non-zero, times out, answers something unreadable or with GraphQL errors) is not "no PR": the PR already shown stays, with its old `fetched` time. Only a successful answer with no open PR clears it.

**Manual refresh:** press ` ↻ refresh ` on the card for a full refresh (it joins a running one; the button reads `refreshing…` meanwhile and ignores extra presses). When it ends a toast says what changed (`PR #23 updated: merged 0/1 → 1/1 · CI ✓1/1`), `PR #23 is up to date`, `No open PR on this branch`, or `Fetch failed, try again later`, even if the card has been closed. The footer's `fetched` time is the last successful answer from GitHub; the 20 s git recompute does not move it.

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

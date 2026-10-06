# agent-monitor

See what your Claude Code subagents are doing: a live band above the prompt while they run, and a `/sub` panel with this project's subagent history, alerts, a detail page per agent and a cost estimate.

[中文说明](README.zh-CN.md)

> Requires Claude Code ≥ 2.1.287.

## What it does

- **Live band** — one row per running subagent above the prompt: type, model and effort, task, current activity, tokens, elapsed time, alert glyphs.
- **`/sub` history** — a table of every subagent of this project, earlier sessions included: it is read from the transcripts Claude Code keeps under `~/.claude/projects/`, so it survives `/clear` and a new session (newest first): `#`, status, type, tier (model.effort), task, edits, rounds, tokens, time, alerts. Running agents carry their current activity on a second line. Pick a row with ↑/↓.
- **PR mode and Agent mode** — `/sub` opens in PR mode: one group per PR, with agent count, tokens, cost, time and the PR state (Open / Merged), the current branch's PR on top and open; Enter on a group opens or closes it. Agents that belong to no PR land in a dimmed `Other` group. An agent belongs to a PR by the branch it started on (the first line of its transcript): a ticket branch `<prefix>/<N>-<slug>` goes to the PR whose body says `Closes #N`, a PR's own head branch (a `spec/` integration branch) to that PR; `dev`, `main` and other branches to `Other`. The PR list comes from `gh pr list` (recent open and merged PRs, refreshed every 5 minutes; a failed fetch keeps the last list), so PR mode needs the GitHub CLI signed in. `[PR] [Agent]` in the header, or `p` / `a`, switches; Agent mode is the flat list.
- **Per-PR totals for other mods** — for every PR with subagents it publishes their tokens, estimated cost, wall time (agents that ran at once count once) and hook refusals (from their transcripts); the main session is never counted. [pr-hint](../pr-hint) shows them on its PR card. agent-monitor reads nothing from other mods and works the same without them.
- **Detail page** — Enter on a row opens it: instruction, timeline, tokens (cache hit / miss / output) with an **estimated cost**, edited files with `+/−` line counts, tool counts, skills, recent actions, alerts and the result. `b` goes back.
- **Alerts** — shown as glyphs in the table and as sentences above it:
  - `!` **file conflict** — two agents (or an agent and the main loop) edited the same file while both were running.
  - `~` **stall** — a running agent has had no step or tool call for the threshold (amber at the threshold, red at twice it); the toast fires once per agent.
  - `≠` **tier mismatch** — the model or effort an agent actually ran differs from its description prefix (see below).
  - `×N` **denied calls** — N tool calls were refused by a hook or errored, with the reasons.
- **Placement** — `/sub` opens the panel; `/sub top` keeps it in a band above the prompt, `/sub right` docks it as a side pane (remembered across sessions); `/sub set` opens the in-panel settings page.

## Commands

| Command | Does |
| --- | --- |
| `/sub` | Show the panel (again: close it) |
| `/sub top` · `/sub right` | Put the panel above the prompt / in the side pane |
| `/sub set` | Open the settings page (toggle columns, switches, placement, stall threshold; `w` saves) |

If the host refuses `/sub`, the mod registers `/subs` instead.

## The tier prefix (optional)

The **Tier** column shows `model.effort` (for example `sonnet.med`) from what the agent really ran. If you start a subagent with a description of the form `<model>.<effort> · task` — model `so`, `op`, `ha` or `fa`; effort `low`, `med` or `high`, e.g. `so.med · fix the login form` — the mod also reads that prefix as the tier you *asked for*, and raises the `≠` alert when the agent ran a different model or effort. **Without a prefix nothing is compared and the tier alert never fires.**

## Settings

Open **/config** and pick agent-monitor, or use `/sub set` for the panel options.

| Setting | Default | Meaning |
| --- | --- | --- |
| Language | `auto` | `auto` follows Claude Code's language setting, then the locale; `en` or `zh` forces one. English is the default. |
| Scope | empty | Only run in this directory (an absolute path, e.g. `/home/me/work`) and below; empty = everywhere. |
| Stall threshold | 3 min | Idle time before a running agent is flagged. |
| Live rows above the prompt | on | One row per running subagent. |
| Alerts block / Toasts | on | Alert sentences above the table; a toast the first time a conflict or stall is seen. |
| Default `/sub` placement | `last` | `last`, `right` or `top`. |
| Columns | all on | Tier, Edits, Rounds, Tokens, Time, Alerts. |
| Model prices | API list prices | Compact JSON, USD per million tokens: `{"sonnet":[input,cacheWrite5m,cacheRead,output],...}`. A family left out keeps its default; bad JSON falls back to the defaults. |

Costs are **estimates** from token counts and list prices (no batch, fast-mode or regional modifiers); an unpriced model shows a dash.

## Install

In Claude Code (2.1.287 or later):

```
/plugin marketplace add nokiy/claude-code-mods
/plugin install agent-monitor@nokiy-mods
```

The first command adds this repository as a plugin marketplace (once); the second installs the mod from it. Start a new session afterwards.

## License

MIT

# 0001 · Cross-mod state: agent-monitor publishes, pr-hint reads

Status: accepted · Spec #36 · Ticket #40 (contract) · Ticket #45 (written and drawn)

## Context

The pr-hint card is to show what a PR's subagents spent (tokens, cost, time, hook refusals). agent-monitor already sees every subagent; pr-hint knows which PR is open. Each mod must keep installing, validating and testing on its own.

## Decision

agent-monitor owns one published value in `$.state`; pr-hint reads it with a literal reference and never writes it.

- **Key:** `PluginState['agent-monitor'].prStats`.
- **Type:** `Record<string, PrStat>`, keyed by the PR number as a string (`$.state` holds JSON, so object keys are strings).
- **Fields:** `PrStat = { tokens: number; cost?: number; ms: number; refusals: number }`, all over the PR's subagents (the main session is not counted). `tokens`, `cost` and `ms` are the same figures agent-monitor's PR-mode group row shows; `refusals` is on the card only:
  - `tokens`: every model step's usage (input, output, cache read, cache write) added up over the agents; an agent whose split is unknown counts its own total.
  - `cost`: estimated USD at agent-monitor's price table; absent when no agent's model has a price (unknown, never `0`).
  - `ms`: wall time, the length of the union of the agents' spans (start to start + elapsed), so agents that ran at once count once. Not the panel header's Σ of elapsed times.
  - `refusals`: hook refusals, the tool calls a hook refused: a hook's deny seen live for an agent agent-monitor watched, else the agent's transcript lines carrying `toolDenialKind`. Errored tool results (a failed Bash run) do not count; agent-monitor's alert `×N` counts those too, from its own input.
- **Which PRs:** a PR gets an entry once at least one subagent is attributed to it (`hooks/attribution.ts`: the first `#N` of the agent's description, a PR number or a ticket a PR closes, else the branch on its transcript's first line; a release PR from `dev`/`main` never owns an agent); agents of no PR (Other) are never published. agent-monitor computes it in `hooks/groups.ts` (`statsByPr`) and writes it from `register.tsx` after a transcript scan, after each PR-index refresh and on the 1 s tick while an agent runs, only when the value changed (each write redraws the readers), never while drawing.
- **Owner:** agent-monitor alone writes it (the engine refuses a write from any other plugin). Its contract `plugins/agent-monitor/types/index.d.ts` holds the canonical `PrStat`.
- **Reader:** pr-hint, in its AbovePrompt hook (`plugins/pr-hint/hooks/register.tsx`): `$.state.get({ plugin: 'agent-monitor', key: 'prStats' } as const)`, and it hands this PR's entry to `cardLines` as `extra.stats`, which appends ` · ≈$ · tokens · time (subagents only)` and ` · blocked ×N` (N > 0) to header line 2. The read happens while the card draws, so a later write by agent-monitor redraws the card.
- **One-way dependency:** pr-hint lists no `dependencies` in `plugin.json`, so installing pr-hint never pulls agent-monitor in. To type-check the read anyway, pr-hint's own contract mirrors the one key (`'agent-monitor': { prStats: Record<string, PrStat> }`). A mirror is valid only while agent-monitor's contract is not laid beside pr-hint's. If pr-hint ever adds a `dependencies` entry, delete the mirror: two declarations of the `'agent-monitor'` property would no longer merge (TS2717). Change `PrStat` in agent-monitor first, then copy it to the mirror.
- **Absent value:** with agent-monitor not installed, or installed but not yet written for this PR, the read gives `undefined`, and pr-hint draws the card exactly as it does without the value (line 2 is `◐ N running` alone). There is no placeholder, zero or error. agent-monitor publishes only PRs it has data for, so a missing entry means "unknown", never "zero".

## Evidence (spike, Claude Code 2.1.291)

- `claude plugin validate --strict plugins/pr-hint` passes with the literal read and no agent-monitor dependency. It lists the read and states it does not check it: `state of other plugins, not checked (run validate in a session with them enabled): agent-monitor.prStats`.
- The same validate and `claude plugin test plugins/pr-hint` stay green with an empty `CLAUDE_CONFIG_DIR` and no `CLAUDE_CODE_PLUGIN_DIRS`: only pr-hint, no agent-monitor, no login, which is the CI case.
- `tsc` over pr-hint with only its own laid types (no agent-monitor contract) fails on the read without the mirror (`'"agent-monitor"' is not assignable to type '"pr-hint"'`) and passes with it.
- pr-hint tests answer the read by hooking `state.get` (`injectPrStats` in `plugins/pr-hint/tests/testkit.ts`). A test cannot `set` another plugin's value.

## Consequences

- agent-monitor writes `prStats` from its own events. pr-hint never asks agent-monitor for anything.
- A shape change is a contract change: update agent-monitor's `PrStat`, pr-hint's mirror and this ADR together.
- Change both together: pr-hint's `plugins/pr-hint/hooks/card.ts` copies agent-monitor's number formats so the card reads like the panel: `tokenText` = `formatTokens` (`hooks/logic.ts`, `86.2k`), `timeText` = `formatDuration` (`hooks/logic.ts`, `12m34s`), `moneyText` = `formatMoney` (`hooks/cost.ts`, `$1.25`, `<$0.01`). agent-monitor's PR-mode group row copies pr-hint's PR state, so the same PR reads alike in both: pr-hint's `prState` (`plugins/pr-hint/hooks/parse.ts`: MERGED → merged, else `isDraft` ? draft : ready), words `PR_STATE` (`hooks/strings.ts`: Draft, Ready, Merged) and colors `STATE_COLOR` (`hooks/card.ts`: yellow, magenta, green) = agent-monitor's `prState` (`plugins/agent-monitor/hooks/prindex.ts`), `prState` words (`hooks/strings.ts`) and `STATE_COLOR` (`hooks/prtable.tsx`).
- A third mod may read `prStats` the same way, under the same absent-value rule.

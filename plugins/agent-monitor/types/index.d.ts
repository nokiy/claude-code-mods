// Session state contract of agent-monitor: one record per subagent, the panel's page and focus, the settings draft, the session's
// placement override, the main loop's recent edits and the per-PR totals published to other mods (`prStats`), kept in `$.state` so a
// hot reload keeps them.

/** One distinct denied / errored tool result, deduped by its first line. */
export type Denial = { text: string; n: number }

/** A file the main loop (no agentId) edited; kept only while some subagent was running. */
export type MainEdit = { path: string; at: number }

/** The settings page's unsaved copy of the options: a column per flag, the other switches, the placement mode, the stall threshold in minutes. */
export type AgentMonitorDraft = {
  tier: boolean
  tokens: boolean
  time: boolean
  alerts: boolean
  alertsBlock: boolean
  autoBand: boolean
  toasts: boolean
  placement: 'last' | 'right' | 'top'
  stallMinutes: number
}

/** Tokens an agent spent, summed over its model requests (or the Agent result's own totals). */
export type AgentSpent = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type AgentMonitorRec = {
  /** Agent definition (`Explore`, `worker`, ...); a record with no type and no desc is never shown. */
  type: string
  /** Spawn description as the model wrote it (may carry a `so.med · ` prefix). */
  desc: string
  /** Task text: description minus the prefix, whitespace collapsed. */
  task: string
  /** The spawn prompt, cut to 300 characters. */
  prompt?: string
  /** Model id or alias of the latest step (or the spawn). */
  model?: string
  /** Effort of the latest step. */
  effort?: string | number
  /** Model id of the latest turn.step only: what the tier check compares the description prefix with. */
  actualModel?: string
  /** Effort of the latest turn.step only. */
  actualEffort?: string | number
  /** Model rounds (turn.step count). Meaningful only when `watched`. */
  steps: number
  /** True when agent.spawn was seen: the step count is complete. */
  watched: boolean
  /** Latest step's input + cache tokens. */
  context: number
  /** Latest step's output tokens. */
  output: number
  /** Authoritative total from the Agent tool result. */
  tokens?: number
  /** Input / output / cache read / cache write over the agent's steps. */
  spent?: AgentSpent
  /** The same usage split by the model id of the step that spent it (what the cost estimate prices). */
  byModel?: Record<string, AgentSpent>
  startedAt?: number
  finishedAt?: number
  durationMs?: number
  /** Start of the turn.step in flight (cleared when it ends). */
  stepAt?: number
  /** Longest finished turn.step, in ms. */
  longestStepMs?: number
  status: 'running' | 'done' | 'failed' | 'unknown'
  /** Chinese activity text of the latest tool call. */
  activity?: string
  /** The latest ten activity texts, oldest first. */
  recent?: string[]
  /** Absolute paths this agent's Edit/Write/MultiEdit/NotebookEdit calls named (deduped, at most 50). */
  files?: string[]
  /** Lines added / removed per edited path, from the tool results that carried a patch (at most 50 paths). */
  lines?: Record<string, { add: number; del: number }>
  /** Names of the skills the agent called (at most 20). */
  skills?: string[]
  /** Edited-file count from the Agent result's toolStats; the only file figure of a backfilled agent (paths unknown). */
  editCount?: number
  /** First five lines of the agent's result (Agent tool result or background notification). */
  result?: string
  /** Time of the latest turn.step or tool.call start / finish. */
  lastEventAt?: number
  /** Tool of the oldest tool.call still awaiting its result. */
  pendingTool?: string
  /** Tool calls awaiting their result, per tool name (several run at once when the model asks for them together). */
  pendingCalls?: Record<string, number>
  /** Tool calls per tool name; a backfilled agent gets Read / Search / Bash / Edit / Other from toolStats. */
  toolCounts?: Record<string, number>
  /** Denied or errored tool results. */
  denied?: number
  /** Their reasons, deduped by first line (at most 10 distinct). */
  reasons?: Denial[]
  /** The branch on the agent's transcript's first line: what the attribution rule (hooks/attribution.ts) reads. */
  branch?: string
}

/**
 * One PR's subagent totals, published for other mods (docs/adr/0001-cross-mod-state.md): tokens, estimated cost in USD,
 * wall time in ms, hook refusals. Canonical; pr-hint mirrors it in plugins/pr-hint/types/index.d.ts.
 */
export type PrStat = { tokens: number; cost: number; ms: number; refusals: number }

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': {
      /** One record per subagent, keyed by agentId. */
      agents: Record<string, AgentMonitorRec>
      /** True while the panel is drawn in the band above the prompt (`/sub top`). */
      historyOpen: boolean
      /** True while the panel is open as a pane (`/sub right`): what a reload reopens. */
      paneOpen: boolean
      /** The page the panel shows: `list`, `detail:<agentId>` or `settings`. */
      view: string
      /** `key` of the element that last held the focus ring (`row:<agentId>` ...), so a page change can put it back. */
      focusKey: string | null
      /** `key` of the element the focus ring is on now (any element, `close` included); null when it is on none. Drives the selected-row highlight. */
      ringKey: string | null
      /** The settings page's unsaved copy of the options; null off that page. */
      draft: AgentMonitorDraft | null
      /** `/sub top|right` for this session when the default placement is fixed (`right` / `top`); null = the default stands. */
      sessionPlacement: 'top' | 'right' | null
      /** The main loop's recent file edits, for conflicts with a running subagent. */
      mainEdits: MainEdit[]
      /** Published (pr-hint reads it): subagent totals per PR, keyed by the PR number as a string. Never written yet: absent. */
      prStats: Record<string, PrStat>
      /** The table's mode: `pr` (grouped by PR, the default) or `agent` (one flat list). */
      mode: 'pr' | 'agent'
      /** PR-mode groups opened or closed by hand (`pr:<n>` / `other` -> open); a group not named here follows the default (the first group open). */
      expanded: Record<string, boolean>
    }
  }
}

// s-dispatch contract: the state the /s picker and settings pane draw from.

/** One dispatchable agent type: its exact name, one-line description, and its file's model/effort when it has one. */
export type SDispatchAgent = { name: string; description: string; model?: string; effort?: string }

/** A background subagent this plugin started, keyed by agentId in state. */
export type SDispatchJob = { agent: string; task: string }

/** A keyword rule being written in the 路由 tab: a new one (`index` absent) or rule `index` edited in place. */
export type SDispatchRuleDraft = { keywords: string; agent: string; index?: number }

/** The 代理 detail form: an agent's settings edited as a draft, written together on 保存. */
export type SDispatchAgentForm = { name: string; visible: 'on' | 'off'; alias: string; extra: string; prompt: string }

/** How `/s <task>` picks an agent when the first token names none. */
export type SDispatchRouteMode = 'keyword' | 'model' | 'hybrid' | 'off'

/** One keyword rule: any keyword found in the task routes to `agent`. */
export type SDispatchRule = { keywords: string[]; agent: string }

/** The persisted settings ($.store key `config`). */
export type SDispatchConfig = {
  /** Slash command name; null follows the plugin's userConfig `commandName`. */
  commandName: string | null
  /** `main`: /s hands the task to the main session, which dispatches it; `direct`: /s routes and spawns itself. */
  dispatchMode: 'main' | 'direct'
  defaultAgent: string
  quick: { model: string; effort: string }
  routeMode: SDispatchRouteMode
  /** The router model's effort (`model` / `hybrid` modes); a store without it reads 'low'. */
  routeEffort: 'low' | 'medium' | 'high'
  rules: SDispatchRule[]
  /** Agent name -> shown in the picker; a name missing here follows the default visible set. */
  visibleAgents: Record<string, boolean>
  /** Agent name -> alias; once assigned never reshuffled. */
  aliases: Record<string, string>
  /** Agent name -> extra prompt prepended to the task. */
  prompts: Record<string, string>
  maxCount: number
  /** Agent name -> the effort copy 1 of an xN (N >= 2) runs at; the rest keep the agent default. */
  extraEffort: Record<string, string>
}

declare module 'claude-code' {
  interface PluginState {
    's-dispatch': {
      /** Agent types seen at agent.offer (the engine's own listing). */
      offered: SDispatchAgent[]
      /** The merged roster the picker shows. */
      roster: SDispatchAgent[]
      /** The agent the picker has selected ("" for none). */
      picked: string
      /** One-line note above the picker (unknown name, errors). */
      note: string
      /** Running jobs by agentId. */
      jobs: Record<string, SDispatchJob>
      /** The settings as loaded from $.store, mirrored for drawing. */
      config: SDispatchConfig
      /** The settings pane's active tab id: general · route · agents. */
      tab: string
      /** One-line note in the settings pane (saved, errors). */
      settingsNote: string
      /** subagentPromptCacheTtl as read from settings.json ("" when unset). */
      ttl: string
      /** The agent whose detail view the 代理 tab shows ("" for the list). */
      expanded: string
      /** The settings pane's keyboard level: 0 tab bar · 1 tab content · 2 agent detail. */
      level: 0 | 1 | 2
      /** The key the settings pane's focus ring last landed on ("" for an engine stop or unknown). */
      ring: string
      /** What the /s picker's 代理 field holds; the rows filter on it. */
      query: string
      /** The key the picker's focus ring last landed on ("" unknown). */
      pickerRing: string
      /** The open agent's detail form (null with no agent open). */
      agentForm: SDispatchAgentForm | null
      /** The enum field whose dropdown is open in the settings pane ("" for none). */
      dropdown: string
      /** The new keyword rule being written (null when the ＋ 添加规则 row is closed). */
      draft: SDispatchRuleDraft | null
      /** CLAUDE_CODE_SUBAGENT_MODEL as read at the last command ("" when unset). */
      fallbackModel: string
      /** The command name the engine accepted this load. */
      commandName: string
    }
  }
}

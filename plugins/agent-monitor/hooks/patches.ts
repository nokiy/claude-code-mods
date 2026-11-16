// How each event changes one subagent record. Pure (the hooks in register.tsx do the engine calls); tested in patches.test.ts.
import type { AgentMonitorRec, AgentSpent } from '../types'
import { addFile, editedPath, normPath } from './alerts'
import type { Strings } from './strings'
import { activityText, clip, contextTokens, firstLines } from './logic'
import type { ToolStats, Usage } from './logic'

type Rec = AgentMonitorRec

export const MAX_PROMPT = 300
export const MAX_RECENT = 10
export const MAX_SKILLS = 20
export const RESULT_LINES = 5

export const blank = (): Rec => ({ type: '', desc: '', task: '', steps: 0, watched: false, context: 0, output: 0, status: 'running' })

// State is JSON: drop undefined keys rather than store them.
export const clean = (r: Rec): Rec => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as Rec

// turn.step: one more round. A finished agent that steps again (SendMessage) starts a new run; 'unknown' was only a
// missing list entry, so the run goes on from its own start. A record whose first counted step is a turn's first (`index` 0) saw
// every step of the run: its step count is complete (`watched`).
export function onStep(p: Rec, step: { model: string; effort?: string | number; index?: number }, now: number): Rec {
  const ended = p.status === 'done' || p.status === 'failed'
  return {
    ...p,
    model: step.model,
    effort: step.effort,
    actualModel: step.model,
    actualEffort: step.effort,
    lastEventAt: now,
    stepAt: now,
    pendingTool: undefined, // a new step proves every earlier tool call came back
    watched: p.watched || (p.steps === 0 && step.index === 0),
    steps: p.steps + 1,
    status: 'running',
    finishedAt: undefined,
    durationMs: undefined,
    ...(ended
      ? { startedAt: now, tokens: undefined, context: 0, output: 0, spent: undefined, byModel: undefined, longestStepMs: undefined }
      : { startedAt: p.startedAt ?? now }),
  }
}

export const addSpent = (s: AgentSpent | undefined, u: Usage): AgentSpent => ({
  input: (s?.input ?? 0) + u.input_tokens,
  output: (s?.output ?? 0) + u.output_tokens,
  cacheRead: (s?.cacheRead ?? 0) + (u.cache_read_input_tokens ?? 0),
  cacheWrite: (s?.cacheWrite ?? 0) + (u.cache_creation_input_tokens ?? 0),
})

const addByModel = (b: Record<string, AgentSpent> | undefined, model: string, u: Usage): Record<string, AgentSpent> => ({ ...b, [model]: addSpent(b?.[model], u) })

// The step ended (`usage` is absent when the response carried none): its duration joins the longest-step figure; the latest request's
// input + cache and that request's own output become the live figure (no summing of outputs there), and the usage is added to the totals.
export function onStepEnd(p: Rec, u: Usage | undefined, now: number): Rec {
  const took = p.stepAt === undefined ? undefined : Math.max(0, now - p.stepAt)
  return {
    ...p,
    lastEventAt: now,
    stepAt: undefined,
    ...(took === undefined ? {} : { longestStepMs: Math.max(p.longestStepMs ?? 0, took) }),
    ...(u ? { context: contextTokens(u), output: u.output_tokens, spent: addSpent(p.spent, u), byModel: addByModel(p.byModel, p.actualModel ?? p.model ?? '', u) } : {}),
  }
}

/** A tool call as a model step asks for it (`turn.step`'s `toolUses`): the tool's name and its parsed arguments. */
export type ToolUse = { readonly name: string; readonly input: unknown }

/** A call's arguments as an object (anything else as none). */
export const inputOf = (use: ToolUse): Record<string, unknown> => (typeof use.input === 'object' && use.input !== null ? use.input as Record<string, unknown> : {})

/** The absolute paths a step's edit calls name (Edit / Write / MultiEdit / NotebookEdit), relative ones joined to `cwd`. */
export const editedPaths = (uses: readonly ToolUse[], cwd: string): string[] =>
  uses.flatMap(u => {
    const path = editedPath(u.name, inputOf(u))
    return path ? [normPath(path, cwd)] : []
  })

// Code Mode's only tool: every call is one script, so its name says nothing; the script's activity text (its description) does.
const CODE_MODE_TOOL = 'REPL'

// The tool calls a step of the agent asked for, about to run: each one's activity line (the latest is the live one, the last ten
// kept), counted, an edited path remembered, a skill named. The first call is the pending one until the next step or the turn's end
// (both clear it): a step proves the calls of the one before it came back. It is named by its tool, a Code Mode script by its activity.
export function onToolUses(p: Rec, uses: readonly ToolUse[], cwd: string, t: Pick<Strings, 'verb'>): Rec {
  let r: Rec = { ...p, pendingTool: undefined }
  for (const [i, use] of uses.entries()) {
    const input = inputOf(use)
    const activity = activityText(use.name, input, t)
    if (i === 0) r.pendingTool = use.name === CODE_MODE_TOOL ? activity : use.name
    const skill = use.name === 'Skill' && typeof input.skill === 'string' ? input.skill : undefined
    const skills = r.skills ?? []
    const edited = editedPath(use.name, input)
    const path = edited ? normPath(edited, cwd) : undefined
    r = {
      ...r,
      activity,
      recent: [...(r.recent ?? []), clip(activity, 120)].slice(-MAX_RECENT),
      toolCounts: { ...r.toolCounts, [use.name]: (r.toolCounts?.[use.name] ?? 0) + 1 },
      ...(path ? { files: addFile(r.files, path) } : {}),
      ...(skill && !skills.includes(skill) && skills.length < MAX_SKILLS ? { skills: [...skills, skill] } : {}),
    }
  }
  return r
}

// An Agent tool result as the main conversation keeps it (backfill.ts): the agent it started and, once it finished in the
// foreground, its totals and its report.
export type AgentResult = {
  status?: string
  description?: string
  prompt?: string
  resolvedModel?: string
  totalTokens?: number
  totalDurationMs?: number
  toolStats?: ToolStats
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
  content?: { type?: string; text?: string }[]
}

// The text of an Agent result's content blocks.
export const contentText = (content: AgentResult['content']): string => (content ?? []).map(b => b.text ?? '').join('\n')

// turn.complete of the agent's own loop; `answer` is the report it handed back (its first lines are kept; none keeps the last).
export function onComplete(p: Rec, reason: string, now: number, answer = ''): Rec {
  const report = firstLines(answer, RESULT_LINES)
  return {
    ...p,
    status: reason === 'answer' ? 'done' : 'failed',
    lastEventAt: now,
    pendingTool: undefined,
    finishedAt: now,
    durationMs: p.startedAt === undefined ? undefined : now - p.startedAt,
    ...(report ? { result: report } : {}),
  }
}

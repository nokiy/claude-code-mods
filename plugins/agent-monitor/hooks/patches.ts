// How each event changes one subagent record. Pure (the hooks in register.tsx do the engine calls); tested in patches.test.ts.
import type { AgentMonitorRec, AgentSpent } from '../types'
import { MAX_FILES, addDenial, addFile } from './alerts'
import type { Strings } from './strings'
import { activityText, clip, contextTokens, countsFromStats, firstLines, parseDescription } from './logic'
import type { ToolStats, Usage } from './logic'

type Rec = AgentMonitorRec

export const MAX_PROMPT = 300
export const MAX_RECENT = 10
export const MAX_SKILLS = 20
export const RESULT_LINES = 5

export const blank = (): Rec => ({ type: '', desc: '', task: '', steps: 0, watched: false, context: 0, output: 0, status: 'running' })

// State is JSON: drop undefined keys rather than store them.
export const clean = (r: Rec): Rec => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined)) as Rec

// agent.spawn: a fresh run, with what the spawn says.
export const onSpawn = (p: Rec, spawn: { subagentType: string; description: string; prompt?: string }, model: string | undefined, now: number): Rec => ({
  ...p,
  type: spawn.subagentType,
  desc: spawn.description,
  task: parseDescription(spawn.description).task,
  prompt: spawn.prompt === undefined ? p.prompt : clip(spawn.prompt, MAX_PROMPT),
  model: model ?? p.model,
  watched: true,
  status: 'running',
  startedAt: now,
  lastEventAt: now,
  finishedAt: undefined,
  durationMs: undefined,
  tokens: undefined,
})

// turn.step: one more round. A finished agent that steps again (SendMessage) starts a new run; 'unknown' was only a
// missing list entry, so the run goes on from its own start.
export function onStep(p: Rec, step: { model: string; effort?: string | number }, now: number): Rec {
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
    pendingCalls: undefined,
    steps: p.steps + 1,
    status: 'running',
    ...(ended ? { startedAt: now, finishedAt: undefined, durationMs: undefined, tokens: undefined, context: 0, output: 0, spent: undefined, byModel: undefined, longestStepMs: undefined } : { startedAt: p.startedAt ?? now, finishedAt: undefined, durationMs: undefined }),
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

// tool.call inside the agent, before its result: the live activity line and the last ten, the call counted and pending, an edited
// path remembered, a skill named. `input` is the call's arguments.
export function onToolStart(p: Rec, tool: string, input: Record<string, unknown>, path: string | undefined, now: number, t: Pick<Strings, 'verb'>): Rec {
  const activity = activityText(tool, input, t)
  const skill = tool === 'Skill' && typeof input.skill === 'string' ? input.skill : undefined
  const skills = p.skills ?? []
  return {
    ...p,
    activity,
    recent: [...(p.recent ?? []), clip(activity, 120)].slice(-MAX_RECENT),
    startedAt: p.startedAt ?? now,
    lastEventAt: now,
    pendingTool: p.pendingTool ?? tool,
    pendingCalls: { ...p.pendingCalls, [tool]: (p.pendingCalls?.[tool] ?? 0) + 1 },
    toolCounts: { ...p.toolCounts, [tool]: (p.toolCounts?.[tool] ?? 0) + 1 },
    ...(path ? { files: addFile(p.files, path) } : {}),
    ...(skill && !skills.includes(skill) && skills.length < MAX_SKILLS ? { skills: [...skills, skill] } : {}),
  }
}

// Lines added and removed by one Edit / Write result: its patch's `+` / `-` lines (per call, unlike `gitDiff`, which is against HEAD);
// a created file with no patch counts its lines. undefined when the result says nothing.
export function diffStat(result: unknown): { add: number; del: number } | undefined {
  const r = result as { type?: string; content?: unknown; structuredPatch?: { lines?: string[] }[] } | null | undefined
  if (!r || typeof r !== 'object') return undefined
  let add = 0
  let del = 0
  if (Array.isArray(r.structuredPatch)) {
    for (const h of r.structuredPatch) {
      for (const l of h.lines ?? []) {
        if (l.startsWith('+')) add++
        else if (l.startsWith('-')) del++
      }
    }
  }
  if (add + del > 0) return { add, del }
  if (r.type === 'create' && typeof r.content === 'string') return { add: r.content === '' ? 0 : r.content.split('\n').length, del: 0 }
  return undefined
}

// The lines an edit call changed in `file`, from its result (undefined: not an edit, errored, or no patch).
export function editDelta(file: string | undefined, r: unknown): { path: string; add: number; del: number } | undefined {
  const res = r as { isError?: boolean; result?: unknown } | undefined
  const stat = file && !res?.isError ? diffStat(res?.result) : undefined
  return file && stat ? { path: file, ...stat } : undefined
}

// The Agent tool call whose result named the agent it started: that result and the call's own arguments; undefined for any other call.
export function agentLaunched(e: { tool: unknown }, r: { result?: unknown; isError?: boolean }): { res: AgentResult & { agentId: string }; call: { subagent_type?: string; description?: string } } | undefined {
  const res = r.result as (AgentResult & { agentId?: string }) | undefined
  return e.tool === 'Agent' && res && !r.isError && res.agentId ? { res: { ...res, agentId: res.agentId }, call: e as { subagent_type?: string; description?: string } } : undefined
}

// A `tool` call's result is back; `refusal` is why it was denied or errored (undefined when it went through), `hookDenied` whether a
// hook's deny refused it (otherwise the refusal is an errored result, a `failed` reason); `edit` the lines an edit changed in `path`. Whatever call is still out stays pending, named by the oldest.
export function onToolEnd(p: Rec, tool: string, refusal: string | undefined, now: number, edit?: { path: string; add: number; del: number }, hookDenied = false): Rec {
  const out = { ...p.pendingCalls }
  if ((out[tool] ?? 0) > 1) out[tool]!--
  else delete out[tool]
  const open = Object.keys(out)[0]
  const old = edit ? p.lines?.[edit.path] : undefined
  const room = Object.keys(p.lines ?? {}).length < MAX_FILES
  return {
    ...p,
    lastEventAt: now,
    pendingTool: open,
    pendingCalls: open ? out : undefined,
    ...(refusal === undefined ? {} : addDenial(p, refusal, now, !hookDenied)),
    ...(hookDenied ? { refusals: (p.refusals ?? 0) + 1 } : {}),
    ...(edit && (old || room) ? { lines: { ...p.lines, [edit.path]: { add: (old?.add ?? 0) + edit.add, del: (old?.del ?? 0) + edit.del } } } : {}),
  }
}

// The Agent tool's result names the agent it started (a second way in, should agent.spawn have been missed) and, once the
// agent finished in the foreground, carries its authoritative totals and its report. Never overwrites what the spawn wrote.
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

export function onAgentResult(p: Rec, call: { subagent_type?: string; description?: string }, res: AgentResult, now: number): Rec {
  const desc = call.description ?? res.description ?? ''
  const u = res.usage
  const report = firstLines(contentText(res.content), RESULT_LINES)
  return {
    ...p,
    type: p.type || call.subagent_type || 'general-purpose',
    desc: p.desc || desc,
    task: p.task || parseDescription(desc).task,
    prompt: p.prompt ?? (res.prompt === undefined ? undefined : clip(res.prompt, MAX_PROMPT)),
    model: p.model ?? res.resolvedModel,
    startedAt: p.startedAt ?? now,
    ...(res.status === 'completed'
      ? {
          tokens: res.totalTokens,
          durationMs: res.totalDurationMs,
          // The result's usage is its last turn's: it stands in only for an agent whose steps were not seen.
          ...(u && !p.spent ? { spent: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 } } : {}),
          ...(report ? { result: report } : {}),
          ...(res.toolStats ? { editCount: res.toolStats.editFileCount, toolCounts: p.toolCounts ?? countsFromStats(res.toolStats) } : {}),
          ...(p.status === 'running' || p.status === 'unknown' ? { status: 'done' as const, finishedAt: now } : {}),
        }
      : {}),
  }
}

// turn.complete of the agent's own loop.
export const onComplete = (p: Rec, reason: string, now: number): Rec => ({
  ...p,
  status: reason === 'answer' ? 'done' : 'failed',
  lastEventAt: now,
  pendingTool: undefined,
  pendingCalls: undefined,
  finishedAt: now,
  durationMs: p.startedAt === undefined ? undefined : now - p.startedAt,
})

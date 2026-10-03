// Views for agent-monitor: state records merged with the engine's agent list. Pure; tested in views.test.ts.
import type { AgentMonitorRec, AgentSpent, Denial, MainEdit } from '../types'
import { DEFAULT_STALL_MS, findClashes, stallOf, tierMismatch } from './alerts'
import type { Clash, Stall, TierCheck } from './alerts'
import type { Config } from './config'
import { DEFAULT_PRICES, agentCost } from './cost'
import type { Prices } from './cost'
import { parseDescription } from './logic'
import { clean } from './patches'
import type { Strings } from './strings'

// 'unknown': the record said running but the engine no longer lists the agent.
export type Status = 'running' | 'done' | 'failed' | 'unknown'
export type ListAgent = { id: string; type: string; status: string; description: string }

export type View = {
  id: string
  type: string
  task: string
  desc: string
  status: Status
  model?: string
  effort?: string | number
  rounds?: number
  tokens?: number
  startedAt?: number
  finishedAt?: number
  elapsedMs?: number
  activity?: string
  lastEventAt?: number
  pendingTool?: string
  /** Paths this agent's edit calls named (absolute). */
  files: string[]
  /** Files edited: the paths seen, or the Agent result's count when paths are unknown (backfilled). */
  editCount: number
  toolCounts: Record<string, number>
  denied: number
  reasons: Denial[]
  /** Model and effort of the latest turn.step. */
  actualModel?: string
  actualEffort?: string | number
  /** Detail page: the spawn prompt, the latest activity texts (oldest first), the longest step, token parts, lines changed per path, skills, the report. */
  prompt?: string
  recent: string[]
  longestStepMs?: number
  spent?: AgentSpent
  /** Estimated USD at list prices; undefined when a step's model has no price or nothing is known. */
  cost?: number
  fileLines: Record<string, { add: number; del: number }>
  skills: string[]
  result?: string
  // The four alerts. stall: running agents only. clashes: paths shared with an agent (or `main`) that ran at the same time.
  stall?: Stall
  tier?: TierCheck
  clashes: Clash[]
}

// What every screen draws from: the views (newest first), the session cwd for short paths, the settings.
export type Board = { views: View[]; cwd: string; cfg: Config; t: Strings }

const DONE = new Set(['completed', 'done', 'success', 'succeeded'])
const FAILED = new Set(['failed', 'killed', 'error', 'cancelled'])

// The state record's word wins once it left 'running'; otherwise the engine's task status decides.
// A task status that is neither an end nor `running` (pending, ...) says nothing about the end.
export function effectiveStatus(rec: Status | undefined, listStatus: string | undefined): Status {
  if (rec && rec !== 'running') return rec
  if (listStatus !== undefined && DONE.has(listStatus)) return 'done'
  if (listStatus !== undefined && FAILED.has(listStatus)) return 'failed'
  return rec ?? 'running'
}

// Newest start first, whatever the status. No start time: after those with one; ties and unknowns by agentId.
export function orderViews<T extends { id: string; startedAt?: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if ((a.startedAt === undefined) !== (b.startedAt === undefined)) return a.startedAt === undefined ? 1 : -1
    if (a.startedAt !== b.startedAt) return b.startedAt! - a.startedAt!
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

// Records still `running` that the engine's list contradicts: absent -> 'unknown'; listed but finished -> its real end state.
// No list (undefined) means nothing is known, so nothing is touched.
export function reconcile(recs: Record<string, AgentMonitorRec>, list: ListAgent[] | undefined): [string, Status][] {
  if (list === undefined) return []
  const byId = new Map(list.map(a => [a.id, a.status]))
  const out: [string, Status][] = []
  for (const [id, r] of Object.entries(recs)) {
    if (r.status !== 'running') continue
    const st = byId.get(id)
    if (st === undefined) out.push([id, 'unknown'])
    else if (effectiveStatus('running', st) !== 'running') out.push([id, effectiveStatus('running', st)])
  }
  return out
}

// The record an event for an agent with no record of its own may start: only an agent `$.agent.list()` names.
// Engine forks (compaction, memory) and workflow agents carry ids no list names; they are not subagents, so they get none.
export function seedRec(a: ListAgent | undefined): AgentMonitorRec | undefined {
  if (!a || a.type === 'teammate') return undefined
  return { type: a.type, desc: a.description, task: parseDescription(a.description).task, steps: 0, watched: false, context: 0, output: 0, status: effectiveStatus(undefined, a.status) }
}

// The records minus those nothing describes (no type, no description): leftovers of ids that were never subagents. Same object when none.
export function withoutGhosts(recs: Record<string, AgentMonitorRec>): Record<string, AgentMonitorRec> {
  const keep = Object.entries(recs).filter(([, r]) => r.type || r.desc)
  return keep.length === Object.keys(recs).length ? recs : Object.fromEntries(keep)
}

// The records with the ends in `ended` written (only a record still running takes one) and the undescribed leftovers dropped.
export function settled(recs: Record<string, AgentMonitorRec>, ended: ReadonlyMap<string, Status>, now: number): Record<string, AgentMonitorRec> {
  return Object.fromEntries(Object.entries(withoutGhosts(recs)).map(([id, r]) => {
    const status = ended.get(id)
    if (!status || r.status !== 'running') return [id, r]
    return [id, clean({ ...r, status, finishedAt: now, durationMs: r.startedAt === undefined ? undefined : now - r.startedAt })]
  }))
}

// One view per subagent known to the state or to `$.agent.list()` (teammates excluded), ordered.
// An entry nothing describes (no type, no description) is never a row.
export function buildViews(recs: Record<string, AgentMonitorRec>, list: ListAgent[] | undefined, now: number, ctx: { stallMs?: number; main?: readonly MainEdit[]; prices?: Prices } = {}): View[] {
  const byId = new Map((list ?? []).filter(a => a.type !== 'teammate').map(a => [a.id, a]))
  const ids = new Set([...Object.keys(recs), ...byId.keys()])
  const views: View[] = []
  for (const id of ids) {
    const r = recs[id]
    const a = byId.get(id)
    if (!r && !a) continue
    if (!(r?.type || a?.type || r?.desc || a?.description)) continue
    const stale = r?.status === 'running' && !a && list !== undefined
    const status = stale ? 'unknown' : effectiveStatus(r?.status, a?.status)
    const desc = r?.desc || a?.description || ''
    const live = r ? r.context + r.output : 0
    const tokens = status === 'running' ? (live > 0 ? live : undefined) : (r?.tokens ?? (live > 0 ? live : undefined))
    let elapsedMs: number | undefined
    if (r?.startedAt !== undefined) {
      elapsedMs = status === 'running' ? now - r.startedAt : (r.durationMs ?? (r.finishedAt !== undefined ? r.finishedAt - r.startedAt : undefined))
    } else if (status !== 'running') elapsedMs = r?.durationMs
    views.push({
      id,
      type: r?.type || a?.type || '—',
      task: r?.task || parseDescription(a?.description ?? '').task,
      desc,
      status,
      model: r?.model,
      effort: r?.effort,
      rounds: r?.watched ? r.steps : undefined,
      tokens,
      startedAt: r?.startedAt,
      finishedAt: r?.finishedAt,
      elapsedMs,
      activity: r?.activity,
      lastEventAt: r?.lastEventAt,
      pendingTool: r?.pendingTool,
      files: r?.files ?? [],
      editCount: Math.max(r?.files?.length ?? 0, r?.editCount ?? 0),
      toolCounts: r?.toolCounts ?? {},
      denied: r?.denied ?? 0,
      reasons: r?.reasons ?? [],
      actualModel: r?.actualModel,
      actualEffort: r?.actualEffort,
      prompt: r?.prompt,
      recent: r?.recent ?? [],
      longestStepMs: r?.longestStepMs,
      spent: r?.spent,
      cost: (r && agentCost(r, ctx.prices ?? DEFAULT_PRICES)) ?? undefined,
      fileLines: r?.lines ?? {},
      skills: r?.skills ?? [],
      result: r?.result,
      stall: r ? stallOf({ status, lastEventAt: r.lastEventAt, startedAt: r.startedAt, pendingTool: r.pendingTool }, now, ctx.stallMs ?? DEFAULT_STALL_MS) : undefined,
      tier: r ? tierMismatch(desc, r.actualModel, r.actualEffort) : undefined,
      clashes: [],
    })
  }
  const ordered = orderViews(views)
  const end = (v: View) => (v.status === 'running' ? now : (v.finishedAt ?? (v.startedAt === undefined ? undefined : v.startedAt + (v.elapsedMs ?? 0))))
  const clashes = findClashes(ordered.map(v => ({ id: v.id, files: v.files, start: v.startedAt, end: end(v) })), ctx.main ?? [])
  for (const v of ordered) v.clashes = clashes.get(v.id) ?? []
  return ordered
}


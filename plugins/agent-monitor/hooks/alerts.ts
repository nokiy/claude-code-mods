// Detectors for agent-monitor's four alerts: file conflict, stall, tier mismatch, denied/errored calls. Pure; tested in alerts.test.ts.
import type { Denial, MainEdit } from '../types'
import { collapse, effortName, modelName, parseDescription, resolveTier, tierName, truncate } from './logic'

export const MAX_FILES = 50
export const MAX_REASONS = 10
export const MAX_MAIN = 200
export const DEFAULT_STALL_MS = 3 * 60_000

// ---- files and conflicts ----

export const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// The path an edit tool call names (NotebookEdit calls it notebook_path); undefined for any other tool.
export function editedPath(tool: string, input: Record<string, unknown>): string | undefined {
  if (!EDIT_TOOLS.has(tool)) return undefined
  const p = input.file_path ?? input.notebook_path
  return typeof p === 'string' && p !== '' ? p : undefined
}

// Absolute form: a relative path joins `cwd`; `.`, `..` and doubled slashes fold away.
export function normPath(p: string, cwd: string): string {
  const out: string[] = []
  for (const s of (p.startsWith('/') ? p : `${cwd.replace(/\/+$/, '')}/${p}`).split('/')) {
    if (s === '' || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return `/${out.join('/')}`
}

// Relative to `cwd` when under it, else as is.
export function shortPath(p: string, cwd: string): string {
  const dir = cwd.replace(/\/+$/, '')
  return dir !== '' && p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p
}

// Add one path: deduped, and nothing past MAX_FILES.
export function addFile(files: readonly string[] | undefined, path: string): string[] {
  const list = files ?? []
  return list.includes(path) || list.length >= MAX_FILES ? [...list] : [...list, path]
}

export type Span = { id: string; files: readonly string[]; start?: number; end?: number }
export type Clash = { path: string; other: string; at?: number } // other: the partner's agentId, or 'main'; at: the main edit, or the later start

// Per agent: the paths it shares with another participant that was running at the same time. Two agents clash when their run intervals
// overlap and both touched the path (sequential reuse does not); the main loop clashes with an agent that touched the path when the
// main edit fell inside that agent's run. An agent with no start (a backfilled one, no paths either) takes part in nothing.
export function findClashes(spans: readonly Span[], main: readonly MainEdit[]): Map<string, Clash[]> {
  const out = new Map<string, Clash[]>()
  const add = (id: string, c: Clash) => {
    const list = out.get(id) ?? []
    if (!list.some(x => x.path === c.path && x.other === c.other)) out.set(id, [...list, c])
  }
  const live = spans.filter(s => s.start !== undefined && s.end !== undefined && s.files.length > 0)
  for (let i = 0; i < live.length; i++) {
    const a = live[i]!
    for (const m of main) if (a.files.includes(m.path) && m.at >= a.start! && m.at <= a.end!) add(a.id, { path: m.path, other: 'main', at: m.at })
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j]!
      if (a.start! > b.end! || b.start! > a.end!) continue
      const at = Math.max(a.start!, b.start!)
      for (const path of a.files) if (b.files.includes(path)) { add(a.id, { path, other: b.id, at }); add(b.id, { path, other: a.id, at }) }
    }
  }
  return out
}

// ---- stall ----

// level 1 at the threshold, 2 at twice it. `tool`: the tool call still awaiting its result, if any.
export type Stall = { level: 1 | 2; idleMs: number; tool?: string }

// Running agents only: idle since the latest turn.step or tool.call start / finish (the start when none was seen yet).
export function stallOf(a: { status: string; lastEventAt?: number; startedAt?: number; pendingTool?: string }, now: number, thresholdMs: number): Stall | undefined {
  if (a.status !== 'running') return undefined
  const since = a.lastEventAt ?? a.startedAt
  if (since === undefined) return undefined
  const idleMs = now - since
  if (idleMs < thresholdMs) return undefined
  return { level: idleMs >= 2 * thresholdMs ? 2 : 1, idleMs, ...(a.pendingTool ? { tool: a.pendingTool } : {}) }
}

export const idleText = (ms: number): string => (ms >= 60_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.max(0, Math.floor(ms / 1000))}s`)

// ---- tier ----

// want: the description prefix (`so.med`); got: what the step ran (`sonnet.high`); model / effort say which part differs.
export type TierCheck = { want: string; got: string; model: boolean; effort: boolean }

// The description's `so|op|ha|fa.low|med|high` prefix against the latest turn.step. No prefix, no step, an unknown model or an
// effort the step did not report: nothing to compare, so no mismatch.
export function tierMismatch(desc: string, model: string | undefined, effort: string | number | undefined): TierCheck | undefined {
  const want = parseDescription(desc).tier
  const wantR = resolveTier(undefined, undefined, desc)
  const gotModel = modelName(model)
  if (!want || !wantR.model || !gotModel) return undefined
  const gotEffort = effortName(effort)
  const badModel = gotModel !== wantR.model
  const badEffort = gotEffort !== undefined && gotEffort !== wantR.effort
  if (!badModel && !badEffort) return undefined
  return { want, got: tierName(model, effort, ''), model: badModel, effort: badEffort }
}

// ---- denied / errored ----

// First non-empty line of a reason, whitespace-collapsed, at most 80 cells.
export function denialReason(text: string | undefined): string {
  const line = (text ?? '').split('\n').find(l => l.trim() !== '') ?? ''
  return truncate(collapse(line), 80) || '(no reason)'
}

// One more denied result at `at`: counted, its reason deduped by first line (keeping the time it was first seen); a new reason past
// MAX_REASONS counts but is not listed.
export function addDenial(p: { denied?: number; reasons?: readonly Denial[] }, text: string | undefined, at?: number): { denied: number; reasons: Denial[] } {
  const reason = denialReason(text)
  const reasons = (p.reasons ?? []).map(r => ({ ...r }))
  const hit = reasons.find(r => r.text === reason)
  if (hit) hit.n++
  else if (reasons.length < MAX_REASONS) reasons.push({ text: reason, n: 1, ...(at === undefined ? {} : { at }) })
  return { denied: (p.denied ?? 0) + 1, reasons }
}

// A tool.call result's refusal: a hook's `deny`, or the text of an errored result. undefined when the call went through.
export function reasonOf(r: { deny?: string; isError?: boolean; text?: string } | undefined): string | undefined {
  if (!r) return undefined
  if (r.deny !== undefined) return r.deny
  return r.isError ? (r.text ?? '') : undefined
}

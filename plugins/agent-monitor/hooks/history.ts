// Subagent history for agent-monitor: the current project's transcript directory scanned into one cache entry per subagent file
// (size, time, read position, rollup, meta), each turned into a record that fills in what the hook records lack. The file access is
// handed in (TxIo, built from `$` in register.tsx), so this stays pure; tested in history.test.ts.
import type { AgentMonitorRec, AgentSpent } from '../types'
import { addDenial } from './alerts'
import { parseDescription } from './logic'
import { clean } from './patches'
import { emptyRollup, feed } from './transcript'
import type { Rollup } from './transcript'

/** One directory entry, as `$.fs.list` gives it. */
export type Listing = { name: string; kind: string; size: number; mtimeMs: number }
/** The file access a scan needs; `tail` is the bytes from `from` on (truncated: more remain). */
export type TxIo = {
  list: (dir: string) => Promise<readonly Listing[]>
  read: (path: string) => Promise<string>
  tail: (path: string, from: number) => Promise<{ text: string; truncated: boolean }>
  load: (key: string) => Promise<unknown>
  save: (key: string, value: TxEntry) => Promise<void>
}
/** The meta file beside a transcript (`agent-<id>.meta.json`); it has no model. */
export type TxMeta = { agentType?: string; description?: string }
/** What is kept per transcript file, in memory and in `$.store` under storeKey(path): never the transcript itself. */
export type TxEntry = { size: number; mtimeMs: number; offset: number; roll: Rollup; meta?: TxMeta }

/** `$.fs.read` takes files up to 4 MiB; a larger one is read from its position on through a process. */
export const MAX_WHOLE = 4 * 1024 * 1024
/** At most this many process reads per file per refresh (each up to 4 MiB of output). */
const MAX_TAILS = 8
const FILE = /^agent-(.+)\.jsonl$/

export const storeKey = (path: string) => `transcript:${path}`

/** Where Claude Code keeps a project's transcripts: the root with every character but a letter or digit turned into `-`. */
export const projectDir = (configDir: string, root: string) => `${configDir.replace(/\/+$/, '')}/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}`

const asEntry = (v: unknown): TxEntry | undefined => {
  const e = v as TxEntry | undefined
  return e && typeof e === 'object' && typeof e.offset === 'number' && e.roll && typeof e.roll === 'object' ? e : undefined
}

async function readMeta(io: TxIo, path: string): Promise<TxMeta | undefined> {
  try {
    const m = JSON.parse(await io.read(path.replace(/\.jsonl$/, '.meta.json'))) as TxMeta
    return m && typeof m === 'object' ? { agentType: m.agentType, description: m.description } : undefined
  } catch { return undefined }
}

// Bring one file's entry up to date. Unchanged size and time: nothing is read. Up to 4 MiB: read whole and rolled up afresh. Larger:
// read from the stored position on, the rollup continued (a file that shrank starts over). Returns whether the entry changed.
async function refreshFile(io: TxIo, path: string, f: Listing, cache: Map<string, TxEntry>): Promise<boolean> {
  const had = cache.get(path)
  const e = had ?? asEntry(await io.load(storeKey(path)))
  if (e && e.size === f.size && e.mtimeMs === f.mtimeMs) {
    if (!had) cache.set(path, e)
    return !had
  }
  let roll: Rollup
  let offset: number
  let caught = true
  if (f.size <= MAX_WHOLE) ({ roll, bytes: offset } = feed(emptyRollup(), await io.read(path)))
  else {
    const resume = e && e.offset <= f.size
    roll = resume ? e.roll : emptyRollup()
    offset = resume ? e.offset : 0
    for (let i = 0; i < MAX_TAILS; i++) {
      const chunk = await io.tail(path, offset)
      const step = feed(roll, chunk.text)
      roll = step.roll
      offset += step.bytes
      caught = !chunk.truncated
      if (caught || step.bytes === 0) break
    }
  }
  // Not caught up: no size, so the next refresh reads on.
  const next: TxEntry = { size: caught ? f.size : -1, mtimeMs: f.mtimeMs, offset, roll, meta: e?.meta ?? (await readMeta(io, path)) }
  cache.set(path, next)
  await io.save(storeKey(path), next).catch(() => {}) // best effort: a full store only costs a re-read in the next load
  return true
}

async function listOr(io: TxIo, dir: string): Promise<readonly Listing[]> {
  try { return await io.list(dir) } catch { return [] }
}

/**
 * Refresh the cache from the project's transcript directory: every session's `subagents/` folder, or only `sessionId`'s (the 1 s
 * tick). Only files named `agent-<id>.jsonl` are read; the main session's own transcript is never touched. Returns whether anything changed.
 */
export async function refreshProject(io: TxIo, project: string, cache: Map<string, TxEntry>, sessionId?: string): Promise<boolean> {
  const sessions = sessionId ? [sessionId] : (await listOr(io, project)).filter(d => d.kind === 'dir').map(d => d.name)
  let changed = false
  for (const s of sessions) {
    const dir = `${project}/${s}/subagents`
    for (const f of await listOr(io, dir)) {
      if (f.kind !== 'file' || !FILE.test(f.name)) continue
      try { changed = (await refreshFile(io, `${dir}/${f.name}`, f, cache)) || changed } catch { /* unreadable now: tried again on the next refresh */ }
    }
  }
  return changed
}

const sum = (all: readonly AgentSpent[]): AgentSpent | undefined =>
  all.length === 0 ? undefined : all.reduce((a, b) => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite }))

/** One finished record per cached transcript, keyed by agentId; a file with no meta type (an engine fork, not a subagent) gives none. */
export function historyRecs(cache: ReadonlyMap<string, TxEntry>): Record<string, AgentMonitorRec> {
  const out: Record<string, AgentMonitorRec> = {}
  for (const [path, e] of cache) {
    const id = e.roll.agentId ?? FILE.exec(path.split('/').pop() ?? '')?.[1]
    if (!id || !e.meta?.agentType) continue
    const desc = e.meta.description ?? ''
    const r = e.roll
    const last = r.open?.usage
    const denials = r.refusals.reduce<{ denied?: number; reasons?: AgentMonitorRec['reasons'] }>((p, x) => addDenial(p, x.text, x.at), {})
    out[id] = clean({
      type: e.meta.agentType,
      desc,
      task: parseDescription(desc).task,
      prompt: r.prompt,
      model: r.model,
      steps: r.steps,
      watched: true,
      context: last ? last.input + last.cacheRead + last.cacheWrite : 0,
      output: last?.output ?? 0,
      tokens: last ? last.input + last.cacheRead + last.cacheWrite + last.output : undefined,
      spent: sum(Object.values(r.byModel)),
      byModel: Object.keys(r.byModel).length ? r.byModel : undefined,
      startedAt: r.startedAt,
      finishedAt: r.lastAt,
      durationMs: r.startedAt !== undefined && r.lastAt !== undefined ? r.lastAt - r.startedAt : undefined,
      status: 'done',
      branch: r.gitBranch,
      ...(r.refused ? { denied: r.refused, reasons: denials.reasons } : {}),
    })
  }
  return out
}

/** The hook records with the history added: by agentId, one record each; the hook record's fields win, history fills the rest. */
export function withHistory(recs: Record<string, AgentMonitorRec>, history: Record<string, AgentMonitorRec>): Record<string, AgentMonitorRec> {
  const ids = Object.keys(history)
  if (ids.length === 0) return recs
  const out = { ...recs }
  for (const id of ids) out[id] = recs[id] ? { ...history[id]!, ...clean(recs[id]) } : history[id]!
  return out
}

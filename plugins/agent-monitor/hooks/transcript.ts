// [POS] Subagent transcripts for agent-monitor: the jsonl Claude Code writes per subagent (`<sessionId>/subagents/agent-<id>.jsonl`)
// rolled up into one small record, fed in byte chunks so a large file resumes from where the last read stopped. Read by history.ts.
// Pure; tested in tests/transcript.test.ts.
import type { AgentSpent } from '../types'
import { plusSpent } from './cost'
import { clip } from './logic'
import { MAX_PROMPT } from './patches'

/** One hook refusal (a line carrying `toolDenialKind`): when, which kind, the first 200 characters of its text. */
export type Refusal = { at?: number; kind: string; text: string }

/** What a transcript adds up to; JSON, so it can be cached in `$.store` beside its read position. */
export type Rollup = {
  /** From the first line that carries them. */
  agentId?: string
  sessionId?: string
  gitBranch?: string
  cwd?: string
  /** The first user line's text, cut to MAX_PROMPT. */
  prompt?: string
  /** Model of the latest assistant message. */
  model?: string
  /** First and latest line timestamps (ms). */
  startedAt?: number
  lastAt?: number
  /** Distinct assistant messages. */
  steps: number
  /** Usage per model, one usage per message id (the last line of a streamed message holds the final figure). */
  byModel: Record<string, AgentSpent>
  /** The latest message: its id and the usage already counted, replaced if the next line continues it. */
  open?: { id: string; model: string; usage: AgentSpent }
  /** Every refusal line counted; the latest MAX_REFUSALS kept. */
  denied: number
  refusals: Refusal[]
}

export const MAX_REFUSALS = 20

export const emptyRollup = (): Rollup => ({ steps: 0, byModel: {}, denied: 0, refusals: [] })

type Line = {
  type?: string
  timestamp?: string
  agentId?: string
  sessionId?: string
  gitBranch?: string
  cwd?: string
  toolDenialKind?: string
  message?: { id?: string; model?: string; usage?: Record<string, number | null | undefined>; content?: unknown }
}

const ZERO: AgentSpent = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
const spentOf = (u: Record<string, number | null | undefined>): AgentSpent => ({
  input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
})

/** The text of a message's content: a string, or its text / tool_result blocks joined. */
export function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b: { text?: unknown; content?: unknown }) => (typeof b?.text === 'string' ? b.text : textOf(b?.content))).filter(Boolean).join('\n')
}

/** Bytes of a string in UTF-8 (the unit of a file offset). */
export function utf8Bytes(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { n += 4; i++ } // a surrogate pair is one 4-byte character
    else n += 3
  }
  return n
}

function addLine(r: Rollup, l: Line): Rollup {
  const at = l.timestamp ? Date.parse(l.timestamp) : NaN
  const out: Rollup = {
    ...r,
    agentId: r.agentId ?? l.agentId,
    sessionId: r.sessionId ?? l.sessionId,
    gitBranch: r.gitBranch ?? l.gitBranch,
    cwd: r.cwd ?? l.cwd,
    ...(Number.isNaN(at) ? {} : { startedAt: r.startedAt ?? at, lastAt: at }),
  }
  const m = l.message
  if (l.type === 'user' && out.prompt === undefined && !l.toolDenialKind) {
    const text = textOf(m?.content).trim()
    if (text) out.prompt = clip(text, MAX_PROMPT)
  }
  if (l.toolDenialKind) {
    out.denied = r.denied + 1
    out.refusals = [...r.refusals, { at: Number.isNaN(at) ? undefined : at, kind: l.toolDenialKind, text: clip(textOf(m?.content), 200) }].slice(-MAX_REFUSALS)
  }
  if (l.type === 'assistant' && m?.id && m.model && m.model !== '<synthetic>') {
    const usage = spentOf(m.usage ?? {})
    const byModel = { ...r.byModel }
    const same = r.open?.id === m.id
    if (same && r.open) byModel[r.open.model] = plusSpent(byModel[r.open.model] ?? ZERO, r.open.usage, -1)
    byModel[m.model] = plusSpent(byModel[m.model] ?? ZERO, usage)
    Object.assign(out, { byModel, model: m.model, steps: r.steps + (same ? 0 : 1), open: { id: m.id, model: m.model, usage } })
  }
  return out
}

/**
 * Adds the complete lines of `chunk` (the file's bytes from the last read position on) to the rollup. A line not yet ended by a
 * newline is left for the next read; a line that is not JSON is skipped. `bytes`: how far the position moves.
 */
export function feed(roll: Rollup, chunk: string): { roll: Rollup; bytes: number } {
  const end = chunk.lastIndexOf('\n')
  if (end < 0) return { roll, bytes: 0 }
  const done = chunk.slice(0, end + 1)
  let r = roll
  for (const raw of done.split('\n')) {
    if (!raw.trim()) continue
    let l: Line
    try { l = JSON.parse(raw) as Line } catch { continue }
    if (l && typeof l === 'object') r = addLine(r, l)
  }
  return { roll: r, bytes: utf8Bytes(done) }
}

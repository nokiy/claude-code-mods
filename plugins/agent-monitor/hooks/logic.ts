// Pure helpers for agent-monitor (text, numbers, tool activity): no engine access, unit-tested in logic.test.ts.
import type { Strings } from './strings'

const MODEL_ABBR: [string, string][] = [['opus', 'op'], ['sonnet', 'so'], ['haiku', 'ha'], ['fable', 'fa']]
const EFFORT_SHORT: Record<string, string> = { low: 'low', medium: 'med', high: 'high' }

// ---- scope ----

// The mod acts everywhere (empty `scope`), or only inside the absolute directory `scope` and its subfolders.
export function inScope(cwd: string, scope: string): boolean {
  const root = scope.trim().replace(/\/+$/, '')
  if (root === '') return true
  const dir = cwd.replace(/\/+$/, '')
  return dir === root || dir.startsWith(`${root}/`)
}

// ---- text ----

// Newlines and runs of blanks become one space, so a one-line cell never grows a second line.
export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const wideCell = (c: number) =>
  (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
  (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)

const zeroCell = (c: number) =>
  (c >= 0x300 && c <= 0x36f) || (c >= 0x1ab0 && c <= 0x1aff) || (c >= 0x1dc0 && c <= 0x1dff) || (c >= 0x200b && c <= 0x200f) ||
  (c >= 0x2060 && c <= 0x2064) || (c >= 0x20d0 && c <= 0x20ff) || (c >= 0xfe00 && c <= 0xfe0f) || c === 0xfeff || (c >= 0xe0100 && c <= 0xe01ef)

// Terminal cells of a string: CJK, fullwidth and emoji count 2; combining and zero-width marks 0.
export function cellWidth(text: string): number {
  let w = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    w += zeroCell(c) ? 0 : wideCell(c) ? 2 : 1
  }
  return w
}

// Cut to at most `max` cells, ending in "…" when cut.
export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  if (cellWidth(text) <= max) return text
  let out = ''
  let w = 0
  for (const ch of text) {
    const cw = cellWidth(ch)
    if (w + cw > max - 1) break
    out += ch
    w += cw
  }
  return `${out}…`
}

// How alerts and the detail page name an agent: `worker "Fix login…"`, the task on one line cut to ~8 cells; no task, just the type.
export const REF_CELLS = 8
export function agentRef(type: string, task: string, t: Pick<Strings, 'quote'>): string {
  const short = truncate(collapse(task), REF_CELLS)
  return short ? `${type}${t.quote(short)}` : type
}

// At most `max` characters, `…` when cut (a stored text, not a cell count).
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
}

// The first `n` non-empty lines of a text, each cut to `width` characters, joined by newlines.
export function firstLines(text: string, n: number, width = 200): string {
  return text.split('\n').map(l => l.trimEnd()).filter(l => l.trim() !== '').slice(0, n).map(l => clip(l, width)).join('\n')
}

export const padEnd = (text: string, width: number) => text + ' '.repeat(Math.max(0, width - cellWidth(text)))
export const padStart = (text: string, width: number) => ' '.repeat(Math.max(0, width - cellWidth(text))) + text

// ---- model / effort ----

// Effort -> low | medium | high. Numbers are thinking-token budgets.
export function effortName(effort: string | number | undefined): string | undefined {
  if (effort === undefined) return undefined
  if (typeof effort === 'number') return effort < 2048 ? 'low' : effort < 16000 ? 'medium' : 'high'
  if (effort === 'low' || effort === 'medium') return effort
  return effort === 'high' || effort === 'xhigh' || effort === 'max' ? 'high' : undefined
}

// Effort -> low | med | high.
export function effortLabel(effort: string | number | undefined): string | undefined {
  const n = effortName(effort)
  return n ? EFFORT_SHORT[n] : undefined
}

// "claude-opus-4-5" -> "opus"; unknown -> undefined.
export function modelName(model: string | undefined): string | undefined {
  const id = (model ?? '').toLowerCase()
  return MODEL_ABBR.find(([name]) => id.includes(name))?.[0]
}

// "claude-opus-4-5" + "high" -> "op.high"; unknown model -> undefined; no effort -> bare "op".
export function tierFromModel(model: string | undefined, effort?: string | number): string | undefined {
  const name = modelName(model)
  if (!name) return undefined
  const abbr = MODEL_ABBR.find(([n]) => n === name)?.[1]
  const eff = effortLabel(effort)
  return eff ? `${abbr}.${eff}` : abbr
}

// "so.med · task" -> { tier: 'so.med', task: 'task' }; no prefix -> tier undefined. Task is whitespace-collapsed.
export function parseDescription(desc: string): { tier?: string; task: string } {
  const m = /^\s*((?:so|op|ha|fa)\.(?:low|med|high))\s*[·•|:-]\s*(.*)$/s.exec(desc)
  return m ? { tier: m[1], task: collapse(m[2] ?? '') } : { task: collapse(desc) }
}

// Model and effort as full words. The real step wins; the description prefix fills what the step has not said.
export function resolveTier(model: string | undefined, effort: string | number | undefined, desc: string): { model?: string; effort?: string } {
  const prefix = /^(so|op|ha|fa)\.(low|med|high)$/.exec(parseDescription(desc).tier ?? '')
  const fromPrefix = prefix ? MODEL_ABBR.find(([, a]) => a === prefix[1])?.[0] : undefined
  const effFromPrefix = prefix ? (prefix[2] === 'med' ? 'medium' : prefix[2]) : undefined
  return { model: modelName(model) ?? fromPrefix, effort: effortName(effort) ?? effFromPrefix }
}

// Real model+effort wins; then the description prefix; else an em dash.
export function tierLabel(model: string | undefined, effort: string | number | undefined, desc: string): string {
  const r = resolveTier(model, effort, desc)
  if (!r.model) return '—'
  const abbr = MODEL_ABBR.find(([n]) => n === r.model)?.[1]
  return r.effort ? `${abbr}.${EFFORT_SHORT[r.effort]}` : (abbr ?? '—')
}

// `sonnet.med`: full model word, a dot and the short effort; unknown effort -> bare `sonnet`; unknown model -> an em dash.
// Real model+effort wins; the description prefix fills what the step has not said (as resolveTier).
export function tierName(model: string | undefined, effort: string | number | undefined, desc: string): string {
  const r = resolveTier(model, effort, desc)
  if (!r.model) return '—'
  return r.effort ? `${r.model}.${EFFORT_SHORT[r.effort]}` : r.model
}

// ---- numbers ----

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

// A token figure, or an em dash when unknown or still 0.
export function tokensOrDash(n: number | undefined): string {
  return n && n > 0 ? formatTokens(n) : '—'
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`
}

// Elapsed time as `m:ss` (`1:05`), `h:mm:ss` from an hour on: the time of the rows and the live band.
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const ss = String(s % 60).padStart(2, '0')
  const m = Math.floor(s / 60)
  return m < 60 ? `${m}:${ss}` : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${ss}`
}

// The context window of a model id: 1M when the id names it (`[1m]`), else 200k.
export const contextWindow = (model: string | undefined): number => (/\[1m\]/i.test(model ?? '') ? 1_000_000 : 200_000)

// How full the context is, in whole percent (at most 100); undefined when nothing is known.
export function ctxPercent(context: number | undefined, model: string | undefined): number | undefined {
  return context && context > 0 ? Math.min(100, Math.round((context * 100) / contextWindow(model))) : undefined
}

// Local wall-clock time as HH:MM:SS.
export function formatClock(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, '0')).join(':')
}

export type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number }

// Context of one request: input + cache. Add that same step's output for the running figure; never sum outputs across steps.
export function contextTokens(u: Usage): number {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

// ---- tool activity ----

const base = (p: unknown) => String(p ?? '').split('/').filter(Boolean).pop() ?? ''
const host = (u: unknown) => {
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(String(u ?? ''))
  return m?.[1] ?? String(u ?? '')
}
const one = (v: unknown) => collapse(String(v ?? ''))

// Verb (in the UI language) + short target for a tool call, on one line. `input` is the call's arguments.
export function activityText(tool: string, input: Record<string, unknown>, t: Pick<Strings, 'verb'>): string {
  const v = t.verb[tool === 'MultiEdit' ? 'Edit' : tool] ?? tool
  switch (tool) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write': return `${v} ${base(input.file_path)}`
    case 'Grep': return `${v} "${truncate(one(input.pattern), 24)}"`
    case 'Glob': return `${v} ${one(input.pattern)}`
    case 'Bash': return `${v} ${truncate(one(input.description || input.command), 24)}`
    case 'WebFetch': return `${v} ${host(input.url)}`
    case 'WebSearch': return `${v} "${truncate(one(input.query), 24)}"`
    case 'Skill': return `${v} ${one(input.skill)}`
    case 'Agent': return `${v} ${one(input.subagent_type ?? 'general-purpose')}`
    case 'LSP': return v
    default: return tool
  }
}

// An Agent result's toolStats as per-tool counts (what a backfilled agent has instead of its tool.call stream); zero counts left out.
export type ToolStats = { readCount?: number; searchCount?: number; bashCount?: number; editFileCount?: number; otherToolCount?: number }
export function countsFromStats(s: ToolStats): Record<string, number> {
  const all: [string, number | undefined][] = [['Read', s.readCount], ['Search', s.searchCount], ['Bash', s.bashCount], ['Edit', s.editFileCount], ['Other', s.otherToolCount]]
  return Object.fromEntries(all.filter((e): e is [string, number] => (e[1] ?? 0) > 0))
}

// Fit task and activity into `columns`; the fixed parts and stats are never cut.
export function fitRow(columns: number, fixedWidth: number, task: string, activity: string): { task: string; activity: string } {
  const room = Math.max(0, columns - fixedWidth - 3 /* gap */ - 3 /* gap */)
  const actW = Math.min(cellWidth(activity), Math.floor(room / 2))
  const taskW = Math.max(0, room - actW)
  const t = truncate(task, taskW)
  const a = truncate(activity, Math.max(0, room - cellWidth(t)))
  return { task: t, activity: a }
}

// Band: how many agent rows fit `maxRows`; when some do not, one row is the "+N more" summary.
export function capRows(count: number, maxRows: number): { shown: number; hidden: number } {
  if (count <= maxRows) return { shown: count, hidden: 0 }
  const shown = Math.max(0, maxRows - 1)
  return { shown, hidden: count - shown }
}

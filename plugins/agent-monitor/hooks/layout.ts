// History-table layout for agent-monitor: column widths, row cells, header, the row-select marker. Pure; tested in layout.test.ts.
import { flagSegs, segsWidth } from './alertlines'
import type { Seg } from './alertlines'
import { ALL_COLUMNS } from './config'
import type { Columns } from './config'
import { formatMoney, totalCost } from './cost'
import { cellWidth, ctxPercent, effortLabel, effortName, formatDuration, formatElapsed, modelName, padEnd, padStart, parseDescription, resolveTier, tokensOrDash, truncate } from './logic'
import { PALETTE } from './palette'
import type { Status, View } from './views'

export const GLYPH: Record<Status, string> = { running: '◐', done: '●', failed: '✗', unknown: '?' }

// ---- the figures every row shows, one formatting for band, running rows and the finished table ----

// The parts of `ctx% · tokens · $` and the time, an em dash for each one unknown.
export function figures(v: View): { ctx: string; tokens: string; money: string; time: string } {
  const pct = ctxPercent(v.context, v.actualModel ?? v.model)
  return { ctx: pct === undefined ? '—' : `${pct}%`, tokens: tokensOrDash(v.tokens), money: formatMoney(v.cost), time: v.elapsedMs === undefined ? '—' : formatElapsed(v.elapsedMs) }
}

// `41% · 86.2k · $0.42`: the cost cell of the finished table.
export const costText = (v: View): string => { const f = figures(v); return `${f.ctx} · ${f.tokens} · ${f.money}` }
// `41% · 86.2k · $0.42 · 1:05`: the stats of a running row and of the live band.
export const statsText = (v: View): string => `${costText(v)} · ${figures(v).time}`

// ---- running rows: three lines ----

export const BAR_W = 10

// Line 1: the description with its tier prefix (`op.med · task`), or the bare task; line 2: type, model and effort the steps ran on.
export function runningText(v: View): { desc: string; model: string; modelKey?: string; effort: string; effortKey?: string } {
  const p = parseDescription(v.desc)
  const task = p.task || v.task || '—'
  const model = modelName(v.actualModel ?? v.model)
  const effort = effortName(v.actualEffort ?? v.effort)
  return { desc: p.tier ? `${p.tier} · ${task}` : task, model: model ?? '—', modelKey: model, effort: effortLabel(effort) ?? '—', effortKey: effort }
}

// The context-fill bar of line 3: `fill` + `empty` cells = BAR_W, `pct` undefined when the fill is unknown (all empty).
export function ctxBar(v: View): { fill: number; empty: number; pct?: number } {
  const pct = ctxPercent(v.context, v.actualModel ?? v.model)
  const fill = pct === undefined ? 0 : Math.round((pct * BAR_W) / 100)
  return { fill, empty: BAR_W - fill, pct }
}
const GAP = 2
const LEAD = 1
const MARK_W = 1 // the select Button at the row start: `▸` on the selected row, a blank elsewhere
export const MARK = '▸'
export const NO_MARK = ' '
const STATUS_W = 6 // 'Status'
const TYPE_CAP = 14

// `model` and `effort` are the two halves of the Tier cell (`sonnet` + `.med`), each colored by its own key; `bad` paints both red.
export type RowText = {
  status: Status; glyph: string; type: string
  model: string; modelKey?: string; effort: string; effortKey?: string
  task: string; edits: string; rounds: string; tokens: string; time: string; tokN: number
  alerts: Seg[]; bad: boolean
}

export function rowText(v: View): RowText {
  const t = resolveTier(v.model, v.effort, v.desc)
  const eff = effortLabel(t.effort)
  return {
    status: v.status,
    glyph: GLYPH[v.status],
    type: v.type,
    model: t.model ?? '—',
    modelKey: t.model,
    effort: eff ? `.${eff}` : '',
    effortKey: t.effort,
    task: v.task || '—',
    edits: v.editCount > 0 ? String(v.editCount) : '—',
    rounds: v.rounds === undefined ? '—' : String(v.rounds),
    tokens: tokensOrDash(v.tokens),
    time: v.elapsedMs === undefined ? '—' : formatDuration(v.elapsedMs),
    tokN: v.tokens ?? 0,
    alerts: flagSegs(v),
    bad: v.tier !== undefined,
  }
}

// Widths in cells; 0 = the column is off (hidden by the settings, or dropped for width).
export type Layout = { status: number; type: number; tier: number; task: number; edits: number; rounds: number; tokens: number; time: number; alerts: number }
export type Cell = { text: string; kind: 'index' | 'status' | 'type' | 'model' | 'effort' | 'task' | 'edits' | 'rounds' | 'tokens' | 'time' | 'alerts'; status?: Status; key?: string; n?: number; bad?: boolean; color?: string }

const maxW = (min: number, items: string[]) => items.reduce((m, s) => Math.max(m, cellWidth(s)), min)

// Column widths for `cols` cells. The task column takes what the others leave and goes first (width 0: no column at all); when the
// rest alone does not fit, Edits is dropped, then Type shrinks. Alerts and the stats (rounds, tokens, time) are never cut for width;
// only the settings hide them.
export function computeLayout(cols: number, rows: RowText[], on: Columns = ALL_COLUMNS): Layout {
  const w = (shown: boolean, min: number, f: (r: RowText) => string) => (shown ? maxW(min, rows.map(f)) : 0)
  const tier = w(on.tier, 4, r => r.model + r.effort)
  const rounds = w(on.rounds, 6, r => r.rounds)
  const tokens = w(on.tokens, 6, r => r.tokens)
  const time = w(on.time, 4, r => r.time)
  const alerts = on.alerts ? rows.reduce((m, r) => Math.max(m, segsWidth(r.alerts)), 6) : 0
  let edits = w(on.edits, 5, r => r.edits)
  let type = Math.min(TYPE_CAP, maxW(4, rows.map(r => r.type)))
  // Everything but task: the select mark, status and type are always there; a gap sits between neighbours and none after the last.
  const rest = (t: number, e: number) => LEAD + MARK_W + STATUS_W + t + tier + e + rounds + tokens + time + alerts + GAP * ([tier, e, rounds, tokens, time, alerts].filter(x => x > 0).length + 2)
  if (rest(type, edits) > cols) edits = 0
  while (type > 4 && rest(type, edits) > cols) type--
  return { status: STATUS_W, type, tier, task: Math.max(0, cols - rest(type, edits) - GAP), edits, rounds, tokens, time, alerts }
}

// Cells of one row, each column padded to its width; a gap follows every column but the last.
export function rowCells(l: Layout, r: RowText): Cell[] {
  const columns: Cell[][] = [
    [{ text: ' '.repeat(LEAD + MARK_W), kind: 'index' }], // lead + mark blanks; the Button draws the mark
    [{ text: padEnd(r.glyph, l.status), kind: 'status', status: r.status }],
    [{ text: padEnd(truncate(r.type, l.type), l.type), kind: 'type', key: r.type }],
  ]
  if (l.tier > 0) columns.push([{ text: r.model, kind: 'model', key: r.modelKey, bad: r.bad }, { text: padEnd(r.effort, l.tier - cellWidth(r.model)), kind: 'effort', key: r.effortKey, bad: r.bad }])
  if (l.task > 0) columns.push([{ text: padEnd(truncate(r.task, l.task), l.task), kind: 'task', status: r.status }])
  if (l.edits > 0) columns.push([{ text: padStart(r.edits, l.edits), kind: 'edits' }])
  if (l.rounds > 0) columns.push([{ text: padStart(r.rounds, l.rounds), kind: 'rounds' }])
  if (l.tokens > 0) columns.push([{ text: padStart(r.tokens, l.tokens), kind: 'tokens', n: r.tokN }])
  if (l.time > 0) columns.push([{ text: padStart(r.time, l.time), kind: 'time' }])
  if (l.alerts > 0) columns.push([...r.alerts.map(s => ({ text: s.text, kind: 'alerts' as const, color: s.color })), { text: ' '.repeat(Math.max(0, l.alerts - segsWidth(r.alerts))), kind: 'alerts' as const }])
  const g = ' '.repeat(GAP)
  return columns.flatMap((cells, i) => (i === columns.length - 1 ? cells : cells.map((c, j) => (j === cells.length - 1 ? { ...c, text: c.text + g } : c))))
}

// A row split around its select Button: the lead blank, then the other cells (gap first); the Button's 1-cell label sits between.
// With the blank label, lead + label + rest are exactly rowCells.
export function rowParts(l: Layout, r: RowText): { lead: string; rest: Cell[] } {
  return { lead: ' '.repeat(LEAD), rest: [{ text: ' '.repeat(GAP), kind: 'index' }, ...rowCells(l, r).slice(1)] }
}

// The select Button's label; the row is selected iff the focus ring (`ringKey`) sits on its `row:<id>` element.
export const isSelected = (ringKey: string | null, id: string): boolean => ringKey === `row:${id}`
export const markLabel = (selected: boolean): string => (selected ? MARK : NO_MARK)

// The column-header row (drawn gray), same widths as the rows.
export function headerCells(l: Layout): Cell[] {
  return rowCells(l, { status: 'done', glyph: 'Status', type: 'Type', model: 'Tier', effort: '', task: 'Task', edits: 'Edits', rounds: 'Rounds', tokens: 'Tokens', time: 'Time', tokN: 0, alerts: [{ text: 'Alerts', color: PALETTE.gray }], bad: false })
}

export type HeaderSeg = { text: string; color: string; bold?: boolean }

const GROUPS = [
  { status: 'running', label: 'running', color: PALETTE.amber },
  { status: 'done', label: 'done', color: PALETTE.green },
  { status: 'failed', label: 'failed', color: PALETTE.red },
] as const

// `Subagents · this session   N total   ◐ a running   ● b done   ✗ c failed      Σ X tok · ≈ $ · time`; Σ sits at the right edge and is never cut.
// When the line is too narrow the left side sheds parts: zero counts first, then the "this session" tail, the total, the rest.
export function headerSegs(cols: number, views: View[]): HeaderSeg[] {
  const count = (s: Status) => views.filter(v => v.status === s).length
  const tok = views.reduce((n, v) => n + (v.tokens ?? 0), 0)
  const ms = views.reduce((n, v) => n + (v.elapsedMs ?? 0), 0)
  const usd = totalCost(views.map(v => v.cost))
  const right = truncate(`Σ ${tokensOrDash(tok)} tok · ${usd === undefined ? '' : `≈ ${formatMoney(usd)} · `}${formatDuration(ms)}`, cols)
  const compose = (drop: ReadonlySet<string>): HeaderSeg[] => {
    const segs: HeaderSeg[] = [{ text: ' ', color: PALETTE.fg }, { text: drop.has('tail') ? 'Subagents' : 'Subagents · this session', color: PALETTE.fg, bold: true }]
    if (!drop.has('total')) segs.push({ text: `   ${views.length} total`, color: PALETTE.gray })
    for (const g of GROUPS) {
      if (!drop.has(g.status)) segs.push({ text: '   ', color: PALETTE.fg }, { text: `${GLYPH[g.status]} ${count(g.status)} ${g.label}`, color: g.color })
    }
    return segs
  }
  const width = (segs: HeaderSeg[]) => segs.reduce((n, s) => n + cellWidth(s.text), 0)
  const order = [...[...GROUPS].reverse().filter(g => count(g.status) === 0).map(g => g.status as string), 'tail', 'total', 'done', 'failed', 'running']
  const drop = new Set<string>()
  let segs = compose(drop)
  for (const d of order) {
    if (width(segs) + 2 + cellWidth(right) <= cols) break
    drop.add(d)
    segs = compose(drop)
  }
  segs.push({ text: ' '.repeat(Math.max(1, cols - width(segs) - cellWidth(right))), color: PALETTE.fg }, { text: right, color: PALETTE.fg })
  return segs
}

export const rule = (cols: number) => '─'.repeat(Math.max(0, cols))

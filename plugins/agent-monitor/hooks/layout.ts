// Row layout for agent-monitor: the shared figures (`ctx% · tokens · $ · m:ss`), the three-line running row's texts, the finished table's
// column widths, row cells and header, the panel header, the row-select marker. Pure; tested in layout.test.ts.
import { ALERT_MARK, alerted } from './alertlines'
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

// ---- the finished table: `# desc type tier cost time` ----

const GAP = 2
const LEAD = 1
const MARK_W = 1 // the select Button at the row start: `▸` on the selected row, a blank elsewhere
export const MARK = '▸'
export const NO_MARK = ' '
const STATUS_W = 1 // `#`: the status glyph
const TYPE_CAP = 14
const DOT = ' · '

// `model` and `effort` are the two halves of the tier cell (`sonnet` + `.med`), each colored by its own key; `bad` paints both red.
// `ctx`, `tokens`, `money`: the three parts of the cost cell, written `41% · 86.2k · $0.42`.
export type RowText = {
  status: Status; glyph: string; type: string
  model: string; modelKey?: string; effort: string; effortKey?: string
  task: string; ctx: string; tokens: string; money: string; time: string; tokN: number; bad: boolean; alert: boolean
}

export function rowText(v: View): RowText {
  const t = resolveTier(v.model, v.effort, v.desc)
  const eff = effortLabel(t.effort)
  const f = figures(v)
  return {
    status: v.status,
    glyph: GLYPH[v.status],
    type: v.type,
    model: t.model ?? '—',
    modelKey: t.model,
    effort: eff ? `.${eff}` : '',
    effortKey: t.effort,
    task: v.task || '—',
    ctx: f.ctx,
    tokens: f.tokens,
    money: f.money,
    time: f.time,
    tokN: v.tokens ?? 0,
    bad: v.tier !== undefined,
    alert: alerted(v),
  }
}

// Widths in cells; 0 = the column is off (hidden by the settings, or no room). `alert`: 1 when some row has an alert (its red `!` ends
// the row), else 0.
export type Layout = { status: number; task: number; type: number; tier: number; cost: number; time: number; alert: number }
export type Cell = { text: string; kind: 'index' | 'status' | 'task' | 'type' | 'model' | 'effort' | 'cost' | 'tokens' | 'time' | 'alert'; status?: Status; key?: string; n?: number; bad?: boolean; color?: string }

const maxW = (min: number, items: string[]) => items.reduce((m, s) => Math.max(m, cellWidth(s)), min)

// Column widths for `cols` cells. The desc column takes what the others leave (width 0: no column at all); when the rest alone does not
// fit, type shrinks. Tier, cost and time are never cut for width; only the settings hide them (`tokens` hides the cost column).
export function computeLayout(cols: number, rows: RowText[], on: Columns = ALL_COLUMNS): Layout {
  const tier = on.tier ? maxW(4, rows.map(r => r.model + r.effort)) : 0
  const cost = on.tokens ? maxW(4, rows.map(r => r.ctx + DOT + r.tokens + DOT + r.money)) : 0
  const time = on.time ? maxW(4, rows.map(r => r.time)) : 0
  let type = Math.min(TYPE_CAP, maxW(4, rows.map(r => r.type)))
  // Everything but desc: the select mark, status and type are always there; a gap sits between neighbours and none after the last.
  const alert = on.alerts && rows.some(r => r.alert) ? 1 : 0
  const rest = (t: number) => LEAD + MARK_W + STATUS_W + t + tier + cost + time + alert + GAP * ([tier, cost, time, alert].filter(x => x > 0).length + 2)
  while (type > 4 && rest(type) > cols) type--
  return { status: STATUS_W, task: Math.max(0, cols - rest(type) - GAP), type, tier, cost, time, alert }
}

// The cells of a row (or, `header`, of the column header), each column padded to its width; a gap follows every column but the last.
function cells(l: Layout, r: RowText, header?: { cost: string }): Cell[] {
  const columns: Cell[][] = [
    [{ text: ' '.repeat(LEAD + MARK_W), kind: 'index' }], // lead + mark blanks; the Button draws the mark
    [{ text: padEnd(r.glyph, l.status), kind: 'status', status: r.status }],
  ]
  if (l.task > 0) columns.push([{ text: padEnd(truncate(r.task, l.task), l.task), kind: 'task', status: r.status }])
  columns.push([{ text: padEnd(truncate(r.type, l.type), l.type), kind: 'type', key: r.type }])
  if (l.tier > 0) columns.push([{ text: r.model, kind: 'model', key: r.modelKey, bad: r.bad }, { text: padEnd(r.effort, l.tier - cellWidth(r.model)), kind: 'effort', key: r.effortKey, bad: r.bad }])
  if (l.cost > 0) {
    columns.push(header
      ? [{ text: padEnd(header.cost, l.cost), kind: 'cost' }]
      : [
          { text: r.ctx + DOT, kind: 'cost' },
          { text: r.tokens, kind: 'tokens', n: r.tokN },
          { text: padEnd(DOT + r.money, l.cost - cellWidth(r.ctx + DOT) - cellWidth(r.tokens)), kind: 'cost' },
        ])
  }
  if (l.time > 0) columns.push([{ text: padStart(r.time, l.time), kind: 'time' }])
  if (l.alert > 0) columns.push([r.alert ? { text: ALERT_MARK.text, kind: 'alert', color: ALERT_MARK.color } : { text: ' ', kind: 'alert' }])
  const g = ' '.repeat(GAP)
  return columns.flatMap((cs, i) => (i === columns.length - 1 ? cs : cs.map((c, j) => (j === cs.length - 1 ? { ...c, text: c.text + g } : c))))
}

export const rowCells = (l: Layout, r: RowText): Cell[] => cells(l, r)

// A row split around its select Button: the lead blank, then the other cells (gap first); the Button's 1-cell label sits between.
// With the blank label, lead + label + rest are exactly rowCells.
export function rowParts(l: Layout, r: RowText): { lead: string; rest: Cell[] } {
  return { lead: ' '.repeat(LEAD), rest: [{ text: ' '.repeat(GAP), kind: 'index' }, ...rowCells(l, r).slice(1)] }
}

// The select Button's label; the row is selected iff the focus ring (`ringKey`) sits on its `row:<id>` element.
export const isSelected = (ringKey: string | null, id: string): boolean => ringKey === `row:${id}`
export const markLabel = (selected: boolean): string => (selected ? MARK : NO_MARK)

// The column-header row (drawn gray), same widths as the rows; the names stay English in both languages.
export function headerCells(l: Layout): Cell[] {
  return cells(l, { status: 'done', glyph: '#', type: 'type', model: 'tier', effort: '', task: 'desc', ctx: '', tokens: '', money: '', time: 'time', tokN: 0, bad: false, alert: false }, { cost: 'cost' })
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

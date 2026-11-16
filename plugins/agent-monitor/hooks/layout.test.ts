import { test, expect } from 'claude-code/testing'

import { ALL_COLUMNS } from './config'
import { view } from './fixture'
import { computeLayout, costText, ctxBar, headerCells, headerSegs, isSelected, markLabel, rowCells, rowParts, rowText, runningText, statsText } from './layout'
import { cellWidth } from './logic'
import { PALETTE } from './palette'
import type { View } from './views'

const sample = (over: Partial<View> = {}): View =>
  view({ id: 'x', type: 'worker', task: '实现子代理实时监控条带 mod', desc: 'so.med · x', status: 'running', model: 'claude-sonnet-5-5', effort: 'medium', rounds: 17, tokens: 67800, elapsedMs: 128000, ...over })

const kinds = (cells: { kind: string }[]) => [...new Set(cells.map(c => c.kind))]
const joined = (cells: { text: string }[]) => cells.map(c => c.text).join('')

test('figures: `ctx% · tokens · $` for the table, `· m:ss` added for running rows and the band, a dash for each unknown', () => {
  expect(costText(sample({ context: 82_000, tokens: 86_200, cost: 0.42 }))).toBe('41% · 86.2k · $0.42')
  expect(statsText(sample({ context: 82_000, tokens: 86_200, cost: 0.42, elapsedMs: 65_000 }))).toBe('41% · 86.2k · $0.42 · 1:05')
  expect(statsText(sample({ context: undefined, tokens: undefined, cost: undefined, elapsedMs: undefined }))).toBe('— · — · — · —')
  // a 1M-context model fills a fifth as fast
  expect(costText(sample({ context: 200_000, model: 'claude-opus-5-5[1m]', tokens: 1, cost: 0 }))).toBe('20% · 1 · $0.00')
})

test('running row texts: tier-prefixed description; model and effort the steps ran on; the context bar', () => {
  expect(runningText(sample({ desc: 'op.med · fix  the\nparser' })).desc).toBe('op.med · fix the parser')
  expect(runningText(sample({ desc: 'fix the parser', task: 'fix the parser' })).desc).toBe('fix the parser')
  const r = runningText(sample({ model: 'claude-opus-5-5', actualModel: 'claude-sonnet-5-5', actualEffort: 'high' }))
  expect([r.model, r.effort]).toEqual(['sonnet', 'high'])
  expect(runningText(sample({ model: undefined, effort: undefined })).effort).toBe('—')
  expect(ctxBar(sample({ context: 82_000 }))).toEqual({ fill: 4, empty: 6, pct: 41 })
  expect(ctxBar(sample({ context: undefined }))).toEqual({ fill: 0, empty: 10, pct: undefined })
})

test('layout: every row and header fits the width; tier, cost and time never cut', () => {
  for (const cols of [60, 79, 80, 100, 160]) {
    const rows = [sample({ denied: 2 }), sample({ status: 'done', type: 'a-very-long-agent-type-name', tokens: undefined, elapsedMs: undefined }), sample({ task: 'x'.repeat(200) })].map(rowText)
    const l = computeLayout(cols, rows)
    for (const r of [...rows.map(r => rowCells(l, r)), headerCells(l)]) {
      expect(r.reduce((n, c) => n + cellWidth(c.text), 0)).toBeLessThanOrEqual(cols)
    }
    const text = joined(rowCells(l, rows[0]!))
    expect(text.trimEnd().endsWith('2:08  !')).toBe(true)
    expect(text).toContain('67.8k')
    expect(text).toContain('sonnet.med')
    expect(joined(headerCells(l))).toContain('cost')
  }
})

test('layout: columns `# desc type tier cost time`, tier one cell of model and effort', () => {
  const rows = [sample()].map(rowText)
  const l = computeLayout(100, rows)
  expect(kinds(rowCells(l, rows[0]!))).toEqual(['index', 'status', 'task', 'type', 'model', 'effort', 'cost', 'tokens', 'time'])
  const tier = rowCells(l, rows[0]!).filter(c => c.kind === 'model' || c.kind === 'effort')
  expect(tier.map(c => c.text.trim())).toEqual(['sonnet', '.med'])
  expect(joined(headerCells(l)).split(/\s+/).filter(Boolean)).toEqual(['#', 'desc', 'type', 'tier', 'cost', 'time'])
})

test('rowText: tier name forms', () => {
  expect([rowText(sample()).model, rowText(sample()).effort]).toEqual(['sonnet', '.med'])
  expect(rowText(sample({ model: 'claude-opus-4', effort: 'high' })).effort).toBe('.high')
  expect(rowText(sample({ model: 'claude-haiku-4', effort: undefined, desc: 'x' })).effort).toBe('') // unknown effort: just the model
  expect(rowText(sample({ model: undefined, effort: undefined, desc: 'x' })).model).toBe('—')
})

test('layout: desc flexes; rows are equally wide; the cost cell reads `ctx% · tokens · $`, padded at its end', () => {
  const rows = [sample({ context: 150_000, tokens: 162_000, cost: 12.5 }), sample({ context: 900, tokens: 940, cost: 0.01, elapsedMs: 9000 }), sample({ tokens: undefined })].map(rowText)
  const l = computeLayout(100, rows)
  const texts = rows.map(r => joined(rowCells(l, r)))
  expect(texts.map(cellWidth)).toEqual([100, 100, 100])
  expect(texts[0]).toContain('75% · 162.0k · $12.50  2:08')
  expect(texts[1]).toContain('0% · 940 · $0.01       0:09') // 5 cells short of the widest cost, then the gap and the right-aligned time
  const start = (s: string, part: string) => s.indexOf(part)
  expect(start(texts[0]!, '75%')).toBe(start(texts[1]!, '0%'))
})

test('layout: narrow cuts desc first, then type shrinks; tier, cost and time stay', () => {
  const rows = [sample({ type: 'general-purpose' })].map(rowText)
  const at = (cols: number) => kinds(rowCells(computeLayout(cols, rows), rows[0]!))
  expect(at(120)).toContain('task')
  for (const cols of [50, 40]) {
    const k = at(cols)
    expect(k).not.toContain('task')
    for (const must of ['model', 'cost', 'time']) expect(k).toContain(must)
  }
  expect(computeLayout(40, rows).type).toBeLessThan(computeLayout(120, rows).type)
})

test('layout: settings hide columns; the rest still fill the width', () => {
  const rows = [sample({ denied: 1 })].map(rowText)
  const hide = (over: Partial<typeof ALL_COLUMNS>) => {
    const l = computeLayout(100, rows, { ...ALL_COLUMNS, ...over })
    return { l, row: rowCells(l, rows[0]!), head: joined(headerCells(l)) }
  }
  const noTime = hide({ time: false })
  expect(noTime.head).not.toContain('time')
  expect(noTime.head).toContain('cost')
  expect(cellWidth(joined(noTime.row))).toBe(100)
  const noCost = hide({ cost: false })
  expect(noCost.head).not.toContain('cost')
  expect(kinds(noCost.row)).not.toContain('tokens')
  const noTier = hide({ tier: false })
  expect(kinds(noTier.row)).not.toContain('model')
  expect(noTier.head).not.toContain('tier')
  const bare = hide({ tier: false, cost: false, time: false, alerts: false })
  expect(kinds(bare.row)).toEqual(['index', 'status', 'task', 'type'])
  expect(cellWidth(joined(bare.row))).toBe(100)
  expect(cellWidth(joined(bare.row))).toBe(cellWidth(joined(headerCells(bare.l))))
})

test('alert column: a red `!` ends only an alerted row; no column when no row has an alert or the setting hides it', () => {
  const clean = sample()
  const alertedRows = [sample({ stall: { level: 1, idleMs: 1 } }), sample({ clashes: [{ path: '/a', other: 'y' }] }), sample({ tier: { want: 'a', got: 'b', model: true, effort: false } }), sample({ denied: 1 })]
  for (const a of alertedRows) {
    const rows = [rowText(a), rowText(clean)]
    const l = computeLayout(100, rows)
    const [hit, quiet] = rows.map(r => rowCells(l, r).at(-1)!)
    expect([hit!.text, hit!.color]).toEqual(['!', PALETTE.red])
    expect(quiet!.text).toBe(' ')
  }
  expect(computeLayout(100, [rowText(clean)]).alert).toBe(0)
  expect(computeLayout(100, [rowText(sample({ denied: 1 }))], { ...ALL_COLUMNS, alerts: false }).alert).toBe(0)
})

test('headerSegs: counts, totals at the right edge', () => {
  const views = [sample(), sample({ status: 'done', tokens: 1000, elapsedMs: 2000 }), sample({ status: 'failed', tokens: undefined })]
  const segs = headerSegs(100, views)
  const line = segs.map(s => s.text).join('')
  expect(line).toContain('Subagents · this session   3 total')
  expect(line).toContain('◐ 1 running   ● 1 done   ✗ 1 failed')
  expect(line).toContain('Σ ')
  expect(line.endsWith('Σ 68.8k tok · 2m10s')).toBe(false) // failed row has elapsed too: 128+2+128 s
  expect(line.endsWith('4m18s')).toBe(true)
  expect(cellWidth(line)).toBe(100)
})

test('header row colors', () => {
  const segs = headerSegs(100, [sample(), sample({ status: 'done' }), sample({ status: 'failed' })])
  expect(segs.filter(s => s.color !== PALETTE.fg && s.color !== PALETTE.gray).map(s => [s.text, s.color])).toEqual([['◐ 1 running', PALETTE.amber], ['● 1 done', PALETTE.green], ['✗ 1 failed', PALETTE.red]])
  expect(segs.filter(s => s.bold).map(s => s.text)).toEqual(['Subagents · this session'])
  expect(segs.find(s => s.text.endsWith(' total'))!.color).toBe(PALETTE.gray)
  expect(segs.at(-1)!.color).toBe(PALETTE.fg)
})

test('row cells carry the keys and colors the drawing looks up', () => {
  const l = computeLayout(100, [rowText(sample())])
  const cells = rowCells(l, rowText(sample({ tokens: 150000, status: 'failed' })))
  expect(cells.find(c => c.kind === 'tokens')!.n).toBe(150000)
  expect(cells.find(c => c.kind === 'task')!.status).toBe('failed')
  expect(cells.find(c => c.kind === 'type')!.key).toBe('worker')
  expect(cells.find(c => c.kind === 'model')!.key).toBe('sonnet')
  expect(cells.find(c => c.kind === 'effort')!.key).toBe('medium')
  expect(cells.some(c => c.bad)).toBe(false)
  // a tier mismatch paints the whole tier cell
  const bad = rowCells(l, rowText(sample({ tier: { want: 'ha.low', got: 'sonnet.med', model: true, effort: true } })))
  expect(bad.filter(c => c.kind === 'model' || c.kind === 'effort').every(c => c.bad)).toBe(true)
})

test('headerSegs: narrow line sheds zero counts first and never cuts the totals', () => {
  const views = [sample(), sample({ tokens: 1000, elapsedMs: 2000 })] // both running: no done, no failed
  const right = 'Σ 68.8k tok · 2m10s'
  const wide = headerSegs(100, views).map(s => s.text).join('')
  expect(wide).toContain('0 done')
  for (const cols of [90, 70, 60, 50, 40, 30]) {
    const line = headerSegs(cols, views).map(s => s.text).join('')
    expect(line.endsWith(right)).toBe(true)
    expect(cellWidth(line)).toBeLessThanOrEqual(cols)
  }
  const mid = headerSegs(62, views).map(s => s.text).join('') // 62: zero counts must go, the live count stays
  expect(mid).not.toContain('done')
  expect(mid).not.toContain('failed')
  expect(mid).toContain('2 running')
  const tiny = headerSegs(40, [sample(), sample({ status: 'failed' }), sample({ status: 'done' })]).map(s => s.text).join('')
  expect(tiny.endsWith('Σ 203.4k tok · 6m24s')).toBe(true)
})

test('row Button layout: lead + 1-cell mark + the other cells are exactly the row, widths unchanged', () => {
  for (const cols of [60, 80, 120]) {
    const views = [sample({ denied: 1 }), sample({ status: 'done', task: 'x'.repeat(100) }), ...Array.from({ length: 9 }, () => sample())]
    const rows = views.map(rowText)
    const l = computeLayout(cols, rows)
    for (const r of rows) {
      const p = rowParts(l, r)
      const whole = rowCells(l, r).map(c => c.text).join('')
      expect(p.lead + markLabel(false) + p.rest.map(c => c.text).join('')).toBe(whole)
      expect(cellWidth(p.lead + markLabel(true) + p.rest.map(c => c.text).join(''))).toBe(cellWidth(whole)) // `▸` is as wide as the blank
      expect(cellWidth(whole)).toBeLessThanOrEqual(cols)
    }
  }
})

test('the `#` column is the status glyph, never a row number: the row count never widens the prefix', () => {
  const few = [sample()].map(rowText)
  const many = Array.from({ length: 12 }, () => sample()).map(rowText)
  expect(joined(headerCells(computeLayout(100, many))).trimStart().startsWith('#  desc')).toBe(true)
  expect(computeLayout(100, many).task).toBe(computeLayout(100, few).task) // 12 rows take no more width than 1
  expect(joined(rowCells(computeLayout(100, many), many[0]!)).trimStart().startsWith('◐')).toBe(true)
})

test('selection: selected iff the ring is on that row; the ring on `close` (or nowhere) selects none', () => {
  const ids = ['a', 'b', 'c']
  const picked = (ring: string | null) => ids.filter(id => isSelected(ring, id))
  expect(picked('row:b')).toEqual(['b'])
  expect(picked('close')).toEqual([])
  expect(picked(null)).toEqual([])
  expect(picked('row:zzz')).toEqual([])
  expect(markLabel(true)).toBe('▸')
  expect(markLabel(false)).toBe(' ')
})

test('done status renders as a filled circle ●, never ✓', () => {
  const l = computeLayout(100, [rowText(sample({ status: 'done' }))])
  const row = joined(rowCells(l, rowText(sample({ status: 'done' }))))
  expect(row).toContain('●')
  const all = [row, headerSegs(100, [sample({ status: 'done' })]).map(s => s.text).join('')]
  for (const s of all) expect(s).not.toContain('✓')
})

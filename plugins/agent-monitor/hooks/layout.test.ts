import { test, expect } from 'claude-code/testing'

import { ALL_COLUMNS } from './config'
import { view } from './fixture'
import { computeLayout, headerCells, headerSegs, isSelected, markLabel, rowCells, rowParts, rowText } from './layout'
import { cellWidth } from './logic'
import { PALETTE } from './palette'
import type { View } from './views'

const sample = (over: Partial<View> = {}): View =>
  view({ id: 'x', type: 'worker', task: '实现子代理实时监控条带 mod', desc: 'so.med · x', status: 'running', model: 'claude-sonnet-5-5', effort: 'medium', rounds: 17, tokens: 67800, elapsedMs: 128000, ...over })

const kinds = (cells: { kind: string }[]) => [...new Set(cells.map(c => c.kind))]
const joined = (cells: { text: string }[]) => cells.map(c => c.text).join('')

test('layout: every row and header fits the width; stats and alerts never cut', () => {
  for (const cols of [60, 79, 80, 100, 160]) {
    const rows = [sample({ denied: 2 }), sample({ status: 'done', type: 'a-very-long-agent-type-name', rounds: undefined, tokens: undefined, elapsedMs: undefined }), sample({ task: 'x'.repeat(200) })].map(rowText)
    const l = computeLayout(cols, rows)
    for (const r of [...rows.map(r => rowCells(l, r)), headerCells(l)]) {
      expect(r.reduce((n, c) => n + cellWidth(c.text), 0)).toBeLessThanOrEqual(cols)
    }
    const text = joined(rowCells(l, rows[0]!))
    expect(text.trimEnd().endsWith('×2')).toBe(true)
    expect(text).toContain('2m08s')
    expect(text).toContain('67.8k')
    expect(joined(headerCells(l))).toContain('Alerts')
  }
})

test('layout: select mark first, Tier merged, Edits before Rounds, Alerts last', () => {
  const rows = [sample()].map(rowText)
  const l = computeLayout(100, rows)
  expect(kinds(rowCells(l, rows[0]!))).toEqual(['index', 'status', 'type', 'model', 'effort', 'task', 'edits', 'rounds', 'tokens', 'time', 'alerts'])
  const tier = rowCells(l, rows[0]!).filter(c => c.kind === 'model' || c.kind === 'effort')
  expect(tier.map(c => c.text.trim())).toEqual(['sonnet', '.med'])
  expect(joined(headerCells(l)).split(/\s+/).filter(Boolean)).toEqual(['Status', 'Type', 'Tier', 'Task', 'Edits', 'Rounds', 'Tokens', 'Time', 'Alerts'])
})

test('rowText: tier name forms', () => {
  expect([rowText(sample()).model, rowText(sample()).effort]).toEqual(['sonnet', '.med'])
  expect(rowText(sample({ model: 'claude-opus-4', effort: 'high' })).effort).toBe('.high')
  expect(rowText(sample({ model: 'claude-haiku-4', effort: undefined, desc: 'x' })).effort).toBe('') // unknown effort: just the model
  expect(rowText(sample({ model: undefined, effort: undefined, desc: 'x' })).model).toBe('—')
  expect(rowText(sample({ editCount: 3 })).edits).toBe('3')
  expect(rowText(sample()).edits).toBe('—')
})

test('layout: task column flexes and aligns the stats block', () => {
  const rows = [sample(), sample({ rounds: 3, tokens: 5100, elapsedMs: 12000, denied: 12 })].map(rowText)
  const l = computeLayout(100, rows)
  const [r1, r2] = rows.map(r => joined(rowCells(l, r)))
  expect(cellWidth(r1!)).toBe(cellWidth(r2!))
  expect(cellWidth(r1!)).toBe(100)
  expect(rowText(sample({ rounds: undefined, tokens: undefined, elapsedMs: undefined })).rounds).toBe('—')
})

test('layout: narrow cuts Task first, then Edits, never Alerts or the stats', () => {
  const rows = [sample({ editCount: 2 })].map(rowText)
  const at = (cols: number) => kinds(rowCells(computeLayout(cols, rows), rows[0]!))
  expect(at(120)).toContain('task')
  expect(at(79)).toContain('task')
  expect(at(79)).toContain('edits')
  for (const cols of [70, 60]) {
    const k = at(cols)
    expect(k).not.toContain('task')
    for (const must of ['rounds', 'tokens', 'time', 'alerts']) expect(k).toContain(must)
  }
  expect(at(60)).not.toContain('edits')
  expect(computeLayout(79, rows).task).toBeGreaterThan(0)
})

test('layout: settings hide columns; the rest still fill the width', () => {
  const rows = [sample({ denied: 1 })].map(rowText)
  const hide = (over: Partial<typeof ALL_COLUMNS>) => {
    const l = computeLayout(100, rows, { ...ALL_COLUMNS, ...over })
    return { l, row: rowCells(l, rows[0]!), head: joined(headerCells(l)) }
  }
  const noRounds = hide({ rounds: false, time: false })
  expect(noRounds.head).not.toContain('Rounds')
  expect(noRounds.head).not.toContain('Time')
  expect(noRounds.head).toContain('Tokens')
  expect(cellWidth(joined(noRounds.row))).toBe(100)
  const noAlerts = hide({ alerts: false })
  expect(kinds(noAlerts.row).at(-1)).toBe('time')
  expect(noAlerts.head).not.toContain('Alerts')
  expect(cellWidth(joined(noAlerts.row))).toBe(100)
  const noTier = hide({ tier: false })
  expect(kinds(noTier.row)).not.toContain('model')
  expect(noTier.head).not.toContain('Tier')
  const noEdits = hide({ edits: false })
  expect(noEdits.head).not.toContain('Edits')
  const bare = hide({ tier: false, edits: false, rounds: false, tokens: false, time: false, alerts: false })
  expect(kinds(bare.row)).toEqual(['index', 'status', 'type', 'task'])
  expect(cellWidth(joined(bare.row))).toBe(100)
  expect(cellWidth(joined(bare.row))).toBe(cellWidth(joined(headerCells(bare.l))))
})

test('headerSegs: counts, totals at the right edge', () => {
  const views = [sample(), sample({ status: 'done', tokens: 1000, elapsedMs: 2000 }), sample({ status: 'failed', tokens: undefined })]
  const segs = headerSegs(100, views)
  const line = segs.map(s => s.text).join('')
  expect(line).toContain('Subagents · this session   3 total')
  expect(line).toContain('◐ 1 running   ✓ 1 done   ✗ 1 failed')
  expect(line).toContain('Σ ')
  expect(line.endsWith('Σ 68.8k tok · 2m10s')).toBe(false) // failed row has elapsed too: 128+2+128 s
  expect(line.endsWith('4m18s')).toBe(true)
  expect(cellWidth(line)).toBe(100)
})

test('header row colors', () => {
  const segs = headerSegs(100, [sample(), sample({ status: 'done' }), sample({ status: 'failed' })])
  expect(segs.filter(s => s.color !== PALETTE.fg && s.color !== PALETTE.gray).map(s => [s.text, s.color])).toEqual([['◐ 1 running', PALETTE.amber], ['✓ 1 done', PALETTE.green], ['✗ 1 failed', PALETTE.red]])
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
  // a tier mismatch paints the whole Tier cell; alert glyphs carry their own colors
  const bad = rowCells(l, rowText(sample({ tier: { want: 'ha.low', got: 'sonnet.med', model: true, effort: true }, clashes: [{ path: '/a', other: 'y' }], denied: 3 })))
  expect(bad.filter(c => c.kind === 'model' || c.kind === 'effort').every(c => c.bad)).toBe(true)
  expect(bad.filter(c => c.kind === 'alerts' && c.color && c.text.trim()).map(c => [c.text, c.color])).toEqual([['!', PALETTE.red], ['≠', PALETTE.red], ['×3', PALETTE.red]])
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

test('no `#` column: no number in the header or the rows, the row count never widens the prefix', () => {
  const few = [sample()].map(rowText)
  const many = Array.from({ length: 12 }, () => sample()).map(rowText)
  expect('n' in few[0]!).toBe(false)
  expect(joined(headerCells(computeLayout(100, many)))).not.toContain('#')
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

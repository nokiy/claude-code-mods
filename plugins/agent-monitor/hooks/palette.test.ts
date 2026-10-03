import { test, expect } from 'claude-code/testing'

import { PALETTE as P, alertColor, effortStyle, modelColor, statusColor, tokenColor, typeStyle } from './palette'

test('statusColor: glyph colors', () => {
  expect([statusColor('running'), statusColor('done'), statusColor('failed'), statusColor('unknown')]).toEqual([P.amber, P.green, P.red, P.gray])
})

test('typeStyle: named types colored, the rest fg, always bold', () => {
  const named: [string, string][] = [['worker', P.blue], ['worker-hard', P.purple], ['Explore', P.cyan], ['researcher', P.green], ['reviewer', P.amber], ['sketch', P.orange], ['merger', P.fg]]
  for (const [t, c] of named) expect(typeStyle(t)).toEqual({ color: c, bold: true })
  for (const t of ['general-purpose', 'claude-code-guide', 'Plan', '—', 'zzz']) expect(typeStyle(t)).toEqual({ color: P.fg, bold: true })
})

test('modelColor: by model, unknown gray', () => {
  expect(['opus', 'sonnet', 'haiku', 'fable', '—', undefined].map(modelColor)).toEqual([P.purple, P.blue, P.cyan, P.amber, P.gray, P.gray])
})

test('effortStyle: low gray, medium fg, high amber bold', () => {
  expect(effortStyle('low')).toEqual({ color: P.gray })
  expect(effortStyle('medium')).toEqual({ color: P.fg })
  expect(effortStyle('high')).toEqual({ color: P.amber, bold: true })
  expect(effortStyle('—')).toEqual({ color: P.gray })
})

test('tokenColor: thresholds at 50k / 100k / 300k', () => {
  expect([undefined, 0, 49_900, 50_000, 99_999, 100_000, 299_999, 300_000].map(tokenColor)).toEqual([P.gray, P.gray, P.gray, P.fg, P.fg, P.amber, P.amber, P.red])
})

test('alertColor: red, except a stall at its threshold which is amber', () => {
  expect([alertColor('conflict'), alertColor('tier'), alertColor('denied')]).toEqual([P.red, P.red, P.red])
  expect([alertColor('stall', 1), alertColor('stall', 2), alertColor('stall')]).toEqual([P.amber, P.red, P.amber])
})

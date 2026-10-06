import { test, expect } from 'claude-code/testing'

import { DEFAULTS, readConfig } from './config'
import { DEFAULT_PRICES } from './cost'

test('readConfig: defaults when nothing is set', () => {
  expect(readConfig({})).toEqual(DEFAULTS)
  expect(DEFAULTS.stallMs).toBe(180_000)
  expect(DEFAULTS.scope).toBe('')
  expect(DEFAULTS.placement).toBe('last')
  expect(DEFAULTS.columns).toEqual({ tier: true, tokens: true, time: true, alerts: true })
})

test('readConfig: values map to the settings', () => {
  const c = readConfig({ stallMinutes: 5, autoBand: false, alertsBlock: false, toasts: false, defaultPlacement: 'top', colTier: false, colTokens: false, colTime: false, colAlerts: false })
  expect(c).toEqual({ scope: '', stallMs: 300_000, autoBand: false, alertsBlock: false, toasts: false, placement: 'top', columns: { tier: false, tokens: false, time: false, alerts: false }, prices: DEFAULT_PRICES, pricesBad: false })
  expect(readConfig({ stallMinutes: 0.5 }).stallMs).toBe(30_000)
})

test('readConfig: a value of the wrong type falls back', () => {
  const c = readConfig({ stallMinutes: -1, autoBand: 'no', defaultPlacement: 'left', colTier: 0 })
  expect(c).toEqual(DEFAULTS)
  expect(readConfig({ stallMinutes: Number.NaN }).stallMs).toBe(180_000)
  expect(readConfig({ stallMinutes: '5' }).stallMs).toBe(180_000)
})

test('readConfig: the default placement is last, right or top; anything else is last', () => {
  for (const p of ['last', 'right', 'top'] as const) expect(readConfig({ defaultPlacement: p }).placement).toBe(p)
  for (const p of ['left', '', 3, undefined, null]) expect(readConfig({ defaultPlacement: p }).placement).toBe('last')
})

test('readConfig: prices JSON overrides per family; bad JSON keeps the defaults and is flagged', () => {
  const c = readConfig({ prices: '{"sonnet":[3,3.75,0.3,15]}' })
  expect(c.prices.sonnet).toEqual([3, 3.75, 0.3, 15])
  expect(c.prices.opus).toEqual(DEFAULT_PRICES.opus)
  expect(c.pricesBad).toBe(false)
  expect(readConfig({ prices: '{oops' })).toMatchObject({ prices: DEFAULT_PRICES, pricesBad: true })
})

test('readConfig: scope is trimmed text; empty or a wrong type means everywhere', () => {
  expect(readConfig({ scope: '  /work/proj ' }).scope).toBe('/work/proj')
  expect(readConfig({ scope: '' }).scope).toBe('')
  for (const v of [3, true, null, undefined]) expect(readConfig({ scope: v }).scope).toBe('')
})

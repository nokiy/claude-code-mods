// The mod's settings: plugin.json `userConfig` fields as `register(on, options)` hands them over. Pure; tested in config.test.ts.
import { DEFAULT_STALL_MS } from './alerts'
import { DEFAULT_PRICES, parsePrices } from './cost'
import type { Prices } from './cost'

// Table columns the user can hide (# Status Type Task are always there).
export type Columns = { tier: boolean; edits: boolean; rounds: boolean; tokens: boolean; time: boolean; alerts: boolean }
// `last`: /sub opens where it was last put (and remembers a /sub top|right); `right` / `top`: that place at every session start.
export type PlacementMode = 'last' | 'right' | 'top'
export type Config = { scope: string; stallMs: number; autoBand: boolean; alertsBlock: boolean; toasts: boolean; placement: PlacementMode; columns: Columns; prices: Prices; pricesBad: boolean }

export const ALL_COLUMNS: Columns = { tier: true, edits: true, rounds: true, tokens: true, time: true, alerts: true }
export const DEFAULTS: Config = { scope: '', stallMs: DEFAULT_STALL_MS, autoBand: true, alertsBlock: true, toasts: true, placement: 'last', columns: ALL_COLUMNS, prices: DEFAULT_PRICES, pricesBad: false }

type Options = Readonly<Record<string, unknown>>
const flag = (o: Options, key: string): boolean => {
  const v = o[key]
  return typeof v === 'boolean' ? v : true
}

// A value not of its declared type (a stall that is not above zero included) falls back to its default.
export function readConfig(o: Options): Config {
  const minutes = o.stallMinutes
  const { prices, bad } = parsePrices(o.prices)
  return {
    scope: typeof o.scope === 'string' ? o.scope.trim() : '',
    stallMs: typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : DEFAULT_STALL_MS,
    autoBand: flag(o, 'autoBand'),
    alertsBlock: flag(o, 'alertsBlock'),
    toasts: flag(o, 'toasts'),
    placement: o.defaultPlacement === 'top' || o.defaultPlacement === 'right' ? o.defaultPlacement : 'last',
    columns: { tier: flag(o, 'colTier'), edits: flag(o, 'colEdits'), rounds: flag(o, 'colRounds'), tokens: flag(o, 'colTokens'), time: flag(o, 'colTime'), alerts: flag(o, 'colAlerts') },
    prices,
    pricesBad: bad,
  }
}

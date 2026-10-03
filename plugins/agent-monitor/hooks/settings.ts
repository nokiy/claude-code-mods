// The settings page: the draft of the options, its diff against the saved ones (the config writes), and the row texts. Pure; tested in settings.test.ts.
import type { AgentMonitorDraft } from '../types'
import type { Columns, Config, PlacementMode } from './config'
import type { NavPatch } from './nav'
import { padEnd } from './logic'
import type { Strings } from './strings'

export type Draft = AgentMonitorDraft
export type SettingKey = keyof Draft
export type Write = { field: string; value: boolean | number | string }

export const COLUMNS: (keyof Columns)[] = ['tier', 'edits', 'rounds', 'tokens', 'time', 'alerts']
export const STALL_STEPS = [1, 2, 3, 5, 10]
export const PLACEMENTS: PlacementMode[] = ['last', 'right', 'top']

// The userConfig field (plugin.json) behind each row.
export const FIELD: Record<SettingKey, string> = {
  tier: 'colTier', edits: 'colEdits', rounds: 'colRounds', tokens: 'colTokens', time: 'colTime', alerts: 'colAlerts',
  alertsBlock: 'alertsBlock', autoBand: 'autoBand', toasts: 'toasts', placement: 'defaultPlacement', stallMinutes: 'stallMinutes',
}

type Row = { key: SettingKey; name: string }

// Row order as the page draws it: the six columns, then the switches, then the two pickers.
export const ROWS: Row[] = [
  { key: 'tier', name: 'Tier' },
  { key: 'edits', name: 'Edits' },
  { key: 'rounds', name: 'Rounds' },
  { key: 'tokens', name: 'Tokens' },
  { key: 'time', name: 'Time' },
  { key: 'alerts', name: 'Alerts' },
  { key: 'alertsBlock', name: 'Alerts block' },
  { key: 'autoBand', name: 'Live band' },
  { key: 'toasts', name: 'Toasts' },
  { key: 'placement', name: 'Placement' },
  { key: 'stallMinutes', name: 'Stall' },
]

export const draftFromConfig = (c: Config): Draft => ({ ...c.columns, alertsBlock: c.alertsBlock, autoBand: c.autoBand, toasts: c.toasts, placement: c.placement, stallMinutes: c.stallMs / 60_000 })

const next = <T>(list: readonly T[], cur: T): T => list[(list.indexOf(cur) + 1) % list.length]!

// Enter on a row: a flag flips, the placement cycles last → right → top, the stall threshold steps through STALL_STEPS (a value off the list steps to the next larger one).
export function toggleDraft(d: Draft, k: SettingKey): Draft {
  if (k === 'placement') return { ...d, placement: next(PLACEMENTS, d.placement) }
  if (k === 'stallMinutes') return { ...d, stallMinutes: STALL_STEPS.find(m => m > d.stallMinutes + 1e-9) ?? STALL_STEPS[0]! }
  return { ...d, [k]: !d[k] }
}

// The config writes that take the saved options to the draft: one per changed row, in row order.
export function diffDraft(d: Draft, c: Config): Write[] {
  const was = draftFromConfig(c)
  return ROWS.filter(r => (r.key === 'stallMinutes' ? Math.abs(d.stallMinutes - was.stallMinutes) > 1e-9 : d[r.key] !== was[r.key])).map(r => ({ field: FIELD[r.key], value: d[r.key] }))
}

export const isDirty = (d: Draft, c: Config): boolean => diffDraft(d, c).length > 0

// The draft a page change leaves behind: the settings page keeps its own, a fresh visit starts from the saved options, any other page has none.
export function draftFor(page: { kind: string }, prev: { kind: string }, draft: Draft | null, c: Config): Draft | null {
  if (page.kind !== 'settings') return null
  return prev.kind === 'settings' && draft ? draft : draftFromConfig(c)
}

// Saving: the config writes and the panel's state after them. The page goes back to the table with the draft dropped, and a changed
// default placement ends this session's override, since the person just chose.
export function saveEffects(d: Draft | null, c: Config): { writes: Write[]; nav: NavPatch } {
  const writes = d ? diffDraft(d, c) : []
  return { writes, nav: { page: 'list', draft: null, ...(writes.some(w => w.field === FIELD.placement) ? { session: null } : {}) } }
}

const NAME_W = 13

// `[x] Tier          model.effort column`; a picker shows its value instead of the box: `[right] Placement ...`.
export function rowLabel(r: Row, d: Draft, t: Pick<Strings, 'gloss'>): string {
  const v = d[r.key]
  const mark = typeof v === 'boolean' ? (v ? '[x]' : '[ ]') : r.key === 'stallMinutes' ? `[${v}m]` : `[${v}]`
  return `${padEnd(mark, 7)}${padEnd(r.name, NAME_W)}${t.gloss[r.key] ?? ''}`
}

// The row key of a userConfig field among `$.config.list()`'s rows (`<plugin>.<field>`); the plain form when the list does not name it.
export function configKey(rows: readonly { key: string }[], field: string): string {
  return rows.find(r => r.key.startsWith('agent-monitor') && r.key.endsWith(`.${field}`))?.key ?? `agent-monitor.${field}`
}

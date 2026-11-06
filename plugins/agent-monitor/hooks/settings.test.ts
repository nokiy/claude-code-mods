import { test, expect } from 'claude-code/testing'

import { DEFAULTS, readConfig } from './config'
import type { Config } from './config'
import { FIELD, ROWS, STALL_STEPS, configKey, diffDraft, draftFor, draftFromConfig, isDirty, rowLabel, saveEffects, toggleDraft } from './settings'
import { strings } from './strings'

const pluginJson = { fields: ['stallMinutes', 'autoBand', 'alertsBlock', 'toasts', 'defaultPlacement', 'colTier', 'colTokens', 'colTime', 'colAlerts'] }

test('every row maps to one of the plugin.json fields, each field to one row', () => {
  expect(ROWS.map(r => FIELD[r.key]).sort()).toEqual([...pluginJson.fields].sort())
})

test('a draft copied from the config is clean; each toggle makes exactly its own write', () => {
  const d = draftFromConfig(DEFAULTS)
  expect(isDirty(d, DEFAULTS)).toBe(false)
  expect(diffDraft(d, DEFAULTS)).toEqual([])
  expect(diffDraft(toggleDraft(d, 'tier'), DEFAULTS)).toEqual([{ field: 'colTier', value: false }])
  expect(diffDraft(toggleDraft(d, 'alertsBlock'), DEFAULTS)).toEqual([{ field: 'alertsBlock', value: false }])
  expect(diffDraft(toggleDraft(d, 'autoBand'), DEFAULTS)).toEqual([{ field: 'autoBand', value: false }])
  expect(diffDraft(toggleDraft(d, 'toasts'), DEFAULTS)).toEqual([{ field: 'toasts', value: false }])
  for (const k of ['tier', 'cost', 'time', 'alerts'] as const) expect(diffDraft(toggleDraft(d, k), DEFAULTS)).toEqual([{ field: FIELD[k], value: false }])
})

test('toggling twice is no change; several changed rows are written together, in row order', () => {
  const d = draftFromConfig(DEFAULTS)
  expect(diffDraft(toggleDraft(toggleDraft(d, 'time'), 'time'), DEFAULTS)).toEqual([])
  const many = toggleDraft(toggleDraft(toggleDraft(toggleDraft(d, 'alerts'), 'tier'), 'toasts'), 'placement')
  expect(diffDraft(many, DEFAULTS)).toEqual([{ field: 'colTier', value: false }, { field: 'colAlerts', value: false }, { field: 'toasts', value: false }, { field: 'defaultPlacement', value: 'right' }])
  expect(isDirty(many, DEFAULTS)).toBe(true)
})

test('placement cycles last, right, top and around; the stall threshold steps through 1 2 3 5 10', () => {
  let d = draftFromConfig(DEFAULTS)
  const seen = [d.placement]
  for (let i = 0; i < 3; i++) seen.push((d = toggleDraft(d, 'placement')).placement)
  expect(seen).toEqual(['last', 'right', 'top', 'last'])
  d = draftFromConfig(DEFAULTS) // 3 minutes
  const stalls = [d.stallMinutes]
  for (let i = 0; i < 4; i++) stalls.push((d = toggleDraft(d, 'stallMinutes')).stallMinutes)
  expect(stalls).toEqual([3, 5, 10, 1, 2])
  expect(STALL_STEPS).toEqual([1, 2, 3, 5, 10])
  expect(toggleDraft({ ...draftFromConfig(DEFAULTS), stallMinutes: 0.5 }, 'stallMinutes').stallMinutes).toBe(1) // off the list: the next larger
  expect(diffDraft({ ...draftFromConfig(DEFAULTS), stallMinutes: 5 }, DEFAULTS)).toEqual([{ field: 'stallMinutes', value: 5 }])
})

test('saved options that are already off or odd read back as a clean draft', () => {
  const cfg: Config = readConfig({ stallMinutes: 0.5, colTier: false, defaultPlacement: 'top', toasts: false })
  const d = draftFromConfig(cfg)
  expect(d).toMatchObject({ tier: false, placement: 'top', toasts: false, stallMinutes: 0.5 })
  expect(isDirty(d, cfg)).toBe(false)
  expect(diffDraft(toggleDraft(d, 'tier'), cfg)).toEqual([{ field: 'colTier', value: true }])
})

test('saveEffects: the writes, the page back to the table, the draft gone; a changed default placement ends the session override', () => {
  const d = draftFromConfig(DEFAULTS)
  expect(saveEffects(d, DEFAULTS)).toEqual({ writes: [], nav: { page: 'list', draft: null } })
  expect(saveEffects(null, DEFAULTS)).toEqual({ writes: [], nav: { page: 'list', draft: null } })
  const t = toggleDraft(d, 'tier')
  expect(saveEffects(t, DEFAULTS)).toEqual({ writes: [{ field: 'colTier', value: false }], nav: { page: 'list', draft: null } })
  expect(saveEffects(toggleDraft(d, 'placement'), DEFAULTS).nav).toEqual({ page: 'list', draft: null, session: null })
})

test('draftFor: the settings page keeps its own draft, a fresh visit copies the config, other pages hold none', () => {
  const kept = toggleDraft(draftFromConfig(DEFAULTS), 'time')
  expect(draftFor({ kind: 'settings' }, { kind: 'settings' }, kept, DEFAULTS)).toBe(kept)
  expect(draftFor({ kind: 'settings' }, { kind: 'list' }, kept, DEFAULTS)).toEqual(draftFromConfig(DEFAULTS))
  expect(draftFor({ kind: 'settings' }, { kind: 'settings' }, null, DEFAULTS)).toEqual(draftFromConfig(DEFAULTS))
  expect(draftFor({ kind: 'list' }, { kind: 'settings' }, kept, DEFAULTS)).toBeNull()
  expect(draftFor({ kind: 'detail' }, { kind: 'settings' }, kept, DEFAULTS)).toBeNull()
})

test('row labels: a box or the picked value, the English name, the Chinese gloss', () => {
  const d = draftFromConfig(DEFAULTS)
  const label = (key: string, dd = d, lang: 'en' | 'zh' = 'zh') => rowLabel(ROWS.find(r => r.key === key)!, dd, strings(lang))
  expect(label('tier')).toBe('[x]    Tier         模型.档位列')
  expect(label('tier', toggleDraft(d, 'tier'))).toBe('[ ]    Tier         模型.档位列')
  expect(label('placement')).toBe('[last] Placement    默认位置：last 沿用上次 / right / top')
  expect(label('stallMinutes')).toBe('[3m]   Stall        卡住阈值（分钟）')
  expect(label('tier', d, 'en')).toBe('[x]    Tier         model.effort column')
  expect(label('placement', d, 'en')).toBe('[last] Placement    default place: last = as before / right / top')
  expect(ROWS.map(r => r.key)).not.toContain('task')
})

test('configKey: the list names the row; else the plain plugin.field form', () => {
  const rows = [{ key: 'theme' }, { key: 'agent-monitor.colTier' }, { key: 'other.colTier' }]
  expect(configKey(rows, 'colTier')).toBe('agent-monitor.colTier')
  expect(configKey([{ key: 'agent-monitor@inline.toasts' }], 'toasts')).toBe('agent-monitor@inline.toasts')
  expect(configKey([], 'toasts')).toBe('agent-monitor.toasts')
})

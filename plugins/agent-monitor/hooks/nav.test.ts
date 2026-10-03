import { test, expect } from 'claude-code/testing'

import { DEFAULTS } from './config'
import type { Config } from './config'
import { CLOSED, LIST, USAGE, effectivePlacement, navReduce, pageStr, parsePage, planSub, placementWrite, siteFlags, subEffects, ringKeyOf } from './nav'
import type { Page, SubCtx } from './nav'
import { draftFromConfig } from './settings'
import { parseSubArg } from './subarg'

const detail: Page = { kind: 'detail', id: 'a1' }
const ctx = (over: Partial<SubCtx> = {}): SubCtx => ({ pane: false, band: false, page: LIST, mode: 'right', session: null, last: undefined, ...over })
const up = { pane: true } // the pane is up (right); `{ band: true }` is the band (top)

test('pages: the state string round-trips; anything else reads as the list', () => {
  for (const p of [LIST, detail, { kind: 'settings' } as Page]) expect(parsePage(pageStr(p))).toEqual(p)
  expect(pageStr(detail)).toBe('detail:a1')
  for (const junk of [undefined, '', 'detail:', 'nope', 'settings2']) expect(parsePage(junk)).toEqual(LIST)
})

test('navReduce: list to detail to settings, back always lands on the list', () => {
  expect(navReduce(LIST, { t: 'detail', id: 'a1' })).toEqual(detail)
  expect(navReduce(detail, { t: 'back' })).toEqual(LIST)
  expect(navReduce(LIST, { t: 'settings' })).toEqual({ kind: 'settings' })
  expect(navReduce({ kind: 'settings' }, { t: 'back' })).toEqual(LIST)
  expect(navReduce(LIST, { t: 'back' })).toEqual(LIST)
  expect(navReduce(detail, { t: 'settings' })).toEqual({ kind: 'settings' })
})

test('placement precedence: a fixed default holds unless this session overrode it; `last` follows the stored choice', () => {
  expect(effectivePlacement('right', null, undefined)).toBe('right')
  expect(effectivePlacement('top', null, 'right')).toBe('top') // the stored choice does not touch a fixed default
  expect(effectivePlacement('right', 'top', undefined)).toBe('top') // session override beats the config default
  expect(effectivePlacement('top', 'right', 'top')).toBe('right')
  expect(effectivePlacement('last', null, undefined)).toBe('right') // nothing chosen yet
  expect(effectivePlacement('last', null, 'top')).toBe('top')
  expect(effectivePlacement('last', 'right', 'top')).toBe('top') // a stale session value is not read in `last` mode
})

test('/sub top|right: remembered across sessions in `last` mode, session-only in a fixed mode', () => {
  expect(placementWrite('last', 'top')).toEqual({ last: 'top' })
  expect(placementWrite('right', 'top')).toEqual({ session: 'top' })
  expect(placementWrite('top', 'right')).toEqual({ session: 'right' })
})

test('planSub: `/sub` opens at the effective placement on the table; from detail or settings it steps back; from the table it closes', () => {
  const show = (page: Page, where: 'top' | 'right', fresh: boolean) => ({ kind: 'show', page, where, fresh })
  expect(planSub(parseSubArg(''), ctx())).toEqual(show(LIST, 'right', true))
  expect(planSub(parseSubArg(''), ctx({ mode: 'top' }))).toEqual(show(LIST, 'top', true))
  expect(planSub(parseSubArg(''), ctx({ mode: 'last', last: 'top' }))).toEqual(show(LIST, 'top', true))
  expect(planSub(parseSubArg(''), ctx({ ...up, page: detail }))).toEqual(show(LIST, 'right', false))
  expect(planSub(parseSubArg(''), ctx({ band: true, page: { kind: 'settings' } }))).toEqual(show(LIST, 'top', false))
  expect(planSub(parseSubArg(''), ctx({ ...up }))).toEqual({ kind: 'close' })
  expect(planSub(parseSubArg(''), ctx({ band: true }))).toEqual({ kind: 'close' })
  expect(planSub(parseSubArg('x'), ctx())).toEqual({ kind: 'usage', text: USAGE })
})

test('planSub: `/sub set` goes to the settings page from anywhere, opening the panel when it was down', () => {
  expect(planSub(parseSubArg('set'), ctx())).toEqual({ kind: 'show', page: { kind: 'settings' }, where: 'right', fresh: true })
  expect(planSub(parseSubArg('set'), ctx({ band: true, page: detail }))).toEqual({ kind: 'show', page: { kind: 'settings' }, where: 'top', fresh: false })
})

test('planSub: `/sub top|right` moves the panel and records the placement by mode; the page stays when it was up', () => {
  expect(planSub(parseSubArg('top'), ctx({ ...up, page: detail }))).toEqual({ kind: 'show', page: detail, where: 'top', fresh: false, session: 'top' })
  expect(planSub(parseSubArg('right'), ctx({ mode: 'last', ...up }))).toEqual({ kind: 'show', page: LIST, where: 'right', fresh: false, last: 'right' })
  expect(planSub(parseSubArg('top'), ctx())).toEqual({ kind: 'show', page: LIST, where: 'top', fresh: true, session: 'top' })
})

test('subEffects: what is written, stored and moved', () => {
  const cfg: Config = { ...DEFAULTS, placement: 'right' }
  const base = { ...ctx(), draft: null, cfg }
  const open = subEffects(parseSubArg(''), base)
  expect(open).toEqual({ last: undefined, move: 'right', nav: { page: 'list', draft: null, session: undefined, focusKey: null, ringKey: null } })
  const set = subEffects(parseSubArg('set'), base)
  expect(set.nav).toMatchObject({ page: 'settings', draft: draftFromConfig(cfg), focusKey: null })
  const kept = draftFromConfig({ ...cfg, toasts: false })
  expect(subEffects(parseSubArg('set'), { ...base, ...up, page: { kind: 'settings' }, draft: kept }).nav.draft).toBe(kept) // already on the page: its draft stays
  expect(subEffects(parseSubArg('set'), { ...base, ...up, page: { kind: 'settings' }, draft: kept }).move).toBeUndefined() // and the panel stays where it is
  expect(subEffects(parseSubArg(''), { ...base, ...up, page: { kind: 'settings' }, draft: kept }).nav).toMatchObject({ page: 'list', draft: null }) // back drops the draft
  expect(subEffects(parseSubArg(''), { ...base, ...up })).toMatchObject({ close: true })
  expect(subEffects(parseSubArg('?'), base)).toMatchObject({ text: USAGE })
  expect(subEffects(parseSubArg('top'), { ...base, ...up, mode: 'last' })).toMatchObject({ last: 'top', move: 'top' })
  expect(subEffects(parseSubArg('right'), { ...base, ...up })).toMatchObject({ move: undefined, nav: { session: 'right' } }) // already there
})

test('site flags: one site up at a time, none after a close', () => {
  expect(siteFlags('top')).toEqual({ band: true, pane: false })
  expect(siteFlags('right')).toEqual({ band: false, pane: true })
  expect(siteFlags(null)).toEqual(CLOSED)
  expect(CLOSED).toMatchObject({ band: false, pane: false, page: 'list', draft: null, focusKey: null, ringKey: null })
})

test('ringKeyOf: the ring on a row, on our own `close`, or off every element', () => {
  expect(ringKeyOf({ element: 'row:a1', plugin: 'agent-monitor' })).toBe('row:a1')
  expect(ringKeyOf({ element: 'close', plugin: 'agent-monitor' })).toBe('close')
  expect(ringKeyOf({ element: 'row:a1' })).toBe('row:a1')
  expect(ringKeyOf({})).toBeNull() // an engine stop: no element
  expect(ringKeyOf({ element: 'row:a1', plugin: 'other' })).toBeNull() // another plugin's element is no row of ours
})

// Navigation of the /sub panel: which page shows, what `/sub` does from where, where the panel opens. Pure; tested in nav.test.ts.
import type { AgentMonitorDraft } from '../types'
import type { Config, PlacementMode } from './config'
import { draftFor } from './settings'
import type { SubArg } from './subarg'

export type Placement = 'top' | 'right'
export type Page = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'settings' }
export type NavAction = { t: 'detail'; id: string } | { t: 'settings' } | { t: 'back' }

export const LIST: Page = { kind: 'list' }
export const USAGE = 'Usage: /sub [top | right | set]'

// `$.state` keeps the page as a string: `list`, `settings`, `detail:<agentId>`; anything else reads as the list.
export function parsePage(s: string | undefined): Page {
  if (s === 'settings') return { kind: 'settings' }
  if (s?.startsWith('detail:') && s.length > 7) return { kind: 'detail', id: s.slice(7) }
  return LIST
}

export const pageStr = (p: Page): string => (p.kind === 'detail' ? `detail:${p.id}` : p.kind)

// A button's move: a row opens its detail, `s` the settings, `b` back to the list (from the list it stays).
export function navReduce(p: Page, a: NavAction): Page {
  if (a.t === 'detail') return { kind: 'detail', id: a.id }
  if (a.t === 'settings') return { kind: 'settings' }
  return p.kind === 'list' ? p : LIST
}

// Where `/sub` opens the panel. `last`: the place `/sub top|right` last chose (stored across sessions), `right` before any choice.
// A fixed mode (`right` | `top`): that place, unless `/sub top|right` overrode it for this session.
export function effectivePlacement(mode: PlacementMode, session: Placement | null | undefined, last: Placement | undefined): Placement {
  if (mode === 'last') return last ?? 'right'
  return session ?? mode
}

// What `/sub top|right` remembers: the stored `last` place in `last` mode, else only this session's override.
export const placementWrite = (mode: PlacementMode, where: Placement): { session?: Placement; last?: Placement } => (mode === 'last' ? { last: where } : { session: where })

// What a `/sub` run starts from: where the panel is up (the pane = right, the band = top flag), its page, the placement mode and memories.
// `last` is the stored value as read: anything but `top` / `right` is no memory.
export type SubCtx = { pane: boolean; band: boolean; page: Page; mode: PlacementMode; session: Placement | null; last: unknown }
export const siteOf = (c: { pane: boolean; band: boolean }): Placement | undefined => (c.pane ? 'right' : c.band ? 'top' : undefined)

// close the panel, or show `page` at `where`. `fresh`: it was closed, so the focus starts over. `session` / `last`: placement to remember.
export type SubPlan = { kind: 'close' } | { kind: 'show'; page: Page; where: Placement; fresh: boolean; session?: Placement; last?: Placement } | { kind: 'usage'; text: string }

export function planSub(a: SubArg, c: SubCtx): SubPlan {
  if (a.kind === 'bad') return { kind: 'usage', text: USAGE }
  const site = siteOf(c)
  const last = c.last === 'top' || c.last === 'right' ? c.last : undefined
  const where = site ?? effectivePlacement(c.mode, c.session, last)
  const fresh = site === undefined
  if (a.kind === 'toggle') {
    if (site !== undefined && c.page.kind === 'list') return { kind: 'close' }
    return { kind: 'show', page: fresh ? LIST : navReduce(c.page, { t: 'back' }), where, fresh }
  }
  if (a.kind === 'set') return { kind: 'show', page: { kind: 'settings' }, where, fresh }
  return { kind: 'show', page: fresh ? LIST : c.page, where: a.where, fresh, ...placementWrite(c.mode, a.where) }
}

// A write to the panel's state keys (null is a value for focusKey, ringKey, draft and session; a key left out is not touched).
export type NavPatch = { page?: string; focusKey?: string | null; ringKey?: string | null; draft?: AgentMonitorDraft | null; band?: boolean; pane?: boolean; session?: Placement | null }

export const CLOSED: NavPatch = { band: false, pane: false, page: 'list', draft: null, focusKey: null, ringKey: null }

// Where the ring is now, from a `ui.focus` event: the element's key when it is ours (or the site's own stop, `close`), null when it left every element.
/** The panel's element keys: `row:<agentId>` (an agent's select Button), `group:<groupKey>` (a PR group's toggle), `mode:<pr|agent>`. */
export type ElementKind = 'row' | 'group' | 'mode'
export const elementKey = (kind: ElementKind, id: string): string => `${kind}:${id}`
/** An element key split into its kind and id; undefined for any other key. */
export function parseElementKey(key: string | null | undefined): { kind: ElementKind; id: string } | undefined {
  const m = /^(row|group|mode):(.+)$/.exec(key ?? '')
  return m ? { kind: m[1] as ElementKind, id: m[2]! } : undefined
}
export const ringKeyOf =(e: { element?: string; plugin?: string }): string | null => (e.element !== undefined && (e.plugin === undefined || e.plugin === 'agent-monitor') ? e.element : null)

// Which site flag is set while the panel is at `where` (none: down, the table next time, no draft, no ring).
export const siteFlags = (where: Placement | null): NavPatch => (where ? { band: where === 'top', pane: where === 'right' } : CLOSED)

// What a `/sub` run does, ready to apply: text to answer, or the panel closes, or `nav` is written, `last` stored and the panel moved to `move`.
export type SubFx = { text?: string; close?: true; last?: Placement; move?: Placement; nav: NavPatch }

export function subEffects(a: SubArg, c: SubCtx & { draft: AgentMonitorDraft | null; cfg: Config }): SubFx {
  const plan = planSub(a, c)
  if (plan.kind === 'usage') return { text: plan.text, nav: {} }
  if (plan.kind === 'close') return { close: true, nav: {} }
  const nav: NavPatch = { page: pageStr(plan.page), draft: draftFor(plan.page, c.page, c.draft, c.cfg), session: plan.session, ...(plan.fresh ? { focusKey: null, ringKey: null } : {}) }
  return { last: plan.last, move: siteOf(c) === plan.where ? undefined : plan.where, nav }
}

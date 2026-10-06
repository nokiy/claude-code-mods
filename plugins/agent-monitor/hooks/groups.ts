// [POS] Per-PR grouping of agent-monitor: the views split by the PR each agent counts toward (attribution.ts), with each group's totals,
// the current branch's group first, Other last. Drawn by prtable.tsx; `statsByPr` turns the groups into the per-PR totals published
// for other mods (docs/adr/0001-cross-mod-state.md). Pure.
import type { PrStat } from '../types'
import { attribute } from './attribution'
import { spentTotal, totalCost } from './cost'
import type { PrEntry } from './prindex'
import type { View } from './views'

/**
 * One group: `key` is `pr:<n>` or `other`; `pr` absent for Other. Totals over its agents: `tokens` (every step's usage, input, output
 * and cache, added up; View.tokens where the split is unknown), `cost` (sum of known costs, undefined when none is known), `ms` (wall
 * time: the union of the agents' spans, so agents that ran at once count once), `refusals` (their refused or errored tool calls,
 * View.denied). The group row shows tokens, cost and time; the published value carries all four.
 */
export type Group = { key: string; pr?: PrEntry; views: View[]; tokens: number; cost?: number; ms: number; refusals: number }

export const OTHER_KEY = 'other'
export const groupKey = (pr: number | null): string => (pr === null ? OTHER_KEY : `pr:${pr}`)

// The length of the union of the agents' [start, start + elapsed] spans.
function wallTime(views: readonly View[]): number {
  const spans = views.flatMap(v => (v.startedAt === undefined ? [] : [[v.startedAt, v.startedAt + (v.elapsedMs ?? 0)] as const])).sort((a, b) => a[0] - b[0])
  let ms = 0
  let end = -Infinity
  for (const [s, e] of spans) if (e > end) { ms += e - Math.max(s, end); end = e }
  return ms
}

const group = (key: string, pr: PrEntry | undefined, views: View[]): Group => ({
  key, pr, views,
  tokens: views.reduce((n, v) => n + (v.spent ? spentTotal(v.spent) : (v.tokens ?? 0)), 0),
  cost: totalCost(views.map(v => v.cost)),
  ms: wallTime(views),
  refusals: views.reduce((n, v) => n + v.denied, 0),
})

/** The published per-PR totals: one entry per PR group with agents, keyed by the PR number; Other and empty groups give none. */
export function statsByPr(groups: readonly Group[]): Record<string, PrStat> {
  const out: Record<string, PrStat> = {}
  for (const g of groups) {
    if (g.pr && g.views.length > 0) out[String(g.pr.number)] = { tokens: g.tokens, ...(g.cost === undefined ? {} : { cost: g.cost }), ms: g.ms, refusals: g.refusals }
  }
  return out
}

/**
 * The views grouped by PR, each group's agents in the views' order. Order: the group of the current `branch` first (shown even with
 * no agents when it is a PR), then the PR groups by their newest agent (views come newest first), then Other. Empty groups are left out.
 */
export function groupByPr(views: readonly View[], index: readonly PrEntry[], branch?: string): Group[] {
  const byKey = new Map<string, View[]>()
  for (const v of views) {
    const k = groupKey(attribute(v, index))
    byKey.set(k, [...(byKey.get(k) ?? []), v])
  }
  const current = groupKey(attribute({ branch }, index))
  const keys = [...byKey.keys()].filter(k => k !== current && k !== OTHER_KEY)
  const order = [...(current !== OTHER_KEY || byKey.has(OTHER_KEY) ? [current] : []), ...keys, ...(current !== OTHER_KEY && byKey.has(OTHER_KEY) ? [OTHER_KEY] : [])]
  const prOf = (k: string) => index.find(p => groupKey(p.number) === k)
  return order.map(k => group(k, prOf(k), byKey.get(k) ?? []))
}

/** Whether a group shows its agents: the hand-set choice in `expanded`, else open only for the first group. */
export const isOpen = (key: string, groups: readonly Group[], expanded: Readonly<Record<string, boolean>> = {}): boolean =>
  expanded[key] ?? groups[0]?.key === key

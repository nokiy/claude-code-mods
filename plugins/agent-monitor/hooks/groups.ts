// [POS] Per-PR grouping of agent-monitor: the views split by the PR each agent counts toward (attribution.ts), with each group's totals,
// the current branch's group first, Other last. Drawn by prtable.tsx; meant to be reused for the per-PR totals other mods read. Pure.
import { attribute } from './attribution'
import { totalCost } from './cost'
import type { PrEntry } from './prindex'
import type { View } from './views'

/**
 * One group: `key` is `pr:<n>` or `other`; `pr` absent for Other. Totals over its agents: `tokens` (sum of View.tokens), `cost`
 * (sum of known costs, undefined when none is known), `ms` (sum of each agent's elapsed time, as the table header's Σ; not wall time).
 */
export type Group = { key: string; pr?: PrEntry; views: View[]; tokens: number; cost?: number; ms: number }

export const OTHER_KEY = 'other'
export const groupKey = (pr: number | null): string => (pr === null ? OTHER_KEY : `pr:${pr}`)

const group = (key: string, pr: PrEntry | undefined, views: View[]): Group => ({
  key, pr, views,
  tokens: views.reduce((n, v) => n + (v.tokens ?? 0), 0),
  cost: totalCost(views.map(v => v.cost)),
  ms: views.reduce((n, v) => n + (v.elapsedMs ?? 0), 0),
})

/**
 * The views grouped by PR, each group's agents in the views' order. Order: the group of the current `branch` first (shown even with
 * no agents when it is a PR), then the PR groups by their newest agent (views come newest first), then Other. Empty groups are left out.
 */
export function groupByPr(views: readonly View[], index: readonly PrEntry[], branch?: string): Group[] {
  const byKey = new Map<string, View[]>()
  for (const v of views) {
    const k = groupKey(attribute(v.branch, index))
    byKey.set(k, [...(byKey.get(k) ?? []), v])
  }
  const current = groupKey(attribute(branch, index))
  const keys = [...byKey.keys()].filter(k => k !== current && k !== OTHER_KEY)
  const order = [...(current !== OTHER_KEY || byKey.has(OTHER_KEY) ? [current] : []), ...keys, ...(current !== OTHER_KEY && byKey.has(OTHER_KEY) ? [OTHER_KEY] : [])]
  const prOf = (k: string) => index.find(p => groupKey(p.number) === k)
  return order.map(k => group(k, prOf(k), byKey.get(k) ?? []))
}

/** Whether a group shows its agents: the hand-set choice in `expanded`, else open only for the first group. */
export const isOpen = (key: string, groups: readonly Group[], expanded: Readonly<Record<string, boolean>> = {}): boolean =>
  expanded[key] ?? groups[0]?.key === key

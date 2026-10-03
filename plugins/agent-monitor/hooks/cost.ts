// Token split and estimated cost for agent-monitor. Pure; tested in cost.test.ts.
// Prices are USD per million tokens: [input, 5-minute cache write, cache read, output], keyed by model family. Estimates only: list prices,
// no batch / fast-mode / data-residency modifiers.
import type { AgentSpent } from '../types'

export type Price = readonly [number, number, number, number]
export type Prices = Readonly<Record<string, Price>>

// https://platform.claude.com/docs/en/about-claude/pricing (Sonnet 5.5, Opus 5.5, Haiku 4.5, Fable 5.1).
export const DEFAULT_PRICES: Prices = {
  sonnet: [2, 2.5, 0.2, 10],
  opus: [4, 5, 0.2, 20],
  haiku: [1, 1.25, 0.1, 5],
  fable: [10, 12.5, 0.25, 50],
}

// The model versions each default price is right for. A bare alias (`opus`) counts as the current one; any other version has no price.
const VERSIONS: Readonly<Record<string, readonly string[]>> = { sonnet: ['5', '5-5'], opus: ['5-5'], haiku: ['4-5'], fable: ['5-1'] }

// The family key of a model id (`claude-sonnet-5-5`, `claude-haiku-4-5-20251001`, `opus`), undefined when it is none we price.
export function familyOf(model: string | undefined): string | undefined {
  const m = /(sonnet|opus|haiku|fable)(?:-(\d+)(?:-(\d{1,2})(?!\d))?)?/.exec((model ?? '').toLowerCase().replaceAll('.', '-'))
  if (!m?.[1]) return undefined
  const version = m[2] === undefined ? undefined : m[3] === undefined ? m[2] : `${m[2]}-${m[3]}`
  return version === undefined || VERSIONS[m[1]]?.includes(version) ? m[1] : undefined
}

const isPrice = (v: unknown): v is Price => Array.isArray(v) && v.length === 4 && v.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)

// The `prices` setting: compact JSON overriding the defaults per family. Bad JSON or a bad entry falls back to the default for it and sets `bad`.
export function parsePrices(raw: unknown): { prices: Prices; bad: boolean } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) return { prices: DEFAULT_PRICES, bad: false }
  let parsed: unknown
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : undefined
  } catch { /* handled below */ }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { prices: DEFAULT_PRICES, bad: true }
  const prices: Record<string, Price> = { ...DEFAULT_PRICES }
  let bad = false
  for (const [k, v] of Object.entries(parsed)) {
    if (isPrice(v) && k in VERSIONS) prices[k] = v
    else bad = true
  }
  return { prices, bad }
}

// Billing split of what an agent spent: cache hits, everything else sent as input (fresh + cache writes), output.
export const tokenSplit = (s: AgentSpent) => ({ hit: s.cacheRead, miss: s.input + s.cacheWrite, out: s.output })

// Cost of one bucket of usage at one model's price; null when that model has no price.
export function stepCost(s: AgentSpent, model: string | undefined, prices: Prices): number | null {
  const fam = familyOf(model)
  const p = fam === undefined ? undefined : prices[fam]
  return p ? (s.input * p[0] + s.cacheWrite * p[1] + s.cacheRead * p[2] + s.output * p[3]) / 1e6 : null
}

// An agent's cost: its usage buckets per step model, each at its own price; the single `spent` at the agent's model when there are no buckets
// (a backfilled agent). null when anything has no price or nothing was spent.
export function agentCost(r: { byModel?: Record<string, AgentSpent>; spent?: AgentSpent; model?: string }, prices: Prices): number | null {
  const buckets = r.byModel && Object.keys(r.byModel).length > 0 ? Object.entries(r.byModel) : r.spent ? [[r.model, r.spent] as const] : []
  if (buckets.length === 0) return null
  let sum = 0
  for (const [model, s] of buckets) {
    const c = stepCost(s, model, prices)
    if (c === null) return null
    sum += c
  }
  return sum
}

// `$0.42`, `<$0.01` for a sliver; `—` when unknown.
export function formatMoney(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '—'
  return usd > 0 && usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`
}

// The sum over the agents whose cost is known; undefined when none is.
export function totalCost(costs: readonly (number | undefined)[]): number | undefined {
  const known = costs.filter((c): c is number => c !== undefined)
  return known.length === 0 ? undefined : known.reduce((a, b) => a + b, 0)
}

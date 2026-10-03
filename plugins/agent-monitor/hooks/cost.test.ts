import { test, expect } from 'claude-code/testing'

import { DEFAULT_PRICES, agentCost, familyOf, formatMoney, parsePrices, stepCost, tokenSplit, totalCost } from './cost'
import { view } from './fixture'
import { headerSegs } from './layout'
import { onStep, onStepEnd, blank } from './patches'
import { buildViews } from './views'

const spent = { input: 1000, output: 2000, cacheRead: 10_000, cacheWrite: 4000 }
const near = (a: number | null, b: number) => expect(a !== null && Math.abs(a - b) < 1e-9).toBe(true)

test('tokenSplit: hits are cache reads; misses are fresh input plus cache writes', () => {
  expect(tokenSplit(spent)).toEqual({ hit: 10_000, miss: 5000, out: 2000 })
  const t = tokenSplit(spent)
  expect(t.hit + t.miss + t.out).toBe(spent.input + spent.cacheRead + spent.cacheWrite + spent.output)
})

test('familyOf: ids, aliases and unpriced versions', () => {
  expect(familyOf('claude-sonnet-5-5')).toBe('sonnet')
  expect(familyOf('claude-opus-5-5')).toBe('opus')
  expect(familyOf('claude-haiku-4-5-20251001')).toBe('haiku')
  expect(familyOf('claude-fable-5-1')).toBe('fable')
  expect(familyOf('opus')).toBe('opus')
  expect(familyOf('claude-opus-4-8')).toBeUndefined()
  expect(familyOf('claude-sonnet-4-6')).toBeUndefined()
  expect(familyOf('claude-fable-5')).toBeUndefined()
  expect(familyOf('gpt-5')).toBeUndefined()
  expect(familyOf(undefined)).toBeUndefined()
})

test('stepCost: input, cache write, cache read and output each at their own rate', () => {
  near(stepCost(spent, 'claude-sonnet-5-5', DEFAULT_PRICES), (1000 * 2 + 4000 * 2.5 + 10_000 * 0.2 + 2000 * 10) / 1e6) // 0.034
  near(stepCost(spent, 'claude-opus-5-5', DEFAULT_PRICES), (1000 * 4 + 4000 * 5 + 10_000 * 0.2 + 2000 * 20) / 1e6)
  near(stepCost(spent, 'claude-haiku-4-5-20251001', DEFAULT_PRICES), (1000 * 1 + 4000 * 1.25 + 10_000 * 0.1 + 2000 * 5) / 1e6)
  near(stepCost(spent, 'claude-fable-5-1', DEFAULT_PRICES), (1000 * 10 + 4000 * 12.5 + 10_000 * 0.25 + 2000 * 50) / 1e6)
  near(stepCost({ input: 0, output: 0, cacheRead: 1e6, cacheWrite: 0 }, 'claude-sonnet-5-5', DEFAULT_PRICES), 0.2)
  near(stepCost({ input: 0, output: 0, cacheRead: 0, cacheWrite: 1e6 }, 'claude-sonnet-5-5', DEFAULT_PRICES), 2.5)
})

test('stepCost: an unknown model is null', () => {
  expect(stepCost(spent, 'claude-opus-4-8', DEFAULT_PRICES)).toBeNull()
  expect(stepCost(spent, undefined, DEFAULT_PRICES)).toBeNull()
  expect(stepCost(spent, 'claude-sonnet-5-5', {})).toBeNull()
})

test('agentCost: each step priced by its own model; one unpriced model makes it null; a lone spent uses the agent model', () => {
  const byModel = { 'claude-sonnet-5-5': spent, 'claude-haiku-4-5-20251001': spent }
  near(agentCost({ byModel }, DEFAULT_PRICES), stepCost(spent, 'sonnet', DEFAULT_PRICES)! + stepCost(spent, 'haiku', DEFAULT_PRICES)!)
  expect(agentCost({ byModel: { ...byModel, 'claude-opus-4-8': spent } }, DEFAULT_PRICES)).toBeNull()
  near(agentCost({ spent, model: 'claude-opus-5-5' }, DEFAULT_PRICES), stepCost(spent, 'opus', DEFAULT_PRICES)!)
  expect(agentCost({ spent }, DEFAULT_PRICES)).toBeNull()
  expect(agentCost({}, DEFAULT_PRICES)).toBeNull()
})

test('steps record usage per model: a model switch mid-run splits the buckets', () => {
  const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20 }
  let r = blank()
  r = onStepEnd(onStep(r, { model: 'claude-sonnet-5-5' }, 1), u, 2)
  r = onStepEnd(onStep(r, { model: 'claude-sonnet-5-5' }, 3), u, 4)
  r = onStepEnd(onStep(r, { model: 'claude-haiku-4-5-20251001' }, 5), u, 6)
  expect(r.byModel?.['claude-sonnet-5-5']).toEqual({ input: 20, output: 10, cacheRead: 200, cacheWrite: 40 })
  expect(r.byModel?.['claude-haiku-4-5-20251001']).toEqual({ input: 10, output: 5, cacheRead: 100, cacheWrite: 20 })
  expect(r.spent).toEqual({ input: 30, output: 15, cacheRead: 300, cacheWrite: 60 })
})

test('parsePrices: defaults, overrides, and fallback on bad input', () => {
  expect(parsePrices(undefined)).toEqual({ prices: DEFAULT_PRICES, bad: false })
  expect(parsePrices('  ')).toEqual({ prices: DEFAULT_PRICES, bad: false })
  expect(parsePrices(JSON.stringify(DEFAULT_PRICES))).toEqual({ prices: DEFAULT_PRICES, bad: false })
  const o = parsePrices('{"opus":[5,6.25,0.5,25]}')
  expect(o.prices.opus).toEqual([5, 6.25, 0.5, 25])
  expect(o.prices.sonnet).toEqual(DEFAULT_PRICES.sonnet)
  expect(o.bad).toBe(false)
  for (const raw of ['{oops', '[1,2]', '"x"', 'null', 7, '{"opus":[1,2,3]}', '{"opus":[1,2,3,"x"]}', '{"opus":[1,2,3,-4]}', '{"mistral":[1,1,1,1]}']) {
    const r = parsePrices(raw)
    expect(r.bad).toBe(true)
    expect(r.prices.sonnet).toEqual(DEFAULT_PRICES.sonnet)
  }
  expect(parsePrices('{"opus":[1,2,3]}').prices.opus).toEqual(DEFAULT_PRICES.opus)
})

test('formatMoney and totalCost', () => {
  expect(formatMoney(0.4176)).toBe('$0.42')
  expect(formatMoney(3.184)).toBe('$3.18')
  expect(formatMoney(0.001)).toBe('<$0.01')
  expect(formatMoney(0)).toBe('$0.00')
  expect(formatMoney(null)).toBe('—')
  expect(formatMoney(undefined)).toBe('—')
  expect(totalCost([1, undefined, 2.5])).toBe(3.5)
  expect(totalCost([undefined])).toBeUndefined()
})

test('header: Σ tokens · ≈ $ · time, the $ summed over agents with a known cost; none known leaves it out', () => {
  const v = (cost: number | undefined) => view({ status: 'done', tokens: 306_200, elapsedMs: 1_230_000, cost })
  const line = (views: ReturnType<typeof v>[]) => headerSegs(120, views).map(s => s.text).join('')
  expect(line([v(1.5), v(1.684), v(undefined)]).endsWith('Σ 918.6k tok · ≈ $3.18 · 1h01m')).toBe(true)
  expect(line([v(undefined)]).endsWith('Σ 306.2k tok · 20m30s')).toBe(true)
})

test('views carry the cost from the records, priced by the config table', () => {
  const rec = { type: 'worker', desc: 'd', task: 'd', steps: 1, watched: true, context: 0, output: 0, status: 'done' as const, byModel: { 'claude-sonnet-5-5': spent } }
  const [a] = buildViews({ a: rec }, undefined, 0)
  near(a!.cost ?? null, 0.034)
  const [b] = buildViews({ a: rec }, undefined, 0, { prices: { sonnet: [0, 0, 0, 1] } })
  near(b!.cost ?? null, 0.002)
  expect(buildViews({ a: { ...rec, byModel: undefined, spent: undefined } }, undefined, 0)[0]!.cost).toBeUndefined()
})

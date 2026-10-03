import { test, expect } from 'claude-code/testing'

import type { AgentMonitorRec } from '../types'
import { diffStat, editDelta, onAgentResult, onComplete, onSpawn, onStep, onStepEnd, onToolEnd, onToolStart } from './patches'

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite })
import { strings } from './strings'

const toolStart = (p: Parameters<typeof onToolStart>[0], tool: string, input: Record<string, unknown>, path: string | undefined, now: number) => onToolStart(p, tool, input, path, now, strings('zh'))
const rec: AgentMonitorRec = { type: 'worker', desc: 'so.med · 做事', task: '做事', steps: 5, watched: true, context: 900, output: 100, startedAt: 1000, status: 'running' }

test('onStep: a step after a lost list entry keeps the run (46 s bug: it restarted the clock)', () => {
  const lost = { ...rec, status: 'unknown' as const, finishedAt: 5000, durationMs: 4000 }
  const back = onStep(lost, { model: 'claude-sonnet-5-5' }, 90_000)
  expect(back).toMatchObject({ status: 'running', startedAt: 1000, steps: 6, context: 900, output: 100 })
  expect(back.finishedAt).toBeUndefined()
  expect(back.durationMs).toBeUndefined()
})

test('onStep: a finished agent that steps again starts a new run', () => {
  const done = { ...rec, status: 'done' as const, finishedAt: 5000, durationMs: 4000, tokens: 9000 }
  expect(onStep(done, { model: 'm', effort: 'high' }, 90_000)).toMatchObject({ status: 'running', startedAt: 90_000, context: 0, output: 0, steps: 6, effort: 'high' })
})

test('onSpawn and onComplete', () => {
  const s = onSpawn({ ...rec, steps: 0 }, { subagentType: 'Explore', description: 'so.low · 查' }, 'claude-haiku-4', 500)
  expect(s).toMatchObject({ type: 'Explore', task: '查', model: 'claude-haiku-4', watched: true, status: 'running', startedAt: 500 })
  expect(onComplete(rec, 'answer', 4000)).toMatchObject({ status: 'done', finishedAt: 4000, durationMs: 3000 })
  expect(onComplete(rec, 'error', 4000).status).toBe('failed')
})

test('onAgentResult: fills identity a missed spawn left, never overwrites the spawn, totals only when completed', () => {
  const blank = { type: '', desc: '', task: '', steps: 0, watched: false, context: 0, output: 0, status: 'running' as const }
  const launched = onAgentResult(blank, { subagent_type: 'worker', description: 'so.med · x' }, { status: 'async_launched', resolvedModel: 'claude-sonnet-5-5' }, 700)
  expect(launched).toMatchObject({ type: 'worker', desc: 'so.med · x', task: 'x', model: 'claude-sonnet-5-5', startedAt: 700, status: 'running' })
  expect(onAgentResult(rec, { subagent_type: 'other', description: 'other' }, { status: 'async_launched' }, 700)).toMatchObject({ type: 'worker', desc: 'so.med · 做事', startedAt: 1000 })
  expect(onAgentResult(rec, {}, { status: 'completed', totalTokens: 7, totalDurationMs: 99 }, 5000)).toMatchObject({ status: 'done', tokens: 7, durationMs: 99, finishedAt: 5000 })
})

test('onStep: records what actually ran, stamps the event and clears a stale pending tool', () => {
  const pending = { ...rec, pendingTool: 'Bash', pendingCalls: { Bash: 1 } }
  const s = onStep(pending, { model: 'claude-haiku-4', effort: 'low' }, 7000)
  expect(s).toMatchObject({ actualModel: 'claude-haiku-4', actualEffort: 'low', lastEventAt: 7000, pendingTool: undefined, pendingCalls: undefined })
  expect(onStepEnd(s, usage(3, 6, 1, 1), 9000)).toMatchObject({ context: 5, output: 6, lastEventAt: 9000 })
  expect(onStepEnd(s, undefined, 9000)).toMatchObject({ context: s.context, lastEventAt: 9000 })
})

test('onToolStart / onToolEnd: pending bracket, counts, files, denials', () => {
  const a = toolStart(rec, 'Edit', { file_path: '/p/a.ts' }, '/p/a.ts', 2000)
  expect(a).toMatchObject({ pendingTool: 'Edit', pendingCalls: { Edit: 1 }, lastEventAt: 2000, activity: '修改 a.ts', toolCounts: { Edit: 1 }, files: ['/p/a.ts'] })
  const b = toolStart(a, 'Edit', { file_path: '/p/a.ts' }, '/p/a.ts', 2100) // same path again: no second entry
  expect(b).toMatchObject({ pendingCalls: { Edit: 2 }, toolCounts: { Edit: 2 }, files: ['/p/a.ts'] })
  const one = onToolEnd(b, 'Edit', undefined, 2200)
  expect(one).toMatchObject({ pendingTool: 'Edit', pendingCalls: { Edit: 1 }, lastEventAt: 2200 }) // a parallel call is still out
  const done = onToolEnd(one, 'Edit', undefined, 2300)
  expect(done.pendingTool).toBeUndefined()
  expect(done.pendingCalls).toBeUndefined()
  expect(done.denied).toBeUndefined()
  const denied = onToolEnd(toolStart(rec, 'Bash', { command: 'x' }, undefined, 1), 'Bash', 'blocked by hook\nsecond line', 2)
  expect(denied).toMatchObject({ denied: 1, reasons: [{ text: 'blocked by hook', n: 1 }] })
  expect(toolStart(rec, 'Read', { file_path: '/p/r' }, undefined, 1).files).toBeUndefined()
})

test('onAgentResult: toolStats give the edit count and per-tool counts; live counts are kept', () => {
  const stats = { readCount: 3, searchCount: 1, bashCount: 0, editFileCount: 2, otherToolCount: 0 }
  const r = onAgentResult(rec, {}, { status: 'completed', toolStats: stats }, 5000)
  expect(r).toMatchObject({ editCount: 2, toolCounts: { Read: 3, Search: 1, Edit: 2 } })
  const live = onAgentResult({ ...rec, toolCounts: { Bash: 9 } }, {}, { status: 'completed', toolStats: stats }, 5000)
  expect(live.toolCounts).toEqual({ Bash: 9 })
  expect(onAgentResult(rec, {}, { status: 'async_launched' }, 5000).editCount).toBeUndefined()
})

test('onToolEnd: the call still out is named, not the one that came back', () => {
  const both = toolStart(toolStart(rec, 'Bash', { command: 'a' }, undefined, 1), 'Write', { file_path: '/p/x.ts' }, '/p/x.ts', 2)
  expect(both).toMatchObject({ pendingTool: 'Bash', pendingCalls: { Bash: 1, Write: 1 } })
  expect(onToolEnd(both, 'Bash', undefined, 3)).toMatchObject({ pendingTool: 'Write', pendingCalls: { Write: 1 } })
  expect(onToolEnd(both, 'Write', undefined, 3)).toMatchObject({ pendingTool: 'Bash', pendingCalls: { Bash: 1 } })
  expect(onToolEnd(rec, 'Bash', undefined, 3).pendingTool).toBeUndefined() // a result nobody started (reload in between): nothing pending
})

test('onStep / onStepEnd: the longest step and the token parts are kept over the run', () => {
  const a = onStep({ ...rec, steps: 0, context: 0, output: 0 }, { model: 'm' }, 1000)
  expect(a.stepAt).toBe(1000)
  const b = onStepEnd(a, usage(10, 4, 100, 20), 1500)
  expect(b).toMatchObject({ longestStepMs: 500, spent: { input: 10, output: 4, cacheRead: 100, cacheWrite: 20 }, stepAt: undefined })
  const c = onStepEnd(onStep(b, { model: 'm' }, 2000), usage(5, 6, 0, 0), 2200) // a shorter step: the longest stays; usage adds up
  expect(c).toMatchObject({ longestStepMs: 500, spent: { input: 15, output: 10, cacheRead: 100, cacheWrite: 20 }, context: 5, output: 6 })
  expect(onStepEnd(a, undefined, 1700)).toMatchObject({ longestStepMs: 700 }) // no usage in the response: the step still counts
  const done = { ...c, status: 'done' as const, finishedAt: 3000 }
  expect(onStep(done, { model: 'm' }, 4000)).toMatchObject({ spent: undefined, longestStepMs: undefined }) // a new run starts over
})

test('onToolStart: the last ten activity texts, skill names (deduped, capped)', () => {
  let p = rec
  for (let i = 0; i < 14; i++) p = toolStart(p, 'Read', { file_path: `/p/f${i}.ts` }, undefined, i)
  expect(p.recent).toHaveLength(10)
  expect(p.recent?.[0]).toBe('读取 f4.ts')
  expect(p.recent?.[9]).toBe('读取 f13.ts')
  const s = toolStart(toolStart(toolStart(rec, 'Skill', { skill: 'tdd' }, undefined, 1), 'Skill', { skill: 'tdd' }, undefined, 2), 'Skill', { skill: 'pr' }, undefined, 3)
  expect(s.skills).toEqual(['tdd', 'pr'])
  expect(toolStart(rec, 'Read', { file_path: '/a' }, undefined, 1).skills).toBeUndefined()
  let many = rec
  for (let i = 0; i < 25; i++) many = toolStart(many, 'Skill', { skill: `s${i}` }, undefined, i)
  expect(many.skills).toHaveLength(20)
  expect(toolStart(rec, 'Bash', { command: 'x'.repeat(500) }, undefined, 1).recent?.[0]?.length).toBeLessThanOrEqual(120)
})

test('diffStat / editDelta / onToolEnd: lines changed per edited path, summed over calls', () => {
  expect(diffStat({ structuredPatch: [{ lines: [' ctx', '-old', '+new1', '+new2'] }, { lines: ['+x'] }] })).toEqual({ add: 3, del: 1 })
  expect(diffStat({ type: 'create', content: 'a\nb\nc', structuredPatch: [] })).toEqual({ add: 3, del: 0 })
  expect(diffStat({ type: 'update', structuredPatch: [] })).toBeUndefined()
  expect(diffStat({ gitDiff: { additions: 99, deletions: 99 }, structuredPatch: [{ lines: ['+a'] }] })).toEqual({ add: 1, del: 0 }) // gitDiff is against HEAD, not this call
  expect(diffStat(undefined)).toBeUndefined()
  expect(editDelta('/p/a.ts', { result: { structuredPatch: [{ lines: ['-a', '+b'] }] } })).toEqual({ path: '/p/a.ts', add: 1, del: 1 })
  expect(editDelta('/p/a.ts', { isError: true, result: { structuredPatch: [{ lines: ['+b'] }] } })).toBeUndefined()
  expect(editDelta(undefined, { result: { structuredPatch: [{ lines: ['+b'] }] } })).toBeUndefined()
  const one = onToolEnd(rec, 'Edit', undefined, 1, { path: '/p/a.ts', add: 2, del: 1 })
  const two = onToolEnd(one, 'Edit', undefined, 2, { path: '/p/a.ts', add: 3, del: 0 })
  expect(two.lines).toEqual({ '/p/a.ts': { add: 5, del: 1 } })
  expect(onToolEnd(rec, 'Edit', undefined, 1).lines).toBeUndefined()
  const full = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`/p/${i}`, { add: 1, del: 0 }]))
  expect(Object.keys(onToolEnd({ ...rec, lines: full }, 'Edit', undefined, 1, { path: '/p/new', add: 1, del: 0 }).lines ?? {})).toHaveLength(50)
  expect(onToolEnd({ ...rec, lines: full }, 'Edit', undefined, 1, { path: '/p/3', add: 1, del: 0 }).lines?.['/p/3']).toEqual({ add: 2, del: 0 })
})

test('onSpawn / onAgentResult: the prompt is cut to 300, the result to five lines, authoritative usage replaces the sums', () => {
  const s = onSpawn({ ...rec, steps: 0 }, { subagentType: 'w', description: 'd', prompt: 'p'.repeat(400) }, undefined, 1)
  expect(s.prompt).toHaveLength(300)
  const r = onAgentResult(rec, {}, { status: 'completed', prompt: 'from result', content: [{ type: 'text', text: 'l1\nl2\n\nl3\nl4\nl5\nl6\nl7' }], usage: { input_tokens: 7, output_tokens: 8, cache_read_input_tokens: null, cache_creation_input_tokens: 2 } }, 5000)
  expect(r.result).toBe('l1\nl2\nl3\nl4\nl5')
  expect(r.spent).toEqual({ input: 7, output: 8, cacheRead: 0, cacheWrite: 2 })
  expect(r.prompt).toBe('from result') // `rec` has none: the result's own prompt fills it
  expect(onAgentResult({ ...rec }, {}, { status: 'async_launched', prompt: 'x'.repeat(500) }, 1).prompt).toHaveLength(300)
  expect(onAgentResult({ ...rec, prompt: 'kept' }, {}, { status: 'async_launched', prompt: 'other' }, 1).prompt).toBe('kept')
  expect(onAgentResult(rec, {}, { status: 'async_launched', content: [{ text: 'not yet' }] }, 1).result).toBeUndefined()
})

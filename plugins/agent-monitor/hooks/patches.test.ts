import { test, expect } from 'claude-code/testing'

import type { AgentMonitorRec } from '../types'
import { editedPaths, onComplete, onStep, onStepEnd, onToolUses } from './patches'
import type { ToolUse } from './patches'
import { strings } from './strings'

const usage = (input: number, output: number, cacheRead: number, cacheWrite: number) => ({
  input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite,
})

const uses = (p: AgentMonitorRec, list: ToolUse[], cwd = '/p') => onToolUses(p, list, cwd, strings('zh'))
const call = (name: string, input: Record<string, unknown>): ToolUse => ({ name, input })
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

test('onStep: a record that starts at a turn\'s first step counts every step; one that starts later does not', () => {
  const seeded = { ...rec, steps: 0, watched: false, startedAt: undefined }
  expect(onStep(seeded, { model: 'm', index: 0 }, 500)).toMatchObject({ watched: true, steps: 1, startedAt: 500, status: 'running' })
  expect(onStep(seeded, { model: 'm', index: 3 }, 500).watched).toBe(false)
  expect(onStep({ ...seeded, steps: 2 }, { model: 'm', index: 0 }, 500).watched).toBe(false) // a later turn of an agent first seen mid-run
})

test('onComplete: done or failed, its time, and the report handed back (five lines)', () => {
  expect(onComplete(rec, 'answer', 4000)).toMatchObject({ status: 'done', finishedAt: 4000, durationMs: 3000 })
  expect(onComplete(rec, 'error', 4000).status).toBe('failed')
  expect(onComplete({ ...rec, pendingTool: 'Bash' }, 'answer', 4000).pendingTool).toBeUndefined()
  expect(onComplete(rec, 'answer', 4000, 'l1\nl2\n\nl3\nl4\nl5\nl6').result).toBe('l1\nl2\nl3\nl4\nl5')
  expect(onComplete({ ...rec, result: 'kept' }, 'answer', 4000, '').result).toBe('kept')
})

test('onStep: records what actually ran, stamps the event and clears a stale pending tool', () => {
  const s = onStep({ ...rec, pendingTool: 'Bash' }, { model: 'claude-haiku-4', effort: 'low' }, 7000)
  expect(s).toMatchObject({ actualModel: 'claude-haiku-4', actualEffort: 'low', lastEventAt: 7000, pendingTool: undefined })
  expect(onStepEnd(s, usage(3, 6, 1, 1), 9000)).toMatchObject({ context: 5, output: 6, lastEventAt: 9000 })
  expect(onStepEnd(s, undefined, 9000)).toMatchObject({ context: s.context, lastEventAt: 9000 })
})

test('onToolUses: each call counted with its activity, edited paths (deduped, made absolute), the first call pending', () => {
  const a = uses(rec, [call('Edit', { file_path: '/p/a.ts' }), call('Bash', { command: 'ls', description: 'list' }), call('Edit', { file_path: 'a.ts' })])
  expect(a).toMatchObject({ pendingTool: 'Edit', activity: '修改 a.ts', toolCounts: { Edit: 2, Bash: 1 }, files: ['/p/a.ts'], recent: ['修改 a.ts', '运行 list', '修改 a.ts'] })
  expect(uses(rec, [call('Read', { file_path: '/p/r' })]).files).toBeUndefined()
  // A step that asks for nothing changes nothing but the pending call.
  expect(uses({ ...rec, pendingTool: 'Bash' }, [])).toEqual({ ...rec, pendingTool: undefined })
})

test('onToolUses: Code Mode\'s REPL call reads as a script with its description; odd arguments are no arguments', () => {
  const r = uses(rec, [{ name: 'REPL', input: { code: 'await $`ls`.text()', description: 'List the files' } }])
  expect(r).toMatchObject({ activity: '脚本 List the files', toolCounts: { REPL: 1 }, pendingTool: '脚本 List the files' })
  expect(onToolUses(rec, [{ name: 'REPL', input: { code: 'await $`ls`.text()' } }], '/p', strings('en')).activity).toBe('Script await $`ls`.text()')
  expect(uses(rec, [{ name: 'Edit', input: null }, { name: 'Write', input: 'x' }])).toMatchObject({ toolCounts: { Edit: 1, Write: 1 } })
  expect(uses(rec, [{ name: 'Edit', input: null }]).files).toBeUndefined()
})

test('editedPaths: the edit tools\' paths, relative ones joined to cwd', () => {
  expect(editedPaths([call('Write', { file_path: 'src/x.ts' }), call('Read', { file_path: '/a' }), call('NotebookEdit', { notebook_path: '/n.ipynb' })], '/w')).toEqual(['/w/src/x.ts', '/n.ipynb'])
  expect(editedPaths([], '/w')).toEqual([])
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

test('onToolUses: the last ten activity texts, skill names (deduped, capped)', () => {
  const reads = uses(rec, Array.from({ length: 14 }, (_, i) => call('Read', { file_path: `/p/f${i}.ts` })))
  expect(reads.recent).toHaveLength(10)
  expect(reads.recent?.[0]).toBe('读取 f4.ts')
  expect(reads.recent?.[9]).toBe('读取 f13.ts')
  const s = uses(uses(rec, [call('Skill', { skill: 'tdd' }), call('Skill', { skill: 'tdd' })]), [call('Skill', { skill: 'pr' })])
  expect(s.skills).toEqual(['tdd', 'pr'])
  expect(uses(rec, [call('Read', { file_path: '/a' })]).skills).toBeUndefined()
  expect(uses(rec, Array.from({ length: 25 }, (_, i) => call('Skill', { skill: `s${i}` }))).skills).toHaveLength(20)
  expect(uses(rec, [call('Bash', { command: 'x'.repeat(500) })]).recent?.[0]?.length).toBeLessThanOrEqual(120)
})

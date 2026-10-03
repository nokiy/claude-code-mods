import { test, expect } from 'claude-code/testing'

import { mergeBackfill, recsFromMessages } from './backfill'
import type { Msg } from './backfill'
import { buildViews } from './views'

const launch = (id: string, desc: string, type = 'worker'): Msg => ({
  role: 'assistant',
  text: '',
  toolUses: [{ tool: 'Agent', input: { description: desc, subagent_type: type }, agentId: id, result: { status: 'async_launched', agentId: id, resolvedModel: 'claude-sonnet-5-5' } }],
})
const note = (id: string, status: string, tokens = 100, ms = 5000): Msg => ({
  role: 'user',
  text: `<task-notification>\n<task-id>${id}</task-id>\n<status>${status}</status>\n<summary>x</summary>\n<result>quotes <status>failed</status></result>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>3</tool_uses><duration_ms>${ms}</duration_ms></usage>\n</task-notification>`,
})

test('recsFromMessages: one record per Agent launch, ended by its task notification', () => {
  const found = recsFromMessages([
    launch('a1', 'so.med · 做事'),
    { role: 'assistant', text: '', toolUses: [{ tool: 'Read', input: {}, agentId: 'nope' }, { tool: 'Agent', input: { description: 'no id' } }] },
    launch('a2', 'so.low · 查', 'Explore'),
    note('a1', 'completed', 61275, 77551),
    note('zz', 'completed'), // no launch seen for it
    launch('a3', 'x'),
    note('a3', 'killed'),
  ])
  expect(Object.keys(found)).toEqual(['a1', 'a2', 'a3'])
  expect(found.a1).toMatchObject({ type: 'worker', task: '做事', model: 'claude-sonnet-5-5', status: 'done', tokens: 61275, durationMs: 77551, watched: false })
  expect(found.a2).toMatchObject({ type: 'Explore', status: 'running' }) // no notification yet
  expect(found.a3!.status).toBe('failed')
  expect('tokens' in found.a2!).toBe(false)
})

test('recsFromMessages: a resumed agent notifies again, the last word stands', () => {
  const found = recsFromMessages([launch('a1', 'x'), note('a1', 'completed', 10, 1000), note('a1', 'failed', 20, 2000)])
  expect(found.a1).toMatchObject({ status: 'failed', tokens: 20, durationMs: 2000 })
})

test('history survives a gap: agents the mod never recorded come back and show as finished', () => {
  const live = { type: 'worker', desc: 'live one', task: 'live one', steps: 4, watched: true, context: 0, output: 0, startedAt: 1, finishedAt: 9, durationMs: 8, tokens: 5, status: 'done' as const }
  const msgs = [launch('a1', 'so.med · one'), launch('a2', 'so.med · two'), launch('a3', 'so.med · three'), launch('a4', 'so.med · four'), launch('live', 'live one'), note('a1', 'completed'), note('a2', 'completed'), note('a3', 'completed'), note('a4', 'completed')]
  const merged = mergeBackfill({ live }, recsFromMessages(msgs))
  expect(Object.keys(merged).sort()).toEqual(['a1', 'a2', 'a3', 'a4', 'live'])
  expect(merged.live).toBe(live) // a record the mod wrote itself is never overwritten
  const views = buildViews(merged, [], 100)
  expect(views.map(v => v.status)).toEqual(['done', 'done', 'done', 'done', 'done'])
  expect(views.find(v => v.id === 'a1')).toMatchObject({ task: 'one', tokens: 100, elapsedMs: 5000, rounds: undefined })
})

test('mergeBackfill: an end the conversation knows settles a running or unknown record; no change keeps the object', () => {
  const rec = { type: 'w', desc: 'd', task: 'd', steps: 2, watched: true, context: 0, output: 0, startedAt: 1, status: 'unknown' as const }
  const found = recsFromMessages([launch('a', 'd'), note('a', 'completed', 77, 3000)])
  const merged = mergeBackfill({ a: rec }, found)
  expect(merged.a).toMatchObject({ status: 'done', tokens: 77, durationMs: 3000, steps: 2, startedAt: 1 })
  const recs = { a: { ...rec, status: 'done' as const } }
  expect(mergeBackfill(recs, found)).toBe(recs)
})

test('backfill: toolStats of an Agent result become the edit count and tool counts, paths stay unknown', () => {
  const stats = { readCount: 5, searchCount: 0, bashCount: 2, editFileCount: 3, otherToolCount: 1 }
  const found = recsFromMessages([{ role: 'assistant', text: '', toolUses: [{ tool: 'Agent', input: { description: 'x' }, agentId: 'a1', result: { status: 'completed', agentId: 'a1', toolStats: stats } }] }])
  expect(found.a1).toMatchObject({ editCount: 3, toolCounts: { Read: 5, Bash: 2, Edit: 3, Other: 1 } })
  expect(found.a1!.files).toBeUndefined()
  const view = buildViews(found, [], 100)[0]!
  expect(view).toMatchObject({ editCount: 3, files: [], clashes: [] })
  // a record that lacks them takes them when it is settled from the conversation
  const rec = { type: 'w', desc: 'd', task: 'd', steps: 2, watched: true, context: 0, output: 0, startedAt: 1, status: 'unknown' as const }
  expect(mergeBackfill({ a1: rec }, found).a1).toMatchObject({ editCount: 3, toolCounts: { Edit: 3 } })
})

test('recsFromMessages: the spawn prompt (cut to 300) and the report ride along, from the Agent result or the task notification', () => {
  const fg: Msg = { role: 'assistant', text: '', toolUses: [{ tool: 'Agent', input: { description: 'd', prompt: 'p'.repeat(400) }, agentId: 'f1', result: { status: 'completed', agentId: 'f1', content: [{ type: 'text', text: 'a\nb\n\nc\nd\ne\nf' }] } }] }
  const found = recsFromMessages([fg, launch('b1', 'bg'), note('b1', 'completed')])
  expect(found.f1!.prompt).toHaveLength(300)
  expect(found.f1!.result).toBe('a\nb\nc\nd\ne')
  expect(found.b1!.result).toBe('quotes <status>failed</status>') // the notification's <result>, quoted tags and all
  expect(launch('x', 'y').toolUses![0]!.input.prompt).toBeUndefined()
  expect(found.b1!.prompt).toBeUndefined()
  const a = { ...found.b1!, status: 'running' as const, result: undefined }
  expect(mergeBackfill({ b1: a }, { b1: found.b1! }).b1).toMatchObject({ status: 'done', result: 'quotes <status>failed</status>' })
})

test('a backfilled agent takes its token parts from the Agent result usage', () => {
  const usage = { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 100, cache_creation_input_tokens: null }
  const recs = recsFromMessages([{ role: 'assistant', text: '', toolUses: [{ tool: 'Agent', input: { description: 'd' }, agentId: 'z', result: { status: 'completed', usage } }] }])
  expect(recs.z!.spent).toEqual({ input: 5, output: 7, cacheRead: 100, cacheWrite: 0 })
})

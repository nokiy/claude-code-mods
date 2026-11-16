import { test, expect } from 'claude-code/testing'

import { emptyRollup, feed } from '../../hooks/transcript'
import { agentTranscript, assistantLine, editLine, jsonl, userLine } from '../transcripts'

const A = { sessionId: 's1', agentId: 'a1' }

test('rollup: first-line fields, model from the assistant lines, one usage per message id (its last line)', () => {
  const text = agentTranscript({
    ...A, branch: 'feature/43-pr-mode', cwd: '/work/repo', prompt: 'review it', at: '2026-10-01T10:00:00.000Z',
    steps: [
      { id: 'm1', usage: { input_tokens: 100, output_tokens: 3 }, at: '2026-10-01T10:00:10.000Z' },
      { id: 'm1', usage: { input_tokens: 100, output_tokens: 169 }, at: '2026-10-01T10:00:11.000Z' },
      { id: 'm2', model: 'claude-sonnet-4-5', usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 7 }, at: '2026-10-01T10:00:30.000Z' },
    ],
  })
  const { roll } = feed(emptyRollup(), text)
  expect(roll.agentId).toBe('a1')
  expect(roll.sessionId).toBe('s1')
  expect(roll.gitBranch).toBe('feature/43-pr-mode')
  expect(roll.cwd).toBe('/work/repo')
  expect(roll.prompt).toBe('review it')
  expect(roll.model).toBe('claude-sonnet-4-5')
  expect(roll.steps).toBe(2)
  expect(roll.startedAt).toBe(Date.parse('2026-10-01T10:00:00.000Z'))
  expect(roll.lastAt).toBe(Date.parse('2026-10-01T10:00:30.000Z'))
  expect(roll.byModel).toEqual({
    'claude-opus-4-5': { input: 100, output: 169, cacheRead: 0, cacheWrite: 0 },
    'claude-sonnet-4-5': { input: 50, output: 20, cacheRead: 1000, cacheWrite: 7 },
  })
})

test('feed: resumes from the byte position; a half-written line waits, a continued message replaces its usage', () => {
  const head = jsonl([userLine({ ...A, prompt: '审查这个改动' }), assistantLine(A, { id: 'm1', usage: { input_tokens: 100, output_tokens: 3 } })])
  const cont = assistantLine(A, { id: 'm1', usage: { input_tokens: 100, output_tokens: 169 } })
  const next = assistantLine(A, { id: 'm2', usage: { input_tokens: 40, output_tokens: 2 } })
  const file = head + `${cont}\n${next}\n`
  // First read stops in the middle of the continuation line.
  const cut = head.length + 20
  const first = feed(emptyRollup(), file.slice(0, cut))
  expect(first.roll.steps).toBe(1)
  expect(first.roll.byModel['claude-opus-4-5']?.output).toBe(3)
  // The position counts UTF-8 bytes (the prompt holds six 3-byte characters), up to the last complete line.
  expect(first.bytes).toBe(head.length + 12)
  // The next read starts at that byte position: the continuation replaces m1's usage, m2 adds.
  const rest = file.slice(head.length)
  const second = feed(first.roll, rest)
  expect(second.roll.steps).toBe(2)
  expect(second.roll.byModel).toEqual({ 'claude-opus-4-5': { input: 140, output: 171, cacheRead: 0, cacheWrite: 0 } })
  expect(second.roll).toEqual(feed(emptyRollup(), file).roll)
  // Nothing new: the rollup and the position stay.
  expect(feed(second.roll, '').bytes).toBe(0)
})

test('rollup: a broken line is skipped, the rest still counts', () => {
  const text = jsonl([userLine(A), '{"type":"assistant", broken', assistantLine(A, { id: 'm1', usage: { input_tokens: 10, output_tokens: 5 } })])
  const { roll } = feed(emptyRollup(), text)
  expect(roll.steps).toBe(1)
  expect(roll.byModel).toEqual({ 'claude-opus-4-5': { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 } })
  expect(roll.gitBranch).toBe('dev')
})

test('rollup: edit results add their patch lines per path; a created file counts its lines; other results add nothing', () => {
  const created = JSON.stringify({ ...A, type: 'user', toolUseResult: { type: 'create', filePath: '/w/new.ts', content: 'a\nb', structuredPatch: [] }, message: { role: 'user', content: [] } })
  const read = JSON.stringify({ ...A, type: 'user', toolUseResult: { type: 'text', file: { filePath: '/w/x.ts', content: 'x' } }, message: { role: 'user', content: [] } })
  const bash = JSON.stringify({ ...A, type: 'user', toolUseResult: { stdout: 'ok', stderr: '' }, message: { role: 'user', content: [] } })
  const text = jsonl([userLine(A), editLine(A, { path: '/w/a.ts', lines: [' a', '-b', '+c'] }), editLine(A, { path: '/w/a.ts', lines: ['+d', '+e'] }), created, read, bash])
  expect(feed(emptyRollup(), text).roll.edits).toEqual({ '/w/a.ts': { add: 3, del: 1 }, '/w/new.ts': { add: 2, del: 0 } })
  expect(feed(emptyRollup(), jsonl([userLine(A), read, bash])).roll.edits).toBeUndefined()
})

test('rollup: at most 50 edited paths; a path already counted still adds up', () => {
  const lines = Array.from({ length: 52 }, (_, i) => editLine(A, { path: `/w/f${i}.ts`, lines: ['+x'] }))
  const { roll } = feed(emptyRollup(), jsonl([userLine(A), ...lines, editLine(A, { path: '/w/f0.ts', lines: ['-y'] })]))
  expect(Object.keys(roll.edits ?? {})).toHaveLength(50)
  expect(roll.edits?.['/w/f0.ts']).toEqual({ add: 1, del: 1 })
})

test('rollup: effort from the assistant lines\' top-level field, the latest wins', () => {
  const text = agentTranscript({ ...A, steps: [{ id: 'm1', effort: 'high' }, { id: 'm2', model: 'claude-sonnet-5-5', effort: 'low' }] })
  expect(feed(emptyRollup(), text).roll).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' })
  // A transcript that never says its effort: none.
  expect(feed(emptyRollup(), agentTranscript(A)).roll.effort).toBeUndefined()
})

test('rollup: effort comes from the line that sets the model; a model line without effort clears it, never borrows the last', () => {
  const text = agentTranscript({
    ...A,
    steps: [{ id: 'm1', model: 'claude-sonnet-5-5', effort: 'low' }, { id: 'm2', model: 'claude-sonnet-5-5', effort: 'low' }, { id: 'm3', model: 'claude-opus-5-5' }],
  })
  const roll = feed(emptyRollup(), text).roll
  expect(roll.model).toBe('claude-opus-5-5')
  expect(roll.effort).toBeUndefined()
})

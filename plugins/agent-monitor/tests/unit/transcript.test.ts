import { test, expect } from 'claude-code/testing'

import { emptyRollup, feed } from '../../hooks/transcript'
import { agentTranscript, assistantLine, jsonl, userLine } from '../transcripts'

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

import { test, expect } from 'claude-code/testing'

import { MAX_WHOLE, historyRecs, projectDir, refreshProject, withHistory } from '../../hooks/history'
import type { TxEntry, TxIo } from '../../hooks/history'
import { agentFiles, agentPaths, assistantLine, fakeFs, jsonl } from '../transcripts'
import type { FakeFs } from '../transcripts'

const PROJECT = '/home/u/.claude/projects/-work-repo'

// The TxIo the register module builds from `$.fs` and `$.process`, here over the fake file system.
const ioOf = (fs: FakeFs): TxIo => ({
  list: async dir => fs.list(dir),
  read: async path => fs.read(path),
  tail: async (path, from) => fs.tail(path, from),
})

test('projectDir: every character but a letter or digit becomes a dash', () => {
  expect(projectDir('/Users/niko/.claude', '/Users/niko/AI_Workspace/a.b/claude-code-mods')).toBe('/Users/niko/.claude/projects/-Users-niko-AI-Workspace-a-b-claude-code-mods')
})

test('refresh: a small file is read whole once; an unchanged file is not read again', async () => {
  const a = { sessionId: 's1', agentId: 'a1', type: 'Explore', desc: 'so.med · map the code', model: 'claude-sonnet-4-5' }
  const fs = fakeFs(agentFiles(PROJECT, a))
  const cache = new Map<string, TxEntry>()
  expect(await refreshProject(ioOf(fs), PROJECT, cache)).toBe(true)
  const p = agentPaths(PROJECT, a)
  expect(fs.tally.reads.get(p.jsonl)).toBe(1)
  expect(historyRecs(cache).a1).toMatchObject({ type: 'Explore', desc: 'so.med · map the code', task: 'map the code', model: 'claude-sonnet-4-5', status: 'done', steps: 1 })
  fs.reset()
  expect(await refreshProject(ioOf(fs), PROJECT, cache)).toBe(false)
  expect(fs.tally.reads.size).toBe(0)
  expect(fs.tally.tails).toHaveLength(0)
})

test('refresh: a file over 4 MiB is read from its byte position on; appended lines count once', async () => {
  const a = { sessionId: 's1', agentId: 'big', steps: [{ id: 'm1', usage: { input_tokens: 10, output_tokens: 1 } }] }
  const fs = fakeFs()
  const p = agentPaths(PROJECT, a)
  const files = agentFiles(PROJECT, a)
  fs.write(p.meta, files[p.meta]!)
  fs.write(p.jsonl, files[p.jsonl]!, MAX_WHOLE + 1)
  const cache = new Map<string, TxEntry>()
  await refreshProject(ioOf(fs), PROJECT, cache)
  expect(fs.tally.reads.get(p.jsonl)).toBeUndefined()
  expect(fs.tally.tails).toEqual([{ path: p.jsonl, from: 0 }])
  const first = files[p.jsonl]!.length
  fs.append(p.jsonl, jsonl([assistantLine(a, { id: 'm2', usage: { input_tokens: 20, output_tokens: 2 } })]))
  fs.reset()
  await refreshProject(ioOf(fs), PROJECT, cache)
  expect(fs.tally.tails).toEqual([{ path: p.jsonl, from: first }])
  expect(historyRecs(cache).big?.steps).toBe(2)
  expect(historyRecs(cache).big?.spent).toEqual({ input: 30, output: 3, cacheRead: 0, cacheWrite: 0 })
})

const HOOK = 'PreToolUse:Bash hook error: rm -rf is blocked'
const at = (iso: string) => Date.parse(iso)

test('withHistory: a transcript\'s refusals and errored results, timestamped and told apart, replace what a live record kept', async () => {
  const fs = fakeFs(agentFiles(PROJECT, { sessionId: 's1', agentId: 'o1', denials: [HOOK], errors: ['Exit code 1\nboom'] }))
  const cache = new Map<string, TxEntry>()
  await refreshProject(ioOf(fs), PROJECT, cache)
  // Kept from an older build (a hot reload keeps `$.state`): no times, the errored result counted as a refusal.
  const old = { ...historyRecs(cache).o1!, denied: 2, refusals: 2, reasons: [{ text: 'Exit code 1', n: 1 }, { text: HOOK, n: 1 }] }
  const merged = withHistory({ o1: old }, historyRecs(cache)).o1!
  expect(merged.reasons).toEqual([
    { text: HOOK, n: 1, at: at('2026-10-01T10:02:00.000Z') },
    { text: 'Exit code 1', n: 1, at: at('2026-10-01T10:01:30.000Z'), failed: true },
  ])
  expect([merged.denied, merged.refusals]).toEqual([2, 1])
})

test('withHistory: a clean transcript clears the refusals a live record kept', async () => {
  const fs = fakeFs(agentFiles(PROJECT, { sessionId: 's1', agentId: 'c1' }))
  const cache = new Map<string, TxEntry>()
  await refreshProject(ioOf(fs), PROJECT, cache)
  const old = { ...historyRecs(cache).c1!, denied: 1, refusals: 1, reasons: [{ text: 'no', n: 1 }] }
  expect(withHistory({ c1: old }, historyRecs(cache)).c1).toMatchObject({ denied: 0, refusals: 0, reasons: [] })
})

test('refresh: with a session id only that session\'s subagents are listed', async () => {
  const fs = fakeFs({ ...agentFiles(PROJECT, { sessionId: 's1', agentId: 'a1' }), ...agentFiles(PROJECT, { sessionId: 's2', agentId: 'a2' }) })
  const cache = new Map<string, TxEntry>()
  await refreshProject(ioOf(fs), PROJECT, cache, 's2')
  expect(fs.tally.lists).toEqual([`${PROJECT}/s2/subagents`])
  expect(Object.keys(historyRecs(cache))).toEqual(['a2'])
})

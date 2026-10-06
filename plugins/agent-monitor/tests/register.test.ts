// The whole mod through its hooks: subagent history read from the project's transcripts, on synthetic files (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { OTHER, PROJECT, ROOT, mountPane, rowKeys, shown, st, wire } from './testkit'
import type { Dollar } from './testkit'
import { agentFiles, agentMeta, agentPaths, agentTranscript, assistantLine, fakeFs, jsonl, userLine } from './transcripts'

const OLD1 = { sessionId: 'old1', agentId: 'a1', type: 'Explore', desc: 'map the parser', model: 'claude-sonnet-4-5', at: '2026-10-01T09:00:00.000Z' }
const OLD2 = { sessionId: 'old2', agentId: 'a2', type: 'reviewer', desc: 'review the diff', model: 'claude-opus-4-5', at: '2026-10-02T09:00:00.000Z' }

test('/clear: /sub still lists the subagents of earlier sessions, with type, description and model', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const live = { sessionId: 'cur', agentId: 'a3', type: 'worker', desc: 'fix the lexer', at: '2026-10-03T08:59:00.000Z' }
  wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(PROJECT, OLD2), ...agentFiles(PROJECT, live) }))
  on('agent.spawn', async () => ({ agentId: 'a3', model: 'claude-opus-4-5' }))
  await $.session.start({ cwd: ROOT } as never)
  // An agent of this session, seen by the hooks, then cleared from the live records with the session.
  await $.agent.spawn({ subagentType: 'worker', description: 'fix the lexer', prompt: 'go' } as never)
  await $.session.end({ reason: 'clear', sessionId: 'cur' } as never)
  st.session = 'next'
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  expect(await rowKeys(ui)).toEqual(['row:a3', 'row:a2', 'row:a1'])
  // Each row carries its own type and model (the model from the transcript's assistant lines; meta has none).
  // A row is the outermost Text holding the task (the task cell is a Text nested in it): the longest match.
  const row = async (task: string) => (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t.includes(task)).sort((a, b) => b.length - a.length)[0] ?? ''
  expect(await row('map the parser')).toMatch(/Explore\s+sonnet/)
  expect(await row('review the diff')).toMatch(/reviewer\s+opus/)
  expect(await row('fix the lexer')).toMatch(/worker\s+opus/)
})

test('an agent in both the hook events and its transcript is one row', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const live = { sessionId: 'cur', agentId: 'a9', type: 'worker', desc: 'fix the parser', model: 'claude-opus-4-5' }
  const fs = wire(on, fakeFs(agentFiles(PROJECT, live)))
  on('agent.spawn', async () => ({ agentId: 'a9', model: 'claude-opus-4-5' }))
  await $.session.start({ cwd: ROOT } as never)
  await $.agent.spawn({ subagentType: 'worker', description: 'fix the parser', prompt: 'go' } as never)
  st.agents = [{ id: 'a9', type: 'worker', status: 'running', description: 'fix the parser' }]
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(fs.tally.reads.get(agentPaths(PROJECT, live).jsonl)).toBe(1)
  expect(await rowKeys(await mountPane($))).toEqual(['row:a9'])
})

test('only the current project\'s transcript directory is read', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const fs = wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(OTHER, { ...OLD2, desc: 'elsewhere work' }) }))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const text = await shown(await mountPane($))
  expect(text).toContain('map the parser')
  expect(text).not.toContain('elsewhere work')
  expect(fs.tally.lists.some(d => d.startsWith(OTHER))).toBe(false)
})

test('the 1 s tick reads only this session\'s folder, and no unchanged file again', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const live = { sessionId: 'cur', agentId: 'a9', type: 'worker', desc: 'fix the parser' }
  const fs = wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(PROJECT, live) }))
  on('agent.spawn', async () => ({ agentId: 'a9', model: 'claude-opus-4-5' }))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await $.agent.spawn({ subagentType: 'worker', description: 'fix the parser', prompt: 'go' } as never)
  st.agents = [{ id: 'a9', type: 'worker', status: 'running', description: 'fix the parser' }]
  fs.reset()
  await clock.advance(1000)
  expect(fs.tally.lists).toEqual([`${PROJECT}/cur/subagents`])
  expect(fs.tally.reads.size).toBe(0)
  // The live agent's transcript grows: the next tick reads that file once, nothing else.
  fs.append(agentPaths(PROJECT, live).jsonl, jsonl([assistantLine(live, { id: 'm2', usage: { input_tokens: 5, output_tokens: 1 } })]))
  await clock.advance(1000)
  expect([...fs.tally.reads.keys()]).toEqual([agentPaths(PROJECT, live).jsonl])
})

// A transcript past 4 MiB is read through `tail`, whose output the engine cuts (isStdoutTruncated): the fake caps it at `tailCap`.
const BIG = 4 * 1024 * 1024 + 1
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, model: 'claude-opus-5-5', usage: { input_tokens: 1_000, output_tokens: 100 }, at: '2026-10-01T10:01:00.000Z' }))
async function bigSetup($: Dollar, on: Parameters<typeof wire>[0], text: string) {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const fs = wire(on, fakeFs({ [agentPaths(PROJECT, BIG_AGENT).meta]: agentMeta(BIG_AGENT) }))
  fs.write(agentPaths(PROJECT, BIG_AGENT).jsonl, text, BIG)
  fs.tailCap = 800
  await $.session.start({ cwd: ROOT } as never)
  const sub = async () => { await $.command.run({ command: 'sub', args: '' } as never); await clock.settle() }
  return { fs, sub }
}
const BIG_AGENT = { sessionId: 'old1', agentId: 'b1', type: 'worker', desc: 'long haul', at: '2026-10-01T10:00:00.000Z', steps: many(20) }
const bigRow = async ($: Dollar) => (await (await mountPane($)).findAll({ type: 'Text' })).map(t => t.text).filter(t => t.includes('long haul')).sort((a, b) => b.length - a.length)[0] ?? ''

test('a transcript past 4 MiB is read in cut chunks across refreshes, and its totals come out whole', async ($, on) => {
  const { fs, sub } = await bigSetup($, on, agentTranscript(BIG_AGENT))
  await sub()
  expect(fs.tally.tails.length).toBeGreaterThan(1) // several chunks in one refresh
  await sub()
  await sub()
  // 20 steps of 1,000 in + 100 out: 22,000 tokens.
  expect(await bigRow($)).toContain('22.0k')
})

test('a single line longer than one read is skipped once, not read again on every refresh', async ($, on) => {
  const huge = JSON.stringify({ type: 'user', sessionId: 'old1', agentId: 'b1', timestamp: '2026-10-01T10:00:10.000Z', message: { role: 'user', content: 'x'.repeat(3_000) } })
  const text = jsonl([userLine(BIG_AGENT), huge, ...many(4).map(s => assistantLine(BIG_AGENT, s))])
  const { fs, sub } = await bigSetup($, on, text)
  for (let i = 0; i < 4; i++) await sub()
  const settled = fs.tally.tails.length
  await sub()
  await sub()
  expect(fs.tally.tails.length).toBe(settled) // the file did not change: no read
  // The lines after the long one still count: 4 steps of 1,100.
  expect(await bigRow($)).toContain('4.4k')
})

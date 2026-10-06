// The whole mod through its hooks: subagent history read from the project's transcripts, on synthetic files (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { OTHER, PROJECT, ROOT, mountPane, rowKeys, shown, st, wire } from './testkit'
import { agentFiles, agentPaths, assistantLine, fakeFs, jsonl } from './transcripts'

const OLD1 = { sessionId: 'old1', agentId: 'a1', type: 'Explore', desc: 'map the parser', model: 'claude-sonnet-4-5', at: '2026-10-01T09:00:00.000Z' }
const OLD2 = { sessionId: 'old2', agentId: 'a2', type: 'reviewer', desc: 'review the diff', model: 'claude-opus-4-5', at: '2026-10-02T09:00:00.000Z' }

test('/clear: /sub still lists the subagents of earlier sessions, with type, description and model', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(PROJECT, OLD2) }))
  await $.session.start({ cwd: ROOT } as never)
  await $.session.end({ reason: 'clear', sessionId: 'cur' } as never)
  st.session = 'next'
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const text = await shown(await mountPane($))
  expect(text).toContain('map the parser')
  expect(text).toContain('review the diff')
  expect(text).toContain('Explore')
  expect(text).toContain('reviewer')
  expect(text).toContain('sonnet')
  expect(text).toContain('opus')
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

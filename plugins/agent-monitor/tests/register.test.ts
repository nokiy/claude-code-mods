// The whole mod through its hooks: subagent history read from the project's transcripts, on synthetic files (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { OTHER, PROJECT, ROOT, mountPane, shown, st, wire } from './testkit'
import { agentFiles, fakeFs } from './transcripts'

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

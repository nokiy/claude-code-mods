// The /sub PR mode through the whole mod: subagents grouped by the PR their first-line branch belongs to (a fake `gh pr list` and
// fake transcripts, testkit.ts), the Other group, expand / collapse, the [PR] [Agent] switch, and a failed gh keeping the last index.
import { expect, mock, test } from 'claude-code/testing'

import { PROJECT, ROOT, ghPr, listKeys, mountPane, st, wire } from './testkit'
import { agentFiles, fakeFs } from './transcripts'

const NOW = Date.parse('2026-10-03T09:00:00Z')
const step = (input: number, output: number) => [{ id: 'm1', usage: { input_tokens: input, output_tokens: output }, at: '2026-10-01T10:01:00.000Z' }]
// Two on the open spec PR #49 (a ticket branch it closes, and its own head branch), one on merged PR #38, one on dev.
const A1 = { sessionId: 's1', agentId: 'a1', type: 'worker', desc: 'build the index', branch: 'feature/43-pr-mode', at: '2026-10-01T10:00:00.000Z', steps: step(40_000, 2_000) }
const A2 = { sessionId: 's1', agentId: 'a2', type: 'reviewer', desc: 'review the spec', branch: 'spec/36-pr-agent-views', at: '2026-10-01T09:00:00.000Z', steps: step(10_000, 1_000) }
const A3 = { sessionId: 's2', agentId: 'a3', type: 'Explore', desc: 'map the card', branch: 'feature/38-pass-next', at: '2026-10-01T08:00:00.000Z' }
const A4 = { sessionId: 's2', agentId: 'a4', type: 'Explore', desc: 'look around', branch: 'dev', at: '2026-10-01T07:00:00.000Z' }
const PRS = [ghPr(49, 'PR card and agents', 'spec/36-pr-agent-views', [43, 44]), ghPr(38, 'Pass next', 'feature/38-pass-next', [38], 'MERGED'), ghPr(50, 'Retro', 'adhoc/retro', [], 'MERGED'), ghPr(30, 'Closed one', 'feature/30-x', [30], 'CLOSED')]

type Run = Parameters<Parameters<typeof test>[1]>
async function openSub($: Run[0], on: Run[1], branch = 'feature/44-row-layout') {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  wire(on, fakeFs({ ...agentFiles(PROJECT, A1), ...agentFiles(PROJECT, A2), ...agentFiles(PROJECT, A3), ...agentFiles(PROJECT, A4) }))
  st.branch = branch
  st.gh = JSON.stringify(PRS)
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  return { clock, ui: await mountPane($) }
}

test('/sub opens in PR mode: the current branch\'s PR first and open, the others closed, Other last', async ($, on) => {
  const { ui } = await openSub($, on)
  expect(await listKeys(ui)).toEqual(['group:pr:49', 'row:a1', 'row:a2', 'group:pr:38', 'group:other'])
})

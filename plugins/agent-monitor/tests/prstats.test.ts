// The per-PR subagent totals agent-monitor publishes in `$.state` (`prStats`, docs/adr/0001-cross-mod-state.md) for other mods to
// read, through the whole mod: fake transcripts and a fake `gh pr list` (testkit.ts), the value taken from the mod's own writes.
import { expect, mock, test } from 'claude-code/testing'

import { PROJECT, ROOT, ghPr, mountPane, st, step, wire } from './testkit'
import type { Dollar } from './testkit'
import { agentFiles, assistantLine, fakeFs, jsonl, userLine } from './transcripts'

const NOW = Date.parse('2026-10-03T09:00:00Z')
const opus = (id: string, at: string, input: number, output: number) => ({ id, model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: output }, at })
// Two agents on PR #49 whose spans overlap: a1 09:58–10:01, a2 10:00–10:02 (its last line is a hook refusal at 10:02), so the PR's
// wall time is 4 min while the sum of the two is 5. a2 was refused twice. Opus 5.5 is $4 in, $20 out per million.
const A1 = { sessionId: 's1', agentId: 'a1', type: 'worker', desc: 'build the index', branch: 'feature/43-pr-mode', at: '2026-10-01T09:58:00.000Z', steps: [opus('m1', '2026-10-01T10:01:00.000Z', 40_000, 2_000)] }
const A2 = { sessionId: 's1', agentId: 'a2', type: 'reviewer', desc: 'review the spec', branch: 'spec/36-pr-agent-views', at: '2026-10-01T10:00:00.000Z', steps: [opus('m1', '2026-10-01T10:01:30.000Z', 10_000, 1_000)], denials: ['PreToolUse:Bash hook error: no rm', 'PreToolUse:Edit hook error: locked'] }
// One agent on dev (Other: never published); PR #38 is the session's branch but has no agent (not published either).
const A3 = { sessionId: 's1', agentId: 'a3', type: 'Explore', desc: 'look around', branch: 'dev', at: '2026-10-01T07:00:00.000Z' }
const PRS = [ghPr(49, 'PR card and agents', 'spec/36-pr-agent-views', [43, 44]), ghPr(38, 'Pass next', 'feature/38-pass-next', [38], 'MERGED')]
// The main session's own transcript, beside the session folder, with usage that must not count.
const MAIN = { [`${PROJECT}/s1.jsonl`]: jsonl([userLine({ sessionId: 's1', agentId: '', branch: 'spec/36-pr-agent-views' }), assistantLine({ sessionId: 's1', agentId: '' }, opus('mm', '2026-10-01T10:00:30.000Z', 900_000, 90_000))]) }

type Run = [Dollar, Parameters<typeof wire>[0]]
type Stats = Record<string, { tokens: number; cost?: number; ms: number; refusals: number }>
// A test's `$` holds no state to read back: the published value is what agent-monitor's latest write of `prStats` carried.
async function start($: Run[0], on: Run[1], files: Record<string, string>) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  wire(on, fakeFs({ ...agentFiles(PROJECT, A1), ...agentFiles(PROJECT, A2), ...agentFiles(PROJECT, A3), ...files }))
  st.branch = 'feature/38-pass-next'
  st.gh = JSON.stringify(PRS)
  const pub = { value: undefined as Stats | undefined, writes: 0 }
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'agent-monitor' && e.key === 'prStats') Object.assign(pub, { value: e.value as Stats, writes: pub.writes + 1 })
    return next(e)
  })
  on('turn.start', async (_$, e) => e as never)
  await $.session.start({ cwd: ROOT } as never)
  await $.turn.start({ turnId: 't0' } as never)
  await clock.settle()
  return { clock, pub }
}

test('each PR with subagents gets its tokens, cost, wall time and hook refusals; Other and agentless PRs are left out', async ($, on) => {
  const { pub } = await start($, on, {})
  expect(Object.keys(pub.value ?? {})).toEqual(['49'])
  const s = pub.value!['49']!
  expect(s.tokens).toBe(53_000)
  expect(s.cost?.toFixed(6)).toBe('0.260000')
  expect(s.ms).toBe(4 * 60_000)
  expect(s.refusals).toBe(2)
})

test("the main session's usage is not counted: neither its transcript nor its own steps", async ($, on) => {
  const { clock, pub } = await start($, on, MAIN)
  // A main-loop step (no agentId) with large usage, answered beneath the plugins by testkit's turn.step.
  st.usage = { input_tokens: 500_000, output_tokens: 50_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const step = $.turn.step({ turnId: 't', index: 0, model: 'claude-opus-5-5' } as never)
  for await (const _ of step) { /* drain */ }
  await $.turn.start({ turnId: 't1' } as never)
  await clock.advance(2000)
  const s = pub.value?.['49']
  expect({ ...s, cost: s?.cost?.toFixed(6) }).toEqual({ tokens: 53_000, cost: '0.260000', ms: 4 * 60_000, refusals: 2 })
})

// The group row of the /sub PR mode, as a person reads it off the pane.
async function groupRow($: Run[0]) {
  await $.command.run({ command: 'sub', args: '' } as never)
  const ui = await mountPane($)
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t.includes('#49 PR card')).sort((a, b) => b.length - a.length)[0] ?? ''
}

test('a PR\'s tokens are every step\'s usage added up, not the last step\'s context', async ($, on) => {
  // Three distinct messages of 10k in + 1k out each: 33k spent, while the last step alone holds 11k.
  const steps = ['m1', 'm2', 'm3'].map((id, i) => opus(id, `2026-10-01T10:0${i + 1}:00.000Z`, 10_000, 1_000))
  const A4 = { sessionId: 's1', agentId: 'a4', type: 'worker', desc: 'three steps', branch: 'feature/44-row-layout', at: '2026-10-01T11:00:00.000Z', steps }
  const { pub } = await start($, on, agentFiles(PROJECT, A4))
  expect(pub.value?.['49']?.tokens).toBe(53_000 + 33_000)
  expect(await groupRow($)).toMatch(/3 agents\s+86\.0k tok/)
})

test('an agent watched live keeps every step\'s usage when its Agent result arrives with the last turn\'s', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  wire(on, fakeFs())
  st.branch = 'dev'
  st.gh = JSON.stringify(PRS)
  const pub = { value: undefined as Stats | undefined }
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'agent-monitor' && e.key === 'prStats') pub.value = e.value as Stats
    return next(e)
  })
  on('agent.spawn', async () => ({ agentId: 'L1', model: 'claude-opus-5-5' }))
  const last = { input_tokens: 10_000, output_tokens: 1_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  on('tool.call', async () => ({ result: { agentId: 'L1', status: 'completed', totalTokens: 11_000, totalDurationMs: 60_000, usage: last } }) as never)
  await $.session.start({ cwd: ROOT } as never)
  await $.agent.spawn({ subagentType: 'worker', description: '#44 tidy the rows', prompt: 'go' } as never)
  st.agents = [{ id: 'L1', type: 'worker', status: 'running', description: '#44 tidy the rows' }]
  for (let i = 0; i < 3; i++) await step($, 'L1', 'claude-opus-5-5', { input_tokens: 10_000, output_tokens: 1_000 })
  await $.tool.call({ tool: 'Agent', subagent_type: 'worker', description: '#44 tidy the rows', prompt: 'go' } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(pub.value?.['49']?.tokens).toBe(33_000)
})

test('the group row shows the same time as the published value: wall time, not the sum', async ($, on) => {
  const { pub } = await start($, on, {})
  expect(pub.value?.['49']?.ms).toBe(4 * 60_000)
  expect(await groupRow($)).toMatch(/\s4m00s\s/)
})

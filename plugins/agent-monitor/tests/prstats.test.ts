// The per-PR subagent totals agent-monitor publishes in `$.state` (`prStats`, docs/adr/0001-cross-mod-state.md) for other mods to
// read, through the whole mod: fake transcripts and a fake `gh pr list` (testkit.ts), the value taken from the mod's own writes.
import { expect, mock, test } from 'claude-code/testing'

import { PROJECT, ROOT, countStore, ghPr, listed, mountPane, st, step, wire } from './testkit'
import type { Dollar } from './testkit'
import { agentFiles, assistantLine, fakeFs, jsonl, userLine } from './transcripts'
import { indexKey, refreshProject, toIndex } from '../hooks/history'
import type { TxEntry } from '../hooks/history'
import { parsePrList, prIndexKey } from '../hooks/prindex'

const NOW = Date.parse('2026-10-03T09:00:00Z')
const opus = (id: string, at: string, input: number, output: number) => ({ id, model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: output }, at })
// Two agents on PR #49 whose spans overlap: a1 09:58–10:01, a2 10:00–10:02 (its last line is a hook refusal at 10:02), so the PR's
// wall time is 4 min while the sum of the two is 5. a2 was refused twice. Opus 5.5 is $4 in, $20 out per million.
const A1 = {
  sessionId: 's1', agentId: 'a1', type: 'worker', desc: 'build the index', branch: 'feature/43-pr-mode', at: '2026-10-01T09:58:00.000Z',
  steps: [opus('m1', '2026-10-01T10:01:00.000Z', 40_000, 2_000)],
}
const A2 = {
  sessionId: 's1', agentId: 'a2', type: 'reviewer', desc: 'review the spec', branch: 'spec/36-pr-agent-views', at: '2026-10-01T10:00:00.000Z',
  steps: [opus('m1', '2026-10-01T10:01:30.000Z', 10_000, 1_000)],
  denials: ['PreToolUse:Bash hook error: no rm', 'PreToolUse:Edit hook error: locked'],
}
// One agent on dev (Other: never published); PR #38 is the session's branch but has no agent (not published either).
const A3 = { sessionId: 's1', agentId: 'a3', type: 'Explore', desc: 'look around', branch: 'dev', at: '2026-10-01T07:00:00.000Z' }
const PRS = [ghPr(49, 'PR card and agents', 'spec/36-pr-agent-views', [43, 44]), ghPr(38, 'Pass next', 'feature/38-pass-next', [38], 'MERGED')]
// The main session's own transcript, beside the session folder, with usage that must not count.
const MAIN = {
  [`${PROJECT}/s1.jsonl`]: jsonl([
    userLine({ sessionId: 's1', agentId: '', branch: 'spec/36-pr-agent-views' }),
    assistantLine({ sessionId: 's1', agentId: '' }, opus('mm', '2026-10-01T10:00:30.000Z', 900_000, 90_000)),
  ]),
}

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

// A live agent of this session on PR #49 (by its description's `#44`), seen through its steps; `files` are what the fake fs holds.
async function live($: Run[0], on: Run[1], id: string, files: Record<string, string> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  wire(on, fakeFs(files))
  st.branch = 'dev'
  st.gh = JSON.stringify(PRS)
  const pub = { value: undefined as Stats | undefined }
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'agent-monitor' && e.key === 'prStats') pub.value = e.value as Stats
    return next(e)
  })
  await $.session.start({ cwd: ROOT } as never)
  st.agents = [listed(id, 'worker', '#44 tidy the rows')]
  return { clock, pub }
}

test('an agent watched live publishes every step\'s usage once its turn completes', async ($, on) => {
  const { clock, pub } = await live($, on, 'L1')
  for (let i = 0; i < 3; i++) await step($, 'L1', 'claude-opus-5-5', { input_tokens: 10_000, output_tokens: 1_000 }, undefined, [], i)
  await $.turn.complete({ agentId: 'L1', reason: 'answer', answer: 'tidied', durationMs: 60_000, isAborted: false, turnId: 't-L1' } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(pub.value?.['49']?.tokens).toBe(33_000)
})

// A running agent's refusals come from its transcript as Claude Code writes it, the same in Code Mode: no tool call is hooked.
test('refusals count hook denials only: a failed Bash run is no refusal', async ($, on) => {
  const R1 = { sessionId: 'cur', agentId: 'R1', type: 'worker', desc: '#44 tidy the rows', denials: ['PreToolUse:Bash hook error: no rm'], errors: ['exit code 1'] }
  const { clock, pub } = await live($, on, 'R1', agentFiles(PROJECT, R1))
  await step($, 'R1', 'claude-opus-5-5', { input_tokens: 1_000, output_tokens: 100 })
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(pub.value?.['49']?.refusals).toBe(1)
})

test('the group row shows the same time as the published value: wall time, not the sum', async ($, on) => {
  const { pub } = await start($, on, {})
  expect(pub.value?.['49']?.ms).toBe(4 * 60_000)
  expect(await groupRow($)).toMatch(/\s4m00s\s/)
})

// A fresh session, before any turn: the store holds the project's transcript index and the PR index an earlier session wrote.
async function stored(agents: readonly (typeof A1 | typeof A2 | typeof A3)[] = [A1, A2, A3], prAt = NOW) {
  const fs = fakeFs(Object.assign({}, ...agents.map(a => agentFiles(PROJECT, a))) as Record<string, string>)
  const cache = new Map<string, TxEntry>()
  await refreshProject({ list: async d => fs.list(d), read: async p => fs.read(p), tail: async (p, from) => fs.tail(p, from) }, PROJECT, cache)
  return { [indexKey(PROJECT)]: toIndex(cache, PROJECT, NOW), [prIndexKey(ROOT)]: { at: prAt, prs: parsePrList(JSON.stringify(PRS)) } }
}

// A fresh session (no input yet) over the store's indexes and the transcripts `files` on disk. `pub.values`: every prStats write in
// order; `pub.ghAtFirst`: the gh runs made by the time of the first.
async function fresh($: Run[0], on: Run[1], seed: Record<string, unknown>, files: Record<string, string> = {}, hold?: Parameters<typeof countStore>[2]) {
  const clock = mock.clock(on, { now: NOW })
  const store = countStore(on, seed, hold)
  const fs = wire(on, fakeFs(files))
  st.gh = null
  const pub = { value: undefined as Stats | undefined, writes: 0, values: [] as Stats[], ghAtFirst: undefined as number | undefined }
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'agent-monitor' && e.key === 'prStats') {
      Object.assign(pub, { value: e.value as Stats, writes: pub.writes + 1, ghAtFirst: pub.ghAtFirst ?? st.ghCalls })
      pub.values.push(e.value as Stats)
    }
    return next(e)
  })
  return { clock, store, fs, pub }
}
const onDisk = { ...agentFiles(PROJECT, A1), ...agentFiles(PROJECT, A2), ...agentFiles(PROJECT, A3) }
const figures = (s: Stats[string] | undefined) => ({ ...s, cost: s?.cost?.toFixed(6) })
const ALL = { tokens: 53_000, cost: '0.260000', ms: 4 * 60_000, refusals: 2 }

// pr-hint's card reads the value at once: the first write carries the stored figures, before gh runs or any transcript is read.
test('session start publishes what the store already holds first, before any turn, reading no transcript and running no gh', async ($, on) => {
  const { clock, fs, pub } = await fresh($, on, await stored())
  await $.session.start({ cwd: ROOT } as never)
  await clock.settle()
  expect(figures(pub.values[0]?.['49'])).toEqual(ALL)
  expect(fs.tally.reads.size).toBe(0)
  expect(pub.ghAtFirst).toBe(0)
})

// The stored index is written only on a full refresh, so it lags (here it holds a1 alone): the same background chain then runs the
// refresh the first turn would, so with no input at all the value ends as /sub gives it; the first turn does not repeat it.
test('session start, no input: the published value ends as /sub\'s refresh gives it; the first turn does not refresh again', async ($, on) => {
  on('turn.start', async (_$, e) => e as never)
  const { clock, fs, pub } = await fresh($, on, await stored([A1]), onDisk)
  await $.session.start({ cwd: ROOT } as never)
  await clock.settle()
  expect(pub.values[0]?.['49']?.tokens).toBe(42_000) // the stored figures, at once
  expect(figures(pub.value?.['49'])).toEqual(ALL)
  fs.reset()
  await $.turn.start({ turnId: 't0' } as never)
  await clock.settle()
  expect(fs.tally.lists).toEqual([])
  const writes = pub.writes
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(figures(pub.value?.['49'])).toEqual(ALL)
  expect(pub.writes).toBe(writes)
})

test('session start with nothing stored and nothing on disk publishes nothing', async ($, on) => {
  const { clock, pub } = await fresh($, on, {})
  await $.session.start({ cwd: ROOT } as never)
  await clock.settle()
  expect(pub.writes).toBe(0)
})

// A hot reload runs session.start again with the value already published, and the stored index may lag (here it holds a1 alone):
// its figures are never written over the value; only the transcript refresh that follows writes. (The PR index is due and gh held,
// so its own refresh, which publishes whatever the history holds then, cannot write first.)
test('session start keeps a value already published (a reload): a lagging stored index never overwrites it', async ($, on) => {
  const good: Stats = { 49: { tokens: 1, ms: 1, refusals: 0 } }
  on('state.get', async (_$, e, next) => (e.plugin === 'agent-monitor' && e.key === 'prStats' ? { value: { value: good, version: 1 } } as never : next(e)))
  const { clock, pub } = await fresh($, on, await stored([A1], NOW - 10 * 60_000), onDisk)
  let answer = () => {}
  st.ghGate = new Promise<void>(r => { answer = r })
  await $.session.start({ cwd: ROOT } as never)
  await clock.advance(1000)
  expect(pub.values.some(v => v['49']?.tokens === 42_000)).toBe(false)
  expect(figures(pub.values[0]?.['49'])).toEqual(ALL)
  answer()
  await clock.settle()
})

test('session start does not wait for the stored index', async ($, on) => {
  let open = () => {}
  const gate = new Promise<void>(r => { open = r })
  const { clock } = await fresh($, on, await stored(), {}, key => (key.startsWith('txIndex:') ? gate : undefined))
  let started = false
  await Promise.race([$.session.start({ cwd: ROOT } as never).then(() => { started = true }), clock.advance(1000)])
  expect(started).toBe(true)
  open()
  await clock.settle()
})

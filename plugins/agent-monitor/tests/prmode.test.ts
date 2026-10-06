// The /sub PR mode through the whole mod: subagents grouped by the PR their first-line branch belongs to (a fake `gh pr list` and
// fake transcripts, testkit.ts), the Other group, expand / collapse, the `p: PR  a: Agent` switch, and a failed gh keeping the last index.
import { expect, mock, test } from 'claude-code/testing'

import { PROJECT, ROOT, ghPr, listKeys, mountPane, shown, st, wire } from './testkit'
import type { Dollar } from './testkit'
import { agentFiles, fakeFs } from './transcripts'

const NOW = Date.parse('2026-10-03T09:00:00Z')
// One assistant message a minute after the agent's start (`hh` its hour), priced as Opus 5.5 ($4 in, $20 out per million).
const step = (hh: string, input: number, output: number) => [{ id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: input, output_tokens: output }, at: `2026-10-01T${hh}:01:00.000Z` }]
// Two on the open spec PR #49 (a ticket branch it closes, and its own head branch), one on merged PR #38, one on dev.
const A1 = { sessionId: 's1', agentId: 'a1', type: 'worker', desc: 'build the index', branch: 'feature/43-pr-mode', at: '2026-10-01T10:00:00.000Z', steps: step('10', 40_000, 2_000) }
const A2 = { sessionId: 's1', agentId: 'a2', type: 'reviewer', desc: 'review the spec', branch: 'spec/36-pr-agent-views', at: '2026-10-01T09:00:00.000Z', steps: step('09', 10_000, 1_000) }
const A3 = { sessionId: 's2', agentId: 'a3', type: 'Explore', desc: 'map the card', branch: 'feature/38-pass-next', at: '2026-10-01T08:00:00.000Z', steps: step('08', 10, 5) }
const A4 = { sessionId: 's2', agentId: 'a4', type: 'Explore', desc: 'look around', branch: 'dev', at: '2026-10-01T07:00:00.000Z' }
const PRS = [ghPr(49, 'PR card and agents', 'spec/36-pr-agent-views', [43, 44]), ghPr(38, 'Pass next', 'feature/38-pass-next', [38], 'MERGED'), ghPr(50, 'Retro', 'adhoc/retro', [], 'MERGED'), ghPr(30, 'Closed one', 'feature/30-x', [30], 'CLOSED')]

type Run = [Dollar, Parameters<typeof wire>[0]]
async function openSub($: Run[0], on: Run[1], branch = 'feature/44-row-layout', stored: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on, stored)
  wire(on, fakeFs({ ...agentFiles(PROJECT, A1), ...agentFiles(PROJECT, A2), ...agentFiles(PROJECT, A3), ...agentFiles(PROJECT, A4) }))
  st.branch = branch
  st.gh = JSON.stringify(PRS)
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  return { clock, ui: await mountPane($) }
}

type Ui = Awaited<ReturnType<typeof mountPane>>
// A row is the outermost Text holding `needle` (its cells are Texts nested in it): the longest match.
const rowOf = async (ui: Ui, needle: string) => (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t.includes(needle)).sort((a, b) => b.length - a.length)[0] ?? ''

test('/sub opens in PR mode: the current branch\'s PR first and open, the others closed, Other last', async ($, on) => {
  const { ui } = await openSub($, on)
  expect(await listKeys(ui)).toEqual(['group:pr:49', 'row:a1', 'row:a2', 'group:pr:38', 'group:other'])
})

// The store is the plugin's, shared by every session in every repository: a fresh index another repository's session saved a
// minute ago must not stand in for this repository's PRs (acceptance of PR #49: all 25 subagents in Other, no PR state).
test('another repository\'s fresh PR index in the store does not stand in for this one\'s', async ($, on) => {
  const elsewhere = { at: NOW - 60_000, prs: [{ number: 471, title: 'Session title order', state: 'MERGED', head: 'feature/470-session-title-order', closes: [470] }] }
  const { ui } = await openSub($, on, 'feature/44-row-layout', { prIndex: elsewhere })
  expect(await listKeys(ui)).toEqual(['group:pr:49', 'row:a1', 'row:a2', 'group:pr:38', 'group:other'])
  expect(st.ghCalls).toBe(1)
})

test('a group row shows its agent count, tokens, cost, time and PR state', async ($, on) => {
  const { ui } = await openSub($, on)
  // #49: 42.0k + 11.0k tokens, $0.20 + $0.06, a minute each; open, not a draft. #38: one agent of 15 tokens; merged. Other: no PR state.
  expect(await rowOf(ui, '#49 PR card and agents')).toMatch(/2 agents\s+53\.0k tok\s+≈ \$0\.26\s+2m00s\s+Ready/)
  expect(await rowOf(ui, '#38 Pass next')).toMatch(/1 agent\s+15 tok\s+≈ <\$0\.01\s+1m00s\s+Merged/)
  const other = await rowOf(ui, 'Other')
  expect(other).toMatch(/1 agent\s+15 tok/)
  expect(other).not.toMatch(/Draft|Ready|Merged/)
})

// pr-hint's words and colors for the same PR (plugins/pr-hint: parse.ts prState, strings.ts PR_STATE, card.ts STATE_COLOR).
test('a group row\'s PR state reads Draft (yellow), Ready (magenta) or Merged (green), as pr-hint says it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  const D = { ...A1, agentId: 'd1', branch: 'feature/60-draft' }
  const R = { ...A1, agentId: 'r1', branch: 'feature/61-ready' }
  const M = { ...A1, agentId: 'm1', branch: 'feature/62-merged' }
  wire(on, fakeFs({ ...agentFiles(PROJECT, D), ...agentFiles(PROJECT, R), ...agentFiles(PROJECT, M) }))
  st.branch = 'dev'
  st.gh = JSON.stringify([ghPr(60, 'Drafted', 'feature/60-draft', [], 'OPEN', true), ghPr(61, 'Readied', 'feature/61-ready'), ghPr(62, 'Landed', 'feature/62-merged', [], 'MERGED')])
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  const texts = await ui.findAll({ type: 'Text' })
  for (const [title, word, color] of [['#60 Drafted', 'Draft', 'yellow'], ['#61 Readied', 'Ready', 'magenta'], ['#62 Landed', 'Merged', 'green']]) {
    expect(await rowOf(ui, title)).toMatch(new RegExp(`\\s${word}\\s*$`))
    expect(texts.find(t => t.text.trim() === word)?.props.color).toBe(color)
  }
})

test('the agent on dev lands in Other, whose row is drawn unlike a PR group\'s', async ($, on) => {
  const { ui } = await openSub($, on)
  await ui.press({ key: 'group:other' })
  expect((await listKeys(ui)).slice(-2)).toEqual(['group:other', 'row:a4'])
  // The group's title cell: the colored Text that starts with the title.
  const title = async (name: string) => (await ui.findAll({ type: 'Text' })).find(t => t.props.color !== undefined && t.text.trim().startsWith(name))?.props ?? {}
  const [pr, other] = [await title('#49'), await title('Other')]
  expect(pr.color).toBeDefined()
  expect(other.color).not.toBe(pr.color)
  expect(other.italic).toBe(true)
  expect(pr.bold).toBe(true)
})

test('Enter on a group shows its agents, Enter again hides them', async ($, on) => {
  const { ui } = await openSub($, on)
  await ui.press({ key: 'group:pr:38' })
  expect(await listKeys(ui)).toEqual(['group:pr:49', 'row:a1', 'row:a2', 'group:pr:38', 'row:a3', 'group:other'])
  await ui.press({ key: 'group:pr:49' })
  await ui.press({ key: 'group:pr:38' })
  expect(await listKeys(ui)).toEqual(['group:pr:49', 'group:pr:38', 'group:other'])
})

test('the header shows `p: PR  a: Agent`; a gives the flat list, p the groups again; the inactive one is dim', async ($, on) => {
  const { ui } = await openSub($, on)
  const seg = async (m: string) => (await ui.find({ type: 'Button', key: `mode:${m}` }))?.props ?? {}
  // A plain Button with a hotkey is drawn `<hotkey>: <label>`, the hotkey in the accent color (the footer's `b: back` style).
  for (const [m, hotkey, label] of [['pr', 'p', 'PR'], ['agent', 'a', 'Agent']] as const) {
    expect(await seg(m)).toMatchObject({ hotkey, plain: true, label })
  }
  expect((await seg('pr')).dimColor).toBeUndefined()
  expect((await seg('agent')).dimColor).toBe(true)
  await ui.press({ key: 'mode:agent' }) // what `a` presses
  expect(await listKeys(ui)).toEqual(['row:a1', 'row:a2', 'row:a3', 'row:a4'])
  expect((await seg('agent')).dimColor).toBeUndefined()
  expect((await seg('pr')).dimColor).toBe(true)
  await ui.press({ key: 'mode:pr' }) // what `p` presses
  expect(await listKeys(ui)).toEqual(['group:pr:49', 'row:a1', 'row:a2', 'group:pr:38', 'group:other'])
  expect((await seg('pr')).dimColor).toBeUndefined()
})

test('PR mode heads its groups with the Title column alone; Agent mode has the agent columns and no Title', async ($, on) => {
  const { ui } = await openSub($, on)
  // The agent table's header: `#  desc … type  tier  cost  time` (layout.ts headerCells).
  const agentColumns = async () => (await ui.findAll({ type: 'Text' })).filter(t => /#\s+desc\b.*\btype\s+tier\b/.test(t.text)).length
  expect(await rowOf(ui, 'Title')).toMatch(/^\s*Title\s/)
  expect(await agentColumns()).toBe(0)
  await ui.press({ key: 'mode:agent' })
  expect(await rowOf(ui, 'Title')).toBe('')
  expect(await agentColumns()).toBe(1)
})

test('the current PR with no agents yet and no other subagents still shows its group', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  wire(on, fakeFs())
  st.branch = 'feature/44-row-layout'
  st.gh = JSON.stringify(PRS)
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  expect(await listKeys(ui)).toEqual(['group:pr:49'])
  expect(await shown(ui)).not.toContain('No subagents yet')
})

test('the PR index is fetched again only when due, and a failed fetch keeps the last one', async ($, on) => {
  const { clock, ui } = await openSub($, on)
  const before = await listKeys(ui)
  await $.command.run({ command: 'sub', args: '' } as never)
  expect(st.ghCalls).toBe(1) // fresh: no second fetch
  await clock.advance(6 * 60 * 1000)
  st.gh = null
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(st.ghCalls).toBe(2)
  expect(await listKeys(ui)).toEqual(before)
  expect(await rowOf(ui, '#49 PR card and agents')).toContain('Ready')
})

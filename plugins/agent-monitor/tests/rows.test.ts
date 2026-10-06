// [POS] Row formats through the whole mod: the live band above the prompt and the /sub panel's running rows and finished table (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { PROJECT, ROOT, mountBand, mountPane, rowKeys, shown, st, step, wire } from './testkit'
import type { Dollar } from './testkit'
import { agentFiles, fakeFs } from './transcripts'
import { PALETTE } from '../hooks/palette'

const T0 = Date.parse('2026-10-03T09:00:00Z')
type On = Parameters<typeof mock.env>[0]

// One running subagent `a1` (description `desc`) after one step on `model`: 80k context + 6.2k output = 86.2k tokens, 40% of 200k.
async function running($: Dollar, on: On, desc = 'op.med · fix the parser', model = 'claude-opus-5-5') {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  wire(on)
  on('agent.spawn', async () => ({ agentId: 'a1', model }))
  await $.session.start({ cwd: ROOT } as never)
  await $.agent.spawn({ subagentType: 'worker', description: desc, prompt: 'go' } as never)
  st.agents = [{ id: 'a1', type: 'worker', status: 'running', description: desc }]
  await step($, 'a1', model, { input_tokens: 80_000, output_tokens: 6_200 }, 'medium')
  await clock.advance(65_000)
  return clock
}

// Where in drawn order the first Text whose whole text matches `re` sits (-1: none). A line is a Text holding its parts as nested Texts.
const lineFinder = async (ui: Awaited<ReturnType<typeof mountPane>>) => {
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  return (re: RegExp) => texts.findIndex(s => re.test(s))
}

test('/sub: a running subagent is three lines: tier-prefixed description; type · model · effort; context bar with ctx% · tokens · $ · m:ss', async ($, on) => {
  const clock = await running($, on)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  const at = await lineFinder(ui)
  const l1 = at(/^ ◐ op\.med · fix the parser$/)
  const l2 = at(/^ {5}worker · opus · med {3}starting$/)
  const l3 = at(/^ {5}█{4}░{6} 40% · 86\.2k · \$\d+\.\d\d · 1:05$/)
  expect(l1).toBeGreaterThanOrEqual(0)
  expect(l2).toBeGreaterThan(l1)
  expect(l3).toBeGreaterThan(l2)
  // The row is still one select Button (↑↓ and Enter detail).
  expect(await rowKeys(ui)).toEqual(['row:a1'])
})

// The prefix asks for op.med, the steps ran on sonnet: line 2 says what was asked (a match says nothing: the test above).
const mismatchLine = async ($: Dollar, on: On) => {
  const clock = await running($, on, 'op.med · fix the parser', 'claude-sonnet-5-5')
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  return lineFinder(await mountPane($))
}

test('/sub: tier mismatch, Chinese: line 2 ends `≠ 要求 op.med`', { options: { language: 'zh' } }, async ($, on) => {
  const at = await mismatchLine($, on)
  expect(at(/^ {5}worker · sonnet · med ≠ 要求 op\.med {3}启动中$/)).toBeGreaterThanOrEqual(0)
})

test('/sub: tier mismatch, English: line 2 ends `≠ wanted op.med`', async ($, on) => {
  const at = await mismatchLine($, on)
  expect(at(/^ {5}worker · sonnet · med ≠ wanted op\.med {3}starting$/)).toBeGreaterThanOrEqual(0)
  // a mismatch is an alert: line 1 ends with the red `!`
  expect(at(/^ ◐ op\.med · fix the parser {2}!$/)).toBeGreaterThanOrEqual(0)
})

// Three finished subagents of earlier sessions, read from their transcripts: types, tiers and figures of different widths.
const FINISHED = [
  { sessionId: 'old', agentId: 'f1', type: 'Explore', desc: 'map the parser', model: 'claude-sonnet-5-5', at: '2026-10-01T09:00:00.000Z', steps: [{ id: 'm1', at: '2026-10-01T09:01:05.000Z', usage: { input_tokens: 82_000, output_tokens: 4_200 } }] },
  { sessionId: 'old', agentId: 'f2', type: 'reviewer', desc: 'review the diff', model: 'claude-opus-5-5', at: '2026-10-01T08:00:00.000Z', steps: [{ id: 'm1', at: '2026-10-01T08:12:30.000Z', usage: { input_tokens: 150_000, output_tokens: 12_000 } }] },
  { sessionId: 'old', agentId: 'f3', type: 'qa', desc: 'run the suite', model: 'claude-haiku-4-5', at: '2026-10-01T07:00:00.000Z', steps: [{ id: 'm1', at: '2026-10-01T07:00:09.000Z', usage: { input_tokens: 900, output_tokens: 40 } }] },
]

async function finishedPane($: Dollar, on: On) {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  wire(on, fakeFs(Object.assign({}, ...FINISHED.map(a => agentFiles(PROJECT, a)))))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  return mountPane($)
}

test('/sub: finished subagents form one table `# desc type tier cost time`, every column aligned', async ($, on) => {
  const ui = await finishedPane($, on)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const header = texts.find(s => /^\s+#\s+desc\s+type\s+tier\s+cost\s+time\s*$/.test(s))
  expect(header).toBeDefined()
  // A row is the Text after its select Button: lead blank + Button = 2 cells left of where the header's own text starts.
  const rows = ['map the parser', 'review the diff', 'run the suite'].map(task => `  ${texts.find(s => s.startsWith('  ●') && s.includes(task))}`)
  const money = String.raw`(?:<\$0\.01|\$\d+\.\d\d)`
  expect(rows[0]).toMatch(new RegExp(String.raw`●\s+map the parser\s+Explore\s+sonnet\s+41% · 86\.2k · ${money}\s+1:05$`))
  expect(rows[1]).toMatch(new RegExp(String.raw`●\s+review the diff\s+reviewer\s+opus\s+75% · 162\.0k · ${money}\s+12:30$`))
  expect(rows[2]).toMatch(new RegExp(String.raw`●\s+run the suite\s+qa\s+haiku\s+0% · 940 · ${money}\s+0:09$`))
  // Aligned: type, tier and cost start where their headers do, every row ends at the same cell.
  for (const word of ['type', 'tier', 'cost']) {
    const col = header!.indexOf(` ${word}`) + 1
    expect(rows.map(r => r[col - 1] === ' ' && r[col] !== ' ')).toEqual([true, true, true])
  }
  expect(new Set(rows.map(r => r.length)).size).toBe(1)
})

test('/sub: only a row with an alert ends in a red `!`', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const refused = { ...FINISHED[0]!, denials: ['PreToolUse:Bash hook error: no'] }
  wire(on, fakeFs({ ...agentFiles(PROJECT, refused), ...agentFiles(PROJECT, FINISHED[1]!) }))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  const row = (task: string) => texts.find(s => s.startsWith('  ●') && s.includes(task)) ?? ''
  expect(row('map the parser')).toMatch(/\d:\d\d {2}!$/) // the refusal line is the transcript's last, so it sets the time
  expect(row('review the diff')).toMatch(/12:30 *$/)
  const marks = await ui.findAll({ type: 'Text', text: /^!$/ })
  expect(marks.map(m => m.props.color)).toEqual([PALETTE.red])
})

test('/sub Agent mode: the running agent\'s three lines first, then the finished table', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  wire(on, fakeFs(agentFiles(PROJECT, FINISHED[0]!)))
  on('agent.spawn', async () => ({ agentId: 'a1', model: 'claude-opus-5-5' }))
  await $.session.start({ cwd: ROOT } as never)
  await $.agent.spawn({ subagentType: 'worker', description: 'op.med · fix the parser', prompt: 'go' } as never)
  st.agents = [{ id: 'a1', type: 'worker', status: 'running', description: 'op.med · fix the parser' }]
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  await ui.press({ key: 'mode:agent' })
  const at = await lineFinder(ui)
  const run = at(/^ ◐ op\.med · fix the parser$/)
  const head = at(/^\s+#\s+desc\s+type\s+tier\s+cost\s+time\s*$/)
  const fin = at(/^ {2}●\s+map the parser/)
  expect(run).toBeGreaterThanOrEqual(0)
  expect(head).toBeGreaterThan(run)
  expect(fin).toBeGreaterThan(head)
  expect(await rowKeys(ui)).toEqual(['row:a1', 'row:f1'])
})

test('live band: ctx%, tokens without the `tok` word, time as m:ss', async ($, on) => {
  await running($, on)
  const text = await shown(await mountBand($))
  expect(text).toContain('fix the parser')
  expect(text).toContain('40% · 86.2k · $')
  expect(text).toContain('· 1:05')
  expect(text).not.toContain('tok')
})

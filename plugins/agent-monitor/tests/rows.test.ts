// Row formats through the whole mod: the live band above the prompt and the /sub panel's running rows and finished table (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { ROOT, mountBand, mountPane, rowKeys, shown, st, step, wire } from './testkit'
import type { Dollar } from './testkit'

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

test('live band: ctx%, tokens without the `tok` word, time as m:ss', async ($, on) => {
  await running($, on)
  const text = await shown(await mountBand($))
  expect(text).toContain('fix the parser')
  expect(text).toContain('40% · 86.2k · $')
  expect(text).toContain('· 1:05')
  expect(text).not.toContain('tok')
})

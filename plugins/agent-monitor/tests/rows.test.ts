// Row formats through the whole mod: the live band above the prompt and the /sub panel's running rows and finished table (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { ROOT, mountBand, shown, st, step, wire } from './testkit'
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

test('live band: ctx%, tokens without the `tok` word, time as m:ss', async ($, on) => {
  await running($, on)
  const text = await shown(await mountBand($))
  expect(text).toContain('fix the parser')
  expect(text).toContain('40% · 86.2k · $')
  expect(text).toContain('· 1:05')
  expect(text).not.toContain('tok')
})

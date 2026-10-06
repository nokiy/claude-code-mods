// [POS] The alert timeline and the detail page through the whole mod: real spawn / step / tool calls and transcripts in, the /sub
// pane's Alerts block, Enter on a row, `b` back (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { PROJECT, ROOT, mountPane, rowKeys, st, step, wire } from './testkit'
import type { Dollar } from './testkit'
import { agentFiles, fakeFs } from './transcripts'
import { formatClock } from '../hooks/logic'

const T0 = Date.parse('2026-10-03T09:00:00Z')
const RULE = 'rm -rf is blocked by policy'
type On = Parameters<typeof mock.env>[0]

// Subagent `a1` asked for op.med but stepping on sonnet; it edits src/parse.ts at +10 s, then a hook refuses the same Bash call twice
// (+20 s, +30 s). Subagent `a2` runs clean.
async function session($: Dollar, on: On) {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  wire(on)
  on('agent.spawn', async (_$, e) => ({ agentId: (e as { description: string }).description.includes('parser') ? 'a1' : 'a2', model: 'claude-sonnet-5-5' }))
  on('tool.call', async (_$, e) => (e.tool === 'Bash' ? { deny: RULE } : { result: {} as never, text: 'ok' }) as never)
  await $.session.start({ cwd: ROOT } as never)
  await $.agent.spawn({ subagentType: 'worker', description: 'op.med · fix the parser', prompt: 'Fix the parser bug in src/parse.ts' } as never)
  await $.agent.spawn({ subagentType: 'Explore', description: 'map the tests', prompt: 'List the test files' } as never)
  st.agents = [{ id: 'a1', type: 'worker', status: 'running', description: 'op.med · fix the parser' }, { id: 'a2', type: 'Explore', status: 'running', description: 'map the tests' }]
  await step($, 'a1', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, 'medium')
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/parse.ts`, old_string: 'a', new_string: 'b', agentId: 'a1' } as never)
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build', agentId: 'a1' } as never)
  await clock.advance(10_000)
  await $.tool.call({ tool: 'Bash', command: 'rm -rf build', agentId: 'a1' } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  return mountPane($)
}

const texts = async (ui: Awaited<ReturnType<typeof mountPane>>) => (await ui.findAll({ type: 'Text' })).map(t => t.text)

test('Alerts block: a timeline, oldest first, with the wanted and actual tier, the refusal text and ×2', async ($, on) => {
  const all = await texts(await session($, on))
  const tier = all.findIndex(s => s === ` ${formatClock(T0)} ≠ tier  worker"fix the…" described op.med · ran sonnet.med`)
  const denied = all.findIndex(s => s === ` ${formatClock(T0 + 20_000)} × denied  worker"fix the…" refused ×2: ${RULE}`)
  expect(tier).toBeGreaterThanOrEqual(0)
  expect(denied).toBeGreaterThan(tier)
})

test('detail page: Enter on a row shows instruction, steps, edited files, alert causes in that order; `b` goes back', async ($, on) => {
  const ui = await session($, on)
  await ui.press({ key: 'row:a1' })
  const all = await texts(ui)
  const at = (s: string) => all.indexOf(s)
  expect(at(' Instruction')).toBeGreaterThan(0)
  expect(at('   Fix the parser bug in src/parse.ts')).toBeGreaterThan(at(' Instruction'))
  expect(at(' Steps')).toBeGreaterThan(at('   Fix the parser bug in src/parse.ts'))
  expect(all.findIndex(s => s.startsWith('   → Edit') && s.includes('parse.ts'))).toBeGreaterThan(at(' Steps'))
  expect(all.findIndex(s => s.startsWith(' Edited files'))).toBeGreaterThan(at(' Steps'))
  expect(all.findIndex(s => s.includes('✎ src/parse.ts'))).toBeGreaterThan(all.findIndex(s => s.startsWith(' Edited files')))
  expect(at(' Alerts')).toBeGreaterThan(all.findIndex(s => s.includes('✎ src/parse.ts')))
  expect(at(`   ${formatClock(T0)} ≠ tier  worker"fix the…" described op.med · ran sonnet.med`)).toBeGreaterThan(at(' Alerts'))
  expect(at(`   ${formatClock(T0 + 20_000)} × denied  worker"fix the…" refused ×2: ${RULE}`)).toBeGreaterThan(at(' Alerts'))
  await ui.press({ key: 'hk:b' })
  expect(await rowKeys(ui)).toEqual(['row:a1', 'row:a2']) // back on the list (same start: ordered by id)
  expect(await texts(ui)).not.toContain(' Instruction')
})

test('detail page: a clean subagent has no Alerts section and no alert line', async ($, on) => {
  const ui = await session($, on)
  await ui.press({ key: 'row:a2' })
  const all = await texts(ui)
  expect(all).toContain(' Instruction')
  expect(all).not.toContain(' Alerts')
  expect(all.some(s => /≠ tier|× denied|! conflict|~ stalled/.test(s))).toBe(false)
})

test('Alerts block: a transcript agent refused twice by a hook reads ×2 with the refusal text and its time', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const refused = { sessionId: 'old', agentId: 'f1', type: 'Explore', desc: 'map the parser', denials: [`PreToolUse:Bash hook error: ${RULE}`, `PreToolUse:Bash hook error: ${RULE}`] }
  wire(on, fakeFs(agentFiles(PROJECT, refused)))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const all = await texts(await mountPane($))
  expect(all).toContain(` ${formatClock(Date.parse('2026-10-01T10:02:00.000Z'))} × denied  Explore"map the…" refused ×2: PreToolUse:Bash hook error: ${RULE}`)
})

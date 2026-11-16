// [POS] The alert timeline and the detail page through the whole mod: real steps (with the tool calls they ask for) and transcripts
// in, the /sub pane's Alerts block, Enter on a row, `b` back (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { PROJECT, ROOT, countStore, listed, mountPane, rowKeys, st, step, wire } from './testkit'
import type { Dollar } from './testkit'
import { agentFiles, agentPaths, fakeFs } from './transcripts'
import { indexKey, refreshProject, toIndex } from '../hooks/history'
import type { TxEntry } from '../hooks/history'
import { formatClock } from '../hooks/logic'

const T0 = Date.parse('2026-10-03T09:00:00Z')
const RULE = 'rm -rf is blocked by policy'
type On = Parameters<typeof mock.env>[0]

const at = (ms: number) => new Date(T0 + ms).toISOString()
// Subagent `a1` asked for op.med but steps on sonnet; at +10 s a step asks to edit src/parse.ts, then a hook refuses the same Bash
// call twice (the transcript's refusal lines, written at +20 s). Subagent `a2` runs clean. Both live in this session (`cur`); their
// transcripts give the prompts and the refusals, the steps everything else.
const A1 = { sessionId: 'cur', agentId: 'a1', type: 'worker', desc: 'op.med · fix the parser', prompt: 'Fix the parser bug in src/parse.ts', at: at(0), denials: [RULE, RULE], deniedAt: at(20_000) }
const A2 = { sessionId: 'cur', agentId: 'a2', type: 'Explore', desc: 'map the tests', prompt: 'List the test files', at: at(0) }
async function session($: Dollar, on: On) {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  wire(on, fakeFs({ ...agentFiles(PROJECT, A1), ...agentFiles(PROJECT, A2) }))
  await $.session.start({ cwd: ROOT } as never)
  st.agents = [listed('a1', 'worker', A1.desc), listed('a2', 'Explore', A2.desc)]
  await step($, 'a1', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, 'medium')
  await step($, 'a2', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, 'medium')
  await clock.advance(10_000)
  await step($, 'a1', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, 'medium', [{ name: 'Edit', input: { file_path: `${ROOT}/src/parse.ts`, old_string: 'a', new_string: 'b' } }], 1)
  await clock.advance(10_000)
  await step($, 'a1', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, 'medium', [{ name: 'Bash', input: { command: 'rm -rf build' } }], 2)
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

// Acceptance of PR #49: errored tool results (`Exit code 1`) read `denied` beside hook refusals, every line `--:--:--`. The running
// agent's transcript tells the two apart (`toolDenialKind` on a refusal), each line at its own time.
test('a hook refusal reads denied, an errored tool result reads error; each at its own time, in time order', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const a1 = {
    sessionId: 'cur', agentId: 'a1', type: 'worker', desc: 'build it', at: at(0),
    errors: ['Exit code 1\nmake: *** [all] Error 2'], erroredAt: at(10_000), denials: [RULE], deniedAt: at(20_000),
  }
  wire(on, fakeFs(agentFiles(PROJECT, a1)))
  await $.session.start({ cwd: ROOT } as never)
  st.agents = [listed('a1', 'worker', 'build it')]
  await step($, 'a1', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, undefined, [{ name: 'Bash', input: { command: 'make' } }])
  await clock.advance(20_000)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const all = await texts(await mountPane($))
  const failed = all.indexOf(` ${formatClock(T0 + 10_000)} ✗ error  worker"build it" errored ×1: Exit code 1`)
  const denied = all.indexOf(` ${formatClock(T0 + 20_000)} × denied  worker"build it" refused ×1: ${RULE}`)
  expect(failed).toBeGreaterThanOrEqual(0)
  expect(denied).toBeGreaterThan(failed)
  expect(all.filter(s => s.includes('Exit code 1')).every(s => !s.includes('denied'))).toBe(true)
})

// The transcript is the timestamped record of both kinds: an errored tool_result line (no `toolDenialKind`) and a hook refusal line,
// each drawn at its line's `timestamp`. (A record kept in `$.state` from an older build gives way to it: tests/unit/history.test.ts.)
test('a transcript\'s errored result reads error at its line time, its hook refusal denied at its own', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const hook = `PreToolUse:Bash hook error: ${RULE}`
  wire(on, fakeFs(agentFiles(PROJECT, { sessionId: 'old', agentId: 'o1', type: 'worker', desc: 'old one', denials: [hook], errors: ['Exit code 1\nboom'] })))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const all = await texts(await mountPane($))
  const errored = all.indexOf(` ${formatClock(Date.parse('2026-10-01T10:01:30.000Z'))} ✗ error  worker"old one" errored ×1: Exit code 1`)
  const denied = all.indexOf(` ${formatClock(Date.parse('2026-10-01T10:02:00.000Z'))} × denied  worker"old one" refused ×1: ${hook}`)
  expect(errored).toBeGreaterThanOrEqual(0)
  expect(denied).toBeGreaterThan(errored)
})

test('a main-loop step that edits a file a running subagent edited is a conflict, named by both', async ($, on) => {
  const ui = await session($, on)
  await step($, undefined, 'claude-opus-5-5', { input_tokens: 10, output_tokens: 5 }, undefined, [{ name: 'Edit', input: { file_path: 'src/parse.ts', old_string: 'b', new_string: 'c' } }])
  const all = await texts(ui)
  expect(all.some(s => s.includes('! conflict') && s.includes('worker"fix the…" and main edited src/parse.ts'))).toBe(true)
})

// Code Mode: the agent's steps only show REPL scripts; the edits made inside them come from its transcript's tool results.
test('detail page: a Code Mode agent\'s edited files and +/− counts come from its transcript', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  mock.store(on)
  const lex = `${ROOT}/src/lex.ts`
  const c1 = { sessionId: 'cur', agentId: 'c1', type: 'worker', desc: 'tidy the lexer', at: at(0), edits: [{ path: lex, lines: [' a', '-b', '+c', '+d'] }, { path: lex, lines: ['+e'] }] }
  wire(on, fakeFs(agentFiles(PROJECT, c1)))
  await $.session.start({ cwd: ROOT } as never)
  st.agents = [listed('c1', 'worker', c1.desc)]
  const script = { name: 'REPL', input: { code: "await edit('src/lex.ts', 'b', 'c')", description: 'Fix the lexer' } }
  await step($, 'c1', 'claude-sonnet-5-5', { input_tokens: 1000, output_tokens: 100 }, undefined, [script])
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  await ui.press({ key: 'row:c1' })
  const all = await texts(ui)
  expect(all.some(s => s.startsWith('   → Script Fix the lexer'))).toBe(true)
  expect(all.some(s => s.includes('✎ src/lex.ts') && s.includes('+3') && s.includes('−1'))).toBe(true)
})

// Finished subagents of an earlier session, all described op.high, seen in a fresh session through the project index an older build
// stored (entries without effort, no version): the files are read again, and each row and alert says what ran, never the prefix's effort.
test('history: op.high that ran sonnet at low effort reads sonnet.low with `!` and its ≠ line; no effort known reads the bare model', async ($, on) => {
  const clock = mock.clock(on, { now: T0 })
  const low = { sessionId: 'old', agentId: 'o1', type: 'worker', desc: 'op.high · build the dashboard', model: 'claude-sonnet-5-5', steps: [{ id: 'm1', effort: 'low' }] }
  const bare = { sessionId: 'old', agentId: 'o2', type: 'worker', desc: 'op.high · sketch the page', model: 'claude-sonnet-5-5' }
  const same = { sessionId: 'old', agentId: 'o3', type: 'worker', desc: 'op.high · check the build', model: 'claude-opus-5-5' }
  const fs = fakeFs({ ...agentFiles(PROJECT, low), ...agentFiles(PROJECT, bare), ...agentFiles(PROJECT, same) })
  const cache = new Map<string, TxEntry>()
  await refreshProject({ list: async d => fs.list(d), read: async p => fs.read(p), tail: async (p, from) => fs.tail(p, from) }, PROJECT, cache)
  const old = JSON.parse(JSON.stringify(toIndex(cache, PROJECT, 1))) as { v?: number; files: Record<string, TxEntry> }
  delete old.v
  for (const e of Object.values(old.files)) delete e.roll.effort
  countStore(on, { [indexKey(PROJECT)]: old })
  wire(on, fs)
  fs.reset()
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(fs.tally.reads.get(agentPaths(PROJECT, low).jsonl)).toBe(1)
  const ui = await mountPane($)
  await ui.press({ key: 'mode:agent' })
  const all = await texts(ui)
  const row = (task: string) => all.find(s => s.startsWith('  ●') && s.includes(task)) ?? ''
  expect(row('build the')).toMatch(/worker\s+sonnet\.low\s.*!$/)
  expect(row('sketch the')).toMatch(/worker\s+sonnet\s.*!$/)
  expect(row('check the')).toMatch(/worker\s+opus\s/)
  expect(row('check the')).not.toMatch(/!$/)
  const tier = all.filter(s => /^ \d\d:\d\d:\d\d ≠ tier /.test(s)) // whole timeline lines, not their parts
  expect(tier.some(s => s.includes('described op.high · ran sonnet.low'))).toBe(true)
  expect(tier.some(s => s.endsWith('described op.high · ran sonnet'))).toBe(true)
  expect(tier).toHaveLength(2)
})

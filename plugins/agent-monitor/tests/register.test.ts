// The whole mod through its hooks: subagent history read from the project's transcripts, on synthetic files (testkit.ts).
import { expect, mock, test } from 'claude-code/testing'

import { MAX_PR_INDEXES } from '../hooks/prindex'
import { OTHER, PROJECT, ROOT, countStore, ghPr, listKeys, listed, mountPane, rowKeys, shown, st, step, wire } from './testkit'
import type { Dollar } from './testkit'
import { MAX_READ, agentFiles, agentMeta, agentPaths, assistantLine, bigTranscript, fakeFs, jsonl } from './transcripts'

const OLD1 = { sessionId: 'old1', agentId: 'a1', type: 'Explore', desc: 'map the parser', model: 'claude-sonnet-4-5', at: '2026-10-01T09:00:00.000Z' }
const OLD2 = { sessionId: 'old2', agentId: 'a2', type: 'reviewer', desc: 'review the diff', model: 'claude-opus-4-5', at: '2026-10-02T09:00:00.000Z' }

test('/clear: /sub still lists the subagents of earlier sessions, with type, description and model', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const live = { sessionId: 'cur', agentId: 'a3', type: 'worker', desc: 'fix the lexer', at: '2026-10-03T08:59:00.000Z' }
  wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(PROJECT, OLD2), ...agentFiles(PROJECT, live) }))
  await $.session.start({ cwd: ROOT } as never)
  // An agent of this session, seen by the hooks, then cleared from the live records with the session.
  st.agents = [listed('a3', 'worker', 'fix the lexer')]
  await step($, 'a3', 'claude-opus-4-5', { input_tokens: 10, output_tokens: 5 })
  await $.session.end({ reason: 'clear', sessionId: 'cur' } as never)
  st.session = 'next'
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const ui = await mountPane($)
  expect(await rowKeys(ui)).toEqual(['row:a3', 'row:a2', 'row:a1'])
  // Each row carries its own type and model (the model from the transcript's assistant lines; meta has none).
  // A row is the outermost Text holding the task (the task cell is a Text nested in it): the longest match.
  const row = async (task: string) => (await ui.findAll({ type: 'Text' })).map(t => t.text).filter(t => t.includes(task)).sort((a, b) => b.length - a.length)[0] ?? ''
  expect(await row('map the parser')).toMatch(/Explore\s+sonnet/)
  expect(await row('review the diff')).toMatch(/reviewer\s+opus/)
  expect(await row('fix the lexer')).toMatch(/worker\s+opus/)
})

test('an agent in both the hook events and its transcript is one row', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const live = { sessionId: 'cur', agentId: 'a9', type: 'worker', desc: 'fix the parser', model: 'claude-opus-4-5' }
  const fs = wire(on, fakeFs(agentFiles(PROJECT, live)))
  await $.session.start({ cwd: ROOT } as never)
  st.agents = [listed('a9', 'worker', 'fix the parser')]
  await step($, 'a9', 'claude-opus-4-5', { input_tokens: 10, output_tokens: 5 })
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(fs.tally.reads.get(agentPaths(PROJECT, live).jsonl)).toBe(1)
  expect(await rowKeys(await mountPane($))).toEqual(['row:a9'])
})

test('only the current project\'s transcript directory is read', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const fs = wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(OTHER, { ...OLD2, desc: 'elsewhere work' }) }))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const text = await shown(await mountPane($))
  expect(text).toContain('map the parser')
  expect(text).not.toContain('elsewhere work')
  expect(fs.tally.lists.some(d => d.startsWith(OTHER))).toBe(false)
})

test('the 1 s tick reads only this session\'s folder, and no unchanged file again', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const live = { sessionId: 'cur', agentId: 'a9', type: 'worker', desc: 'fix the parser' }
  const fs = wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(PROJECT, live) }))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  st.agents = [listed('a9', 'worker', 'fix the parser')]
  await step($, 'a9', 'claude-opus-4-5', { input_tokens: 10, output_tokens: 5 })
  fs.reset()
  await clock.advance(1000)
  expect(fs.tally.lists).toEqual([`${PROJECT}/cur/subagents`])
  expect(fs.tally.reads.size).toBe(0)
  // The live agent's transcript grows: the next tick reads that file once, only the bytes added.
  const path = agentPaths(PROJECT, live).jsonl
  const from = fs.files.get(path)!.bytes.length
  const added = jsonl([assistantLine(live, { id: 'm2', usage: { input_tokens: 5, output_tokens: 1 } })])
  fs.append(path, added)
  await clock.advance(1000)
  expect([...fs.tally.reads.keys()]).toEqual([path])
  expect(fs.tally.ranges).toEqual([{ path, offset: from, length: added.length }])
})

// Transcripts are read by byte ranges of at most 4 MiB (`$.fs.read` with offset and length), never through a process.
const many = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `m${from + i}`, model: 'claude-opus-5-5', usage: { input_tokens: 1_000, output_tokens: 100 }, at: '2026-10-01T10:01:00.000Z' }))
const BIG_AGENT = { sessionId: 'old1', agentId: 'b1', type: 'worker', desc: 'long haul', at: '2026-10-01T10:00:00.000Z' }
const bigRow = async ($: Dollar) => (await (await mountPane($)).findAll({ type: 'Text' })).map(t => t.text).filter(t => t.includes('long haul')).sort((a, b) => b.length - a.length)[0] ?? ''

test('a transcript past 4 MiB is read by ranges of at most 4 MiB, no process; a cut character and an over-long line lose nothing', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const p = agentPaths(PROJECT, BIG_AGENT)
  const fs = wire(on, fakeFs({ [p.meta]: agentMeta(BIG_AGENT) }))
  fs.write(p.jsonl, bigTranscript(BIG_AGENT, many(10), many(10, 10)))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  const mine = fs.tally.ranges.filter(r => r.path === p.jsonl)
  expect(mine.length).toBeGreaterThan(1)
  expect(mine.every(r => r.length <= MAX_READ)).toBe(true)
  expect(fs.tally.reads.get(p.jsonl)).toBe(mine.length) // no whole read
  expect(st.procs.some(a => a[0] === 'tail')).toBe(false)
  // 20 steps of 1,000 in + 100 out, before and after the long lines: 22,000 tokens.
  expect(await bigRow($)).toContain('22.0k')
  // Unchanged: the next refresh reads nothing, the long line included.
  await $.command.run({ command: 'sub', args: '' } as never) // closes the panel
  fs.reset()
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(fs.tally.ranges).toEqual([])
})

// The 1 s tick does not wait for the one before it: a scan slower than a tick must not be joined by another that reads the same bytes.
test('ticks while a read is slower than a tick: one scan at a time, the same bytes read once', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  const live = { sessionId: 'cur', agentId: 'a9', type: 'worker', desc: 'fix the parser' }
  const fs = wire(on, fakeFs({ ...agentFiles(PROJECT, OLD1), ...agentFiles(PROJECT, live) }))
  await $.session.start({ cwd: ROOT } as never)
  await clock.settle()
  st.agents = [listed('a9', 'worker', 'fix the parser')]
  await step($, 'a9', 'claude-opus-4-5', { input_tokens: 10, output_tokens: 5 })
  const path = agentPaths(PROJECT, live).jsonl
  const from = fs.files.get(path)!.bytes.length
  fs.append(path, jsonl([assistantLine(live, { id: 'm2', usage: { input_tokens: 5, output_tokens: 1 } })]))
  let open = () => {}
  fs.gate = new Promise<void>(r => { open = r })
  fs.reset()
  for (let i = 0; i < 4; i++) await clock.advance(1000)
  void $.command.run({ command: 'sub', args: '' } as never) // a full scan asked meanwhile waits its turn
  await clock.settle()
  fs.gate = null
  open()
  await clock.settle()
  expect(fs.tally.ranges.filter(r => r.path === path && r.offset === from)).toHaveLength(1)
  expect(fs.tally.peak).toBe(1)
})

// The store is one JSON file shared by every repository and session (4 MiB cap): /sub must not touch it when nothing changed.
const FILES = [OLD1, OLD2, { sessionId: 'old3', agentId: 'a4', type: 'worker', desc: 'third', at: '2026-10-02T10:00:00.000Z' }]
const txKeys = (keys: readonly string[]) => keys.filter(k => k.startsWith('transcript') || k.startsWith('txIndex:'))
const projectFiles = (agents: readonly (typeof OLD1 | { sessionId: string; agentId: string })[]) => Object.assign({}, ...agents.map(a => agentFiles(PROJECT, a))) as Record<string, string>

test('a second /sub on unchanged transcripts reads no file and writes nothing to the store', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  const store = countStore(on)
  const fs = wire(on, fakeFs(projectFiles(FILES)))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  await $.command.run({ command: 'sub', args: '' } as never) // closes the panel
  await clock.settle()
  fs.reset()
  store.reset()
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(fs.tally.reads.size).toBe(0)
  expect(store.tally.sets).toEqual([])
})

test('a refresh of several changed transcripts writes the store once; the 1 s tick never writes it', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  const store = countStore(on)
  const live = { sessionId: 'cur', agentId: 'a9', type: 'worker', desc: 'fix the parser' }
  const fs = wire(on, fakeFs(projectFiles([...FILES, live])))
  await $.session.start({ cwd: ROOT } as never)
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(txKeys(store.tally.sets)).toHaveLength(1)
  // Every file grows: the next /sub reads each once and writes the store once.
  for (const a of [...FILES, live]) fs.append(agentPaths(PROJECT, a).jsonl, jsonl([assistantLine(a, { id: 'm9', usage: { input_tokens: 5, output_tokens: 1 } })]))
  store.reset()
  await $.command.run({ command: 'sub', args: '' } as never)
  await clock.settle()
  expect(txKeys(store.tally.sets)).toHaveLength(1)
  // A running agent's transcript grows under the 1 s tick: read, never stored.
  st.agents = [listed('a9', 'worker', 'fix the parser')]
  await step($, 'a9', 'claude-opus-4-5', { input_tokens: 10, output_tokens: 5 })
  store.reset()
  fs.reset()
  fs.append(agentPaths(PROJECT, live).jsonl, jsonl([assistantLine(live, { id: 'm10', usage: { input_tokens: 5, output_tokens: 1 } })]))
  await clock.advance(1000)
  expect([...fs.tally.reads.keys()]).toEqual([agentPaths(PROJECT, live).jsonl])
  expect(txKeys(store.tally.sets)).toEqual([])
})

test('/sub opens at once while gh is slow; the PR groups come in when it answers', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  mock.store(on)
  wire(on, fakeFs(projectFiles([...FILES, { sessionId: 'old4', agentId: 'a5', type: 'worker', desc: 'fix #7 the lexer' }])))
  let answer = () => {}
  st.ghGate = new Promise<void>(r => { answer = r })
  st.gh = JSON.stringify([ghPr(7, 'Lexer', 'feature/7-lexer')])
  await $.session.start({ cwd: ROOT } as never)
  let opened = false
  void $.command.run({ command: 'sub', args: '' } as never).then(() => { opened = true })
  await clock.settle()
  expect(opened).toBe(true) // gh has not answered yet
  const ui = await mountPane($)
  const before = await listKeys(ui)
  expect(before).toContain('group:other')
  expect(before).not.toContain('group:pr:7')
  answer()
  await clock.settle()
  expect(st.ghCalls).toBe(1)
  expect(await listKeys(ui)).toContain('group:pr:7') // redrawn when the index lands
})

test('session.start deletes the old per-file transcript keys once and keeps every other key', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-03T09:00:00Z') })
  const store = countStore(on, {
    [`transcript:${PROJECT}/old1/subagents/agent-a1.jsonl`]: { size: 1, mtimeMs: 1, offset: 1, roll: {} },
    [`transcript.v2:${OTHER}/s/subagents/agent-b1.jsonl`]: { size: 1, mtimeMs: 1, offset: 1, roll: {} },
    'prIndex:/work/repo': { at: 1, prs: [] },
    'warned:a1:stall': true,
    lastPlacement: 'right',
  })
  wire(on, fakeFs())
  await $.session.start({ cwd: ROOT } as never)
  await clock.settle()
  expect([...store.entries.keys()].sort()).toEqual(['lastPlacement', 'prIndex:/work/repo', 'warned:a1:stall'])
  store.reset()
  await $.session.start({ cwd: ROOT } as never)
  await clock.settle()
  expect(store.tally.deletes).toEqual([])
})

test('past MAX_PR_INDEXES directories only the newest PR indexes stay, this directory\'s always', async ($, on) => {
  const now = Date.parse('2026-10-03T09:00:00Z')
  const clock = mock.clock(on, { now })
  const others = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`prIndex:/dir${i}`, { at: now - (i + 1) * 60_000, prs: [] }]))
  const store = countStore(on, { ...others, 'prIndex:/work/repo': { at: 1, prs: [] }, lastPlacement: 'right' })
  wire(on, fakeFs())
  await $.session.start({ cwd: ROOT } as never)
  await clock.settle()
  const kept = [...store.entries.keys()].filter(k => k.startsWith('prIndex:')).sort()
  expect(kept).toEqual(['prIndex:/work/repo', ...Array.from({ length: MAX_PR_INDEXES - 1 }, (_, i) => `prIndex:/dir${i}`)].sort())
  expect(store.entries.get('prIndex:/work/repo')).toMatchObject({ at: now }) // fetched afresh, kept though it was the oldest
  expect(store.entries.has('lastPlacement')).toBe(true)
})

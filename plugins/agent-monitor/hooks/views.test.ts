import { test, expect } from 'claude-code/testing'

import { view } from './fixture'
import { rowText } from './layout'
import { buildViews, effectiveStatus, orderViews, reconcile, seedRec, settled, withoutGhosts } from './views'
import type { View } from './views'

const v = (id: string, status: View['status'], startedAt?: number, finishedAt?: number): View => view({ id, type: 't', task: id, status, startedAt, finishedAt })

test('orderViews: newest start first for every status; no start after, then by id', () => {
  const rows = [v('old', 'done', 1, 10), v('run2', 'running', 5), v('new', 'failed', 2, 30), v('run1', 'running', 3), v('lostB', 'done'), v('lostA', 'running'), v('tieB', 'done', 4), v('tieA', 'failed', 4)]
  expect(orderViews(rows).map(r => r.id)).toEqual(['run2', 'tieA', 'tieB', 'run1', 'new', 'old', 'lostA', 'lostB'])
})

test('effectiveStatus: state wins once finished; list decides otherwise', () => {
  expect(effectiveStatus('done', 'running')).toBe('done')
  expect(effectiveStatus('running', 'killed')).toBe('failed')
  expect(effectiveStatus('running', 'completed')).toBe('done')
  expect(effectiveStatus(undefined, 'running')).toBe('running')
  expect(effectiveStatus('running', undefined)).toBe('running')
})

test('buildViews merges state with the agent list', () => {
  const rec = { type: 'worker', desc: 'so.med · 做事', task: '做事', model: 'claude-sonnet-5-5', effort: 'medium' as const, steps: 3, watched: true, context: 1000, output: 200, startedAt: 1000, status: 'running' as const }
  const done = { ...rec, type: 'Explore', status: 'done' as const, finishedAt: 5000, durationMs: 4000, tokens: 9000, context: 1, output: 1 }
  const unwatched = { ...rec, steps: 7, watched: false }
  const list = [
    { id: 'a', type: 'worker', status: 'running', description: 'English activity' },
    { id: 'c', type: 'reviewer', status: 'completed', description: 'ha.low · 只在列表里' },
    { id: 'tm', type: 'teammate', status: 'running', description: 'x' },
  ]
  const views = buildViews({ a: rec, b: done, u: unwatched }, list, 4000)
  expect(views.map(x => x.id)).toEqual(['a', 'b', 'u', 'c'])
  const [a, b, u, c] = views as [View, View, View, View]
  expect(a).toMatchObject({ task: '做事', rounds: 3, tokens: 1200, elapsedMs: 3000 })
  expect(u).toMatchObject({ rounds: undefined, status: 'unknown' }) // running record the list does not know
  expect(b).toMatchObject({ status: 'done', tokens: 9000, elapsedMs: 4000 })
  expect(c).toMatchObject({ type: 'reviewer', task: '只在列表里', status: 'done', rounds: undefined, tokens: undefined, elapsedMs: undefined })
})

test('reconcile: stale running records end, live and finished ones stay', () => {
  const rec = (status: 'running' | 'done') => ({ type: 'w', desc: '', task: '', steps: 0, watched: true, context: 0, output: 0, status })
  const recs = { gone: rec('running'), live: rec('running'), fin: rec('running'), failed: rec('running'), old: rec('done') }
  const list = [{ id: 'live', type: 'w', status: 'running', description: '' }, { id: 'fin', type: 'w', status: 'completed', description: '' }, { id: 'failed', type: 'w', status: 'killed', description: '' }]
  expect(reconcile(recs, list)).toEqual([['gone', 'unknown'], ['fin', 'done'], ['failed', 'failed']])
  expect(reconcile(recs, undefined)).toEqual([])
  expect(reconcile(recs, [])).toEqual([['gone', 'unknown'], ['live', 'unknown'], ['fin', 'unknown'], ['failed', 'unknown']])
  const views = buildViews(recs, list, 1000)
  expect(views.find(x => x.id === 'gone')!.status).toBe('unknown')
  expect(views.filter(x => x.status === 'running').map(x => x.id)).toEqual(['live'])
  expect(rowText(views.find(x => x.id === 'gone')!).glyph).toBe('?')
  expect(buildViews(recs, undefined, 1000).filter(x => x.status === 'running')).toHaveLength(4)
})

const ghost = { type: '', desc: '', task: '', steps: 0, watched: false, context: 0, output: 0, startedAt: 1000, status: 'running' as const }

test('ghost row: a record nothing describes is never a view (a step from an engine fork made one)', () => {
  expect(buildViews({ fork: ghost }, [], 9000)).toEqual([])
  expect(buildViews({ fork: ghost }, undefined, 9000)).toEqual([])
  expect(buildViews({ fork: { ...ghost, status: 'done' as const, finishedAt: 2000, durationMs: 463000 } }, [], 9000)).toEqual([])
  // listed with a type or a description: real, shown with what is known
  const listed = buildViews({ fork: ghost }, [{ id: 'fork', type: 'Explore', status: 'running', description: '' }], 9000)
  expect(listed).toHaveLength(1)
  expect(listed[0]).toMatchObject({ type: 'Explore', status: 'running' })
})

test('seedRec: only an agent the list names starts a record', () => {
  expect(seedRec(undefined)).toBeUndefined() // engine fork / workflow agent: no list entry
  expect(seedRec({ id: 't', type: 'teammate', status: 'running', description: 'x' })).toBeUndefined()
  expect(seedRec({ id: 'a', type: 'worker', status: 'running', description: 'so.med · 做事' })).toMatchObject({ type: 'worker', desc: 'so.med · 做事', task: '做事', status: 'running', watched: false })
  expect(seedRec({ id: 'a', type: 'worker', status: 'completed', description: 'x' })!.status).toBe('done')
})

test('withoutGhosts drops undescribed records and keeps the object when there are none', () => {
  const real = { ...ghost, type: 'worker' }
  const recs = { a: real, g: ghost }
  expect(Object.keys(withoutGhosts(recs))).toEqual(['a'])
  const clean = { a: real }
  expect(withoutGhosts(clean)).toBe(clean)
})

test('a task status that is not an end leaves a running record running', () => {
  expect(effectiveStatus('running', 'pending')).toBe('running')
  expect(effectiveStatus(undefined, 'pending')).toBe('running')
  const rec = { ...ghost, type: 'w' }
  expect(reconcile({ a: rec }, [{ id: 'a', type: 'w', status: 'pending', description: '' }])).toEqual([])
})

const run = (over: Record<string, unknown> = {}) => ({ type: 'worker', desc: 'so.med · 做事', task: '做事', steps: 1, watched: true, context: 0, output: 0, startedAt: 1000, status: 'running' as const, ...over })

test('buildViews: files, tool counts and denials ride along; the edit count takes the larger of paths and the stats', () => {
  const [a, b] = buildViews({
    a: run({ files: ['/p/a.ts', '/p/b.ts'], toolCounts: { Bash: 2 }, denied: 1, reasons: [{ text: 'no', n: 1 }], startedAt: 2000 }),
    b: run({ editCount: 4, status: 'done', finishedAt: 1500, durationMs: 500 }),
  }, [], 3000) as [View, View]
  expect(a).toMatchObject({ id: 'a', editCount: 2, toolCounts: { Bash: 2 }, denied: 1 })
  expect(b).toMatchObject({ id: 'b', editCount: 4, files: [], denied: 0 })
})

test('buildViews: conflicts need overlapping runs; the main loop joins while an agent runs', () => {
  const recs = {
    first: run({ files: ['/p/x.ts'], startedAt: 1000, status: 'done', finishedAt: 2000, durationMs: 1000 }),
    second: run({ files: ['/p/x.ts'], startedAt: 1500, status: 'running' }), // overlaps first
    later: run({ files: ['/p/x.ts'], startedAt: 2500, status: 'running' }), // starts after first ended
  }
  const listed = ['first', 'second', 'later'].map(id => ({ id, type: 'worker', status: id === 'first' ? 'completed' : 'running', description: 'x' }))
  const views = buildViews(recs, listed, 3000)
  const by = (id: string) => views.find(x => x.id === id)!
  expect(by('first').clashes).toMatchObject([{ path: '/p/x.ts', other: 'second' }])
  expect(by('second').clashes).toMatchObject([{ path: '/p/x.ts', other: 'later' }, { path: '/p/x.ts', other: 'first' }]) // views run newest first
  expect(by('later').clashes).toMatchObject([{ path: '/p/x.ts', other: 'second' }])
  const withMain = buildViews({ solo: run({ files: ['/p/y.ts'], startedAt: 1000 }) }, [{ id: 'solo', type: 'worker', status: 'running', description: 'x' }], 3000, { main: [{ path: '/p/y.ts', at: 2000 }, { path: '/p/z.ts', at: 2000 }] })
  expect(withMain[0]!.clashes).toEqual([{ path: '/p/y.ts', other: 'main', at: 2000 }])
})

test('buildViews: stall counts only running agents and uses the setting', () => {
  const recs = { r: run({ lastEventAt: 1000, pendingTool: 'Bash' }), d: run({ lastEventAt: 1000, status: 'done', finishedAt: 1100 }) }
  const at = (now: number, stallMs?: number) => buildViews(recs, [{ id: 'r', type: 'worker', status: 'running', description: 'x' }], now, { stallMs })
  expect(at(1000 + 179_000).find(x => x.id === 'r')!.stall).toBeUndefined() // default 3 min
  expect(at(1000 + 180_000).find(x => x.id === 'r')!.stall).toEqual({ level: 1, idleMs: 180_000, tool: 'Bash' })
  expect(at(1000 + 60_000, 60_000).find(x => x.id === 'r')!.stall?.level).toBe(1)
  expect(at(1000 + 600_000).find(x => x.id === 'd')!.stall).toBeUndefined()
})

test('buildViews: tier mismatch from the latest step against the description prefix', () => {
  const [ok, bad, unseen] = ['ok', 'bad', 'unseen'].map(id => buildViews({
    ok: run({ actualModel: 'claude-sonnet-5-5', actualEffort: 'medium' }),
    bad: run({ actualModel: 'claude-haiku-4', actualEffort: 'low' }),
    unseen: run({}),
  }, [], 2000).find(x => x.id === id)!) as [View, View, View]
  expect(ok.tier).toBeUndefined()
  expect(bad.tier).toMatchObject({ want: 'so.med', got: 'haiku.low', model: true, effort: true })
  expect(unseen.tier).toBeUndefined()
})

test('settled: ends are written once, ghosts dropped', () => {
  const recs = { a: run(), b: run({ status: 'done' }), g: { ...run(), type: '', desc: '' } }
  const out = settled(recs, new Map([['a', 'unknown' as const], ['b', 'failed' as const]]), 5000)
  expect(Object.keys(out)).toEqual(['a', 'b'])
  expect(out.a).toMatchObject({ status: 'unknown', finishedAt: 5000, durationMs: 4000 })
  expect(out.b!.status).toBe('done') // not running: untouched
})

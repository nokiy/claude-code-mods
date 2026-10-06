import { test, expect } from 'claude-code/testing'

import { MAX_FILES, MAX_REASONS, addDenial, addFile, denialReason, editedPath, findClashes, idleText, normPath, reasonOf, shortPath, stallOf, stallText, tierMismatch } from './alerts'
import { strings } from './strings'

test('normPath: absolute, relative to cwd, dots and doubled slashes folded', () => {
  expect(normPath('/a/b/c.ts', '/cwd')).toBe('/a/b/c.ts')
  expect(normPath('src/x.ts', '/cwd/')).toBe('/cwd/src/x.ts')
  expect(normPath('/a/./b//c/../d.ts', '/cwd')).toBe('/a/b/d.ts')
  expect(normPath('../x.ts', '/cwd/sub')).toBe('/cwd/x.ts')
  expect(shortPath('/cwd/hooks/render.tsx', '/cwd')).toBe('hooks/render.tsx')
  expect(shortPath('/other/x.ts', '/cwd')).toBe('/other/x.ts')
})

test('editedPath: the four edit tools only', () => {
  expect(editedPath('Edit', { file_path: '/a' })).toBe('/a')
  expect(editedPath('Write', { file_path: '/b' })).toBe('/b')
  expect(editedPath('MultiEdit', { file_path: '/c' })).toBe('/c')
  expect(editedPath('NotebookEdit', { notebook_path: '/n.ipynb' })).toBe('/n.ipynb')
  expect(editedPath('Read', { file_path: '/a' })).toBeUndefined()
  expect(editedPath('Bash', { command: 'sed -i x y' })).toBeUndefined()
  expect(editedPath('Edit', {})).toBeUndefined()
})

test('addFile: deduped and capped', () => {
  expect(addFile(['/a'], '/a')).toEqual(['/a'])
  expect(addFile(undefined, '/a')).toEqual(['/a'])
  const full = Array.from({ length: MAX_FILES }, (_, i) => `/f${i}`)
  expect(addFile(full, '/new')).toHaveLength(MAX_FILES)
  expect(addFile(full, '/f3')).toHaveLength(MAX_FILES)
})

test('findClashes: running at the same time and the same path; sequential reuse is not a conflict', () => {
  const a = { id: 'a', files: ['/x', '/y'], start: 100, end: 200 }
  const b = { id: 'b', files: ['/x'], start: 150, end: 300 } // overlaps a, shares /x
  const c = { id: 'c', files: ['/x', '/y'], start: 250, end: 400 } // after a ended: no clash with a; overlaps b
  const d = { id: 'd', files: ['/z'], start: 100, end: 400 } // overlaps all, shares nothing
  const out = findClashes([a, b, c, d], [])
  expect(out.get('a')).toEqual([{ path: '/x', other: 'b', at: 150 }])
  expect(out.get('b')).toEqual([{ path: '/x', other: 'a', at: 150 }, { path: '/x', other: 'c', at: 250 }])
  expect(out.get('c')).toEqual([{ path: '/x', other: 'b', at: 250 }])
  expect(out.has('d')).toBe(false)
  // touching edges overlap; a gap does not
  expect(findClashes([{ id: 'p', files: ['/x'], start: 0, end: 10 }, { id: 'q', files: ['/x'], start: 10, end: 20 }], []).size).toBe(2)
  expect(findClashes([{ id: 'p', files: ['/x'], start: 0, end: 10 }, { id: 'q', files: ['/x'], start: 11, end: 20 }], []).size).toBe(0)
})

test('findClashes: the main loop is a participant only for an edit made while the agent ran', () => {
  const a = { id: 'a', files: ['/x'], start: 100, end: 200 }
  expect(findClashes([a], [{ path: '/x', at: 150 }]).get('a')).toEqual([{ path: '/x', other: 'main', at: 150 }])
  expect(findClashes([a], [{ path: '/x', at: 150 }, { path: '/x', at: 160 }]).get('a')).toHaveLength(1) // deduped
  expect(findClashes([a], [{ path: '/x', at: 99 }]).size).toBe(0)
  expect(findClashes([a], [{ path: '/x', at: 201 }]).size).toBe(0)
  expect(findClashes([a], [{ path: '/other', at: 150 }]).size).toBe(0)
})

test('findClashes: agents with no start or no paths (backfilled) take part in nothing', () => {
  const backfilled = { id: 'b', files: [] as string[], start: undefined, end: undefined }
  const noStart = { id: 'n', files: ['/x'], start: undefined, end: undefined }
  expect(findClashes([backfilled, noStart, { id: 'a', files: ['/x'], start: 1, end: 9 }], [{ path: '/x', at: 5 }]).get('a')).toEqual([{ path: '/x', other: 'main', at: 5 }])
})

test('stallOf: running agents only, amber at the threshold, red at twice it', () => {
  const T = 180_000
  const a = { status: 'running', lastEventAt: 1000, startedAt: 0 }
  expect(stallOf(a, 1000 + T - 1, T)).toBeUndefined()
  expect(stallOf(a, 1000 + T, T)).toEqual({ level: 1, idleMs: T })
  expect(stallOf(a, 1000 + 2 * T - 1, T)?.level).toBe(1)
  expect(stallOf(a, 1000 + 2 * T, T)?.level).toBe(2)
  expect(stallOf({ ...a, status: 'done' }, 1000 + 9 * T, T)).toBeUndefined()
  expect(stallOf({ ...a, status: 'unknown' }, 1000 + 9 * T, T)).toBeUndefined()
  expect(stallOf({ status: 'running', startedAt: 0 }, T, T)).toEqual({ level: 1, idleMs: T }) // no event yet: since the start
  expect(stallOf({ status: 'running' }, 9 * T, T)).toBeUndefined()
})

test('stall text: a pending tool versus a silent agent', () => {
  expect(stallText({ level: 1, idleMs: 4 * 60_000 + 5000, tool: 'Bash' }, strings('zh'))).toBe('~4m（Bash 未返回）')
  expect(stallText({ level: 2, idleMs: 4 * 60_000 }, strings('zh'))).toBe('~4m 无动作')
  expect(stallText({ level: 1, idleMs: 4 * 60_000, tool: 'Bash' }, strings('en'))).toBe('~4m (Bash not returned)')
  expect(stallText({ level: 2, idleMs: 4 * 60_000 }, strings('en'))).toBe('~4m no activity')
  expect(idleText(45_000)).toBe('45s')
  expect(idleText(60_000)).toBe('1m')
  expect(stallOf({ status: 'running', lastEventAt: 0, pendingTool: 'Bash' }, 200_000, 180_000)?.tool).toBe('Bash')
})

test('tierMismatch: description prefix against the actual model and effort', () => {
  expect(tierMismatch('so.med · x', 'claude-sonnet-5-5', 'medium')).toBeUndefined()
  expect(tierMismatch('so.med · x', 'claude-haiku-4', 'low')).toEqual({ want: 'so.med', got: 'haiku.low', model: true, effort: true })
  expect(tierMismatch('so.med · x', 'claude-sonnet-5-5', 'high')).toEqual({ want: 'so.med', got: 'sonnet.high', model: false, effort: true })
  expect(tierMismatch('so.med · x', 'claude-opus-4', 'medium')).toEqual({ want: 'so.med', got: 'opus.med', model: true, effort: false })
  expect(tierMismatch('op.high · x', 'claude-opus-4', 'xhigh')).toBeUndefined() // xhigh counts as high
  expect(tierMismatch('so.low · x', 'claude-sonnet-5-5', 1000)).toBeUndefined() // a thinking budget under 2048 is low
  expect(tierMismatch('no prefix here', 'claude-haiku-4', 'low')).toBeUndefined()
  expect(tierMismatch('so.med · x', undefined, undefined)).toBeUndefined() // no step seen yet
  expect(tierMismatch('so.med · x', 'claude-sonnet-5-5', undefined)).toBeUndefined() // effort not reported: nothing to compare
  expect(tierMismatch('so.med · x', 'claude-sonnet-5-5', undefined)).toBeUndefined()
  expect(tierMismatch('so.med · x', 'some-other-model', 'high')).toBeUndefined() // unknown model: cannot say
  expect(tierMismatch('so.med · x', 'claude-haiku-4', undefined)).toEqual({ want: 'so.med', got: 'haiku', model: true, effort: false })
})

test('denials: first line, 80 cells, deduped with counts, ten distinct at most', () => {
  expect(denialReason('first\nsecond')).toBe('first')
  expect(denialReason('\n\n  padded  line \nrest')).toBe('padded line')
  expect(denialReason(undefined)).toBe('(no reason)')
  expect(denialReason('x'.repeat(200))).toHaveLength(80)
  let p: { denied?: number; reasons?: { text: string; n: number }[] } = {}
  for (const t of ['a\nx', 'b', 'a\ny', 'a']) p = addDenial(p, t)
  expect(p).toEqual({ denied: 4, reasons: [{ text: 'a', n: 3 }, { text: 'b', n: 1 }] })
  for (let i = 0; i < 20; i++) p = addDenial(p, `reason ${i}`)
  expect(p.reasons).toHaveLength(MAX_REASONS)
  expect(p.denied).toBe(24) // every denial counts, only distinct reasons are capped
  expect(addDenial(p, 'a').reasons![0]).toEqual({ text: 'a', n: 4 }) // a listed reason still counts after the cap
})

test('reasonOf: a deny, an errored result, or nothing', () => {
  expect(reasonOf({ deny: 'blocked' })).toBe('blocked')
  expect(reasonOf({ isError: true, text: 'File not found\nmore' })).toBe('File not found\nmore')
  expect(reasonOf({ isError: true })).toBe('')
  expect(reasonOf({ isError: false, text: 'fine' })).toBeUndefined()
  expect(reasonOf(undefined)).toBeUndefined()
})

test('timeline times: a denial keeps the time its reason was first seen; a clash the time the overlap began', () => {
  let p = addDenial({}, 'blocked', 100)
  p = addDenial(p, 'other', 150)
  p = addDenial(p, 'blocked', 200)
  expect(p.reasons).toEqual([{ text: 'blocked', n: 2, at: 100 }, { text: 'other', n: 1, at: 150 }])
  expect(addDenial({}, 'x').reasons).toEqual([{ text: 'x', n: 1 }]) // no time known: none recorded
  const out = findClashes([{ id: 'a', files: ['/x'], start: 10, end: 90 }, { id: 'b', files: ['/x'], start: 40, end: 60 }], [{ path: '/x', at: 70 }])
  expect(out.get('a')).toEqual([{ path: '/x', other: 'main', at: 70 }, { path: '/x', other: 'b', at: 40 }])
  expect(out.get('b')).toEqual([{ path: '/x', other: 'a', at: 40 }])
})

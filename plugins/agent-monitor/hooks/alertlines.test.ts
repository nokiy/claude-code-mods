import { test, expect } from 'claude-code/testing'

import { alertLines, capAlerts, dueToasts, flagSegs, lineText, segsWidth } from './alertlines'
import { view } from './fixture'
import { agentRef, formatClock } from './logic'
import { PALETTE } from './palette'
import { strings } from './strings'

const ZH = strings('zh')
const EN = strings('en')

const flags = (over = {}) => flagSegs(view(over)).map(s => s.text).join('')

test('flagSegs: width-1 glyphs, one blank apart, in the fixed order', () => {
  expect(flags()).toBe('')
  expect(flags({ clashes: [{ path: '/a', other: 'y' }] })).toBe('!')
  expect(flags({ clashes: [{ path: '/a', other: 'y' }], stall: { level: 1, idleMs: 1 }, tier: { want: 'a', got: 'b', model: true, effort: false }, denied: 12 })).toBe('! ~ ≠ ×12')
  const segs = flagSegs(view({ stall: { level: 1, idleMs: 1 }, denied: 2 }))
  expect(segs.filter(s => s.text.trim()).map(s => [s.text, s.color])).toEqual([['~', PALETTE.amber], ['×2', PALETTE.red]])
  expect(flagSegs(view({ stall: { level: 2, idleMs: 1 } }))[0]!.color).toBe(PALETTE.red)
  expect(segsWidth(flagSegs(view({ clashes: [{ path: '/a', other: 'y' }], stall: { level: 1, idleMs: 1 }, tier: { want: 'a', got: 'b', model: true, effort: false }, denied: 12 })))).toBe(9)
  for (const ch of '!~≠×') expect(ch.length).toBe(1)
})

// The four alerts at known times: tier (spawn 14:00:10), a refusal (14:00:30), the conflict (14:01:00), the same refusal twice
// (14:02:00), the stall (idle since 14:04:00).
const T = new Date(2026, 9, 2, 14, 0, 0).getTime()
const at = (s: number) => T + s * 1000
const rows = () => [
  view({ id: 'a1', type: 'worker', task: '修登录表单', status: 'done', startedAt: at(0), clashes: [{ path: '/cwd/hooks/render.tsx', other: 'a2', at: at(60) }] }),
  view({ id: 'a2', type: 'worker-hard', task: '重构渲染层逻辑代码', startedAt: at(60), lastEventAt: at(240), clashes: [{ path: '/cwd/hooks/render.tsx', other: 'a1', at: at(60) }], stall: { level: 1, idleMs: 4 * 60_000, tool: 'Bash' } }),
  view({ id: 'a3', type: 'reviewer', task: 'review', status: 'done', denied: 3, reasons: [{ text: 'no such file', n: 2, at: at(120) }, { text: 'blocked', n: 1, at: at(30) }] }),
  view({ id: 'a4', type: 'researcher', task: '查\n  文档  ', status: 'done', startedAt: at(10), tier: { want: 'so.med', got: 'haiku.low', model: true, effort: true } }),
]

test('alertLines: a timeline, oldest first, each line saying the real cause (path, tool, refusal text ×N, wanted and got tier)', () => {
  const lines = alertLines(rows(), '/cwd', ZH)
  expect(lines.map(lineText)).toEqual([
    '14:00:10 ≠ 档位  researcher「查 文档」 描述 so.med · 实际 haiku.low',
    '14:00:30 × 拦截  reviewer「review」 被拒 ×1：blocked',
    '14:01:00 ! 冲突  worker-hard「重构渲…」 与 worker「修登录…」 同时修改 hooks/render.tsx',
    '14:02:00 × 拦截  reviewer「review」 被拒 ×2：no such file',
    '14:04:00 ~ 卡住  worker-hard「重构渲…」 已 4m（Bash 未返回）',
  ])
  expect(lines.map(l => l.at)).toEqual([at(10), at(30), at(60), at(120), at(240)])
  expect(lines.map(l => l.color)).toEqual([PALETTE.red, PALETTE.red, PALETTE.red, PALETTE.red, PALETTE.amber])
  expect(lines[2]!.ids).toEqual(['a1', 'a2'])
  expect(lines.map(l => formatClock(l.at!))).toEqual(['14:00:10', '14:00:30', '14:01:00', '14:02:00', '14:04:00'])
})

test('alertLines: the same timeline in English', () => {
  expect(alertLines(rows(), '/cwd', EN).map(lineText)).toEqual([
    '14:00:10 ≠ tier  researcher"查 文档" described so.med · ran haiku.low',
    '14:00:30 × denied  reviewer"review" refused ×1: blocked',
    '14:01:00 ! conflict  worker-hard"重构渲…" and worker"修登录…" edited hooks/render.tsx at the same time',
    '14:02:00 × denied  reviewer"review" refused ×2: no such file',
    '14:04:00 ~ stalled  worker-hard"重构渲…" idle for 4m (Bash not returned)',
  ])
})

test('alertLines: an alert of unknown time reads --:--:-- and goes last; a silent stall, main as partner', () => {
  const lines = alertLines([
    view({ id: 'p', type: 'worker', stall: { level: 2, idleMs: 7 * 60_000 }, activity: '运行 bun test', clashes: [{ path: '/cwd/a.ts', other: 'main', at: at(5) }] }),
    view({ id: 'q', status: 'done', denied: 2 }), // refusals counted, reasons unknown
  ], '/cwd', ZH)
  expect(lines.map(lineText)).toEqual([
    '14:00:05 ! 冲突  worker「task」 与 main 同时修改 a.ts',
    '--:--:-- ~ 卡住  worker「task」 已 7m 无动作（最后：运行 bun test）',
    '--:--:-- × 拦截  worker「task」 被拒 ×2：（无原因）',
  ])
  expect(lines[1]!.color).toBe(PALETTE.red)
  expect(lines[0]!.ids).toEqual(['p'])
  expect(alertLines([view()], '/cwd', ZH)).toEqual([])
})

test('alertLines: an errored tool result reads 出错 in amber, a hook refusal 拦截, each at its time', () => {
  const lines = alertLines([view({ id: 'f', denied: 2, reasons: [{ text: 'blocked', n: 1, at: at(20) }, { text: 'Exit code 1', n: 1, at: at(10), failed: true }] })], '/cwd', ZH)
  expect(lines.map(lineText)).toEqual(['14:00:10 ✗ 出错  worker「task」 出错 ×1：Exit code 1', '14:00:20 × 拦截  worker「task」 被拒 ×1：blocked'])
  expect(lines.map(l => l.color)).toEqual([PALETTE.amber, PALETTE.red])
})

test('capAlerts: the newest four lines and a +N count of the earlier ones', () => {
  const lines = Array.from({ length: 7 }, (_, i) => alertLines([view({ id: `v${i}`, denied: 1, reasons: [{ text: `r${i}`, n: 1, at: at(i) }] })], '', ZH)[0]!)
  expect(capAlerts(lines)).toMatchObject({ hidden: 3 })
  expect(capAlerts(lines).shown.map(l => l.ids[0])).toEqual(['v3', 'v4', 'v5', 'v6'])
  expect(capAlerts(lines.slice(0, 4))).toMatchObject({ hidden: 0 })
  expect(capAlerts([])).toEqual({ shown: [], hidden: 0 })
})

test('dueToasts: conflicts and stalls of agents still running, once per agent and kind', () => {
  const run = view({ id: 'a', status: 'running', stall: { level: 1, idleMs: 200_000 }, denied: 1, reasons: [{ text: 'x', n: 1 }], tier: { want: 'so.med', got: 'sonnet.high', model: false, effort: true } })
  const lines = alertLines([run], '/cwd', ZH)
  const due = dueToasts(lines, new Set())
  expect(due.map(d => d.keys)).toEqual([['warned:a:stall']]) // tier and denied never toast
  expect(due[0]!.text).toContain('卡住')
  expect(dueToasts(lines, new Set(['warned:a:stall']))).toEqual([])
  const done = alertLines([view({ id: 'b', status: 'done', clashes: [{ path: '/p', other: 'main' }] })], '/cwd', ZH)
  expect(dueToasts(done, new Set())).toEqual([]) // nothing live
  expect(dueToasts(alertLines([view({ id: 'a', stall: { level: 1, idleMs: 200_000 } })], '/cwd', EN), new Set())[0]!.text).toContain('stalled')
})

test('alertLines: agents are named type「task」 with the task on one line, cut to ~8 cells; never `#n`', () => {
  const text = alertLines(rows(), '/cwd', ZH).map(lineText).join('\n')
  expect(text).not.toMatch(/#\d/)
  expect(agentRef('worker', '修登录表单', ZH)).toBe('worker「修登录…」')
  expect(agentRef('worker', 'a\n  b', ZH)).toBe('worker「a b」')
  expect(agentRef('worker', 'x'.repeat(20), ZH)).toBe('worker「xxxxxxx…」')
  expect(agentRef('worker', '', ZH)).toBe('worker')
  expect(agentRef('worker', 'a\n  b', EN)).toBe('worker"a b"')
})

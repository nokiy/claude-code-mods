import { test, expect } from 'claude-code/testing'

import { alertLines, capAlerts, dueToasts, flagSegs, lineText, segsWidth } from './alertlines'
import { view } from './fixture'
import { agentRef } from './logic'
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

const rows = () => [
  view({ id: 'a1', type: 'worker', task: '修登录表单', status: 'done', clashes: [{ path: '/cwd/hooks/render.tsx', other: 'a2' }] }), 
  view({ id: 'a2', type: 'worker-hard', task: '重构渲染层逻辑代码', clashes: [{ path: '/cwd/hooks/render.tsx', other: 'a1' }], stall: { level: 1, idleMs: 4 * 60_000 }, activity: '运行 bun test' }), 
  view({ id: 'a3', type: 'reviewer', task: 'review', status: 'done', denied: 3, reasons: [{ text: 'blocked', n: 1 }, { text: 'no such file', n: 2 }] }), 
  view({ id: 'a4', type: 'researcher', task: '查\n  文档  ', status: 'done', tier: { want: 'so.med', got: 'haiku.low', model: true, effort: true } }), 
]

test('alertLines: the sentences, pair and path once, colored like their flags', () => {
  const lines = alertLines(rows(), '/cwd', ZH)
  expect(lines.map(lineText)).toEqual([
    '! 冲突  worker-hard「重构渲…」 与 worker「修登录…」 同时修改 hooks/render.tsx',
    '~ 卡住  worker-hard「重构渲…」 已 4m 无动作（最后：运行 bun test）',
    '≠ 档位  researcher「查 文档」 描述 so.med · 实际 haiku.low',
    '× 拦截  reviewer「review」 被拒 3 次：no such file 等 2 种',
  ])
  expect(lines.map(l => l.color)).toEqual([PALETTE.red, PALETTE.amber, PALETTE.red, PALETTE.red])
  expect(lines[0]!.ids).toEqual(['a1', 'a2'])
})

test('alertLines: pending tool wording, main as partner, stall level colors', () => {
  const lines = alertLines([
    view({ id: 'p', type: 'worker', stall: { level: 2, idleMs: 7 * 60_000, tool: 'Bash' }, clashes: [{ path: '/cwd/a.ts', other: 'main' }] }),
  ], '/cwd', ZH)
  expect(lines.map(lineText)).toEqual(['! 冲突  worker「task」 与 main 同时修改 a.ts', '~ 卡住  worker「task」 已 7m（Bash 未返回）'])
  expect(lines[1]!.color).toBe(PALETTE.red)
  expect(lines[0]!.ids).toEqual(['p'])
})

test('alertLines: agents still running come first, then the kind order', () => {
  const lines = alertLines([
    view({ id: 'old', status: 'done', denied: 1, reasons: [{ text: 'x', n: 1 }] }), // finished, denied
    view({ id: 'run', tier: { want: 'so.med', got: 'opus.med', model: true, effort: false } }), // running, tier
  ], '/cwd', ZH)
  expect(lines.map(l => l.kind)).toEqual(['tier', 'denied'])
  expect(lines.map(l => l.live)).toEqual([true, false])
  expect(alertLines([view()], '/cwd', ZH)).toEqual([])
})

test('capAlerts: four lines and a +N more count', () => {
  const lines = Array.from({ length: 7 }, (_, i) => alertLines([view({ id: `v${i}`, denied: 1, reasons: [{ text: 'r', n: 1 }] })], '', ZH)[0]!)
  expect(capAlerts(lines)).toMatchObject({ hidden: 3 })
  expect(capAlerts(lines).shown).toHaveLength(4)
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
})

test('alertLines: agents are named type「task」 with the task on one line, cut to ~8 cells; never `#n`', () => {
  const text = alertLines(rows(), '/cwd', ZH).map(lineText).join('\n')
  expect(text).not.toMatch(/#\d/)
  expect(agentRef('worker', '修登录表单', ZH)).toBe('worker「修登录…」')
  expect(agentRef('worker', 'a\n  b', ZH)).toBe('worker「a b」')
  expect(agentRef('worker', 'x'.repeat(20), ZH)).toBe('worker「xxxxxxx…」')
  expect(agentRef('worker', '', ZH)).toBe('worker')
})

test('alertLines: the same alerts in English', () => {
  const lines = alertLines(rows(), '/cwd', EN)
  expect(lines.map(lineText)).toEqual([
    '! conflict  worker-hard"重构渲…" and worker"修登录…" edited hooks/render.tsx at the same time',
    '~ stalled  worker-hard"重构渲…" idle for 4m, no activity (last: 运行 bun test)',
    '≠ tier  researcher"查 文档" described so.med · ran haiku.low',
    '× denied  reviewer"review" refused 3 times: no such file (2 kinds)',
  ])
  expect(agentRef('worker', 'a\n  b', EN)).toBe('worker"a b"')
  const tool = alertLines([view({ id: 'p', stall: { level: 2, idleMs: 7 * 60_000, tool: 'Bash' }, clashes: [{ path: '/cwd/a.ts', other: 'main' }] })], '/cwd', EN)
  expect(tool.map(lineText)).toEqual(['! conflict  worker"task" and main edited a.ts at the same time', '~ stalled  worker"task" idle for 7m (Bash not returned)'])
  expect(dueToasts(alertLines([view({ id: 'a', stall: { level: 1, idleMs: 200_000 } })], '/cwd', EN), new Set())[0]!.text).toContain('stalled')
})

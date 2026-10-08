import { test, expect } from 'claude-code/testing'

import { RECENT_SHOWN, detailLines } from './detail'
import { view } from './fixture'
import { agentRef, formatClock } from './logic'
import { PALETTE } from './palette'
import { strings } from './strings'
import type { View } from './views'

const ZH = strings('zh')
const EN = strings('en')

const text = (lines: { text: string }[][]) => lines.map(l => l.map(s => s.text).join(''))
const start = new Date(2026, 9, 2, 14, 2, 11).getTime()
const clock = (ms: number) => formatClock(start + ms)

const full = (over: Partial<View> = {}): View => view({
  id: 'a2', type: 'worker-hard', task: '改渲染 与一个很长很长很长很长很长很长很长很长很长很长很长很长很长很长的任务描述', model: 'claude-sonnet-5-5', effort: 'high', rounds: 17, tokens: 67800,
  startedAt: start, finishedAt: start + 128_000, elapsedMs: 128_000, status: 'done', desc: 'so.med · 改渲染',
  prompt: '第一行指令\n第二行\n\n第三行\n第四行不显示', longestStepMs: 12_000,
  spent: { input: 1200, output: 4500, cacheRead: 100_000, cacheWrite: 20_000 }, cost: 0.1174,
  files: ['/cwd/hooks/render.tsx', '/cwd/hooks/new.ts', '/cwd/docs/a.md'], editCount: 3, fileLines: { '/cwd/hooks/render.tsx': { add: 12, del: 3 }, '/cwd/hooks/new.ts': { add: 40, del: 0 } },
  clashes: [{ path: '/cwd/hooks/render.tsx', other: 'a1', at: start + 30_000 }],
  toolCounts: { Read: 8, Bash: 12, Edit: 3 }, skills: ['tdd', 'pr'], recent: ['读取 a.ts', '修改 a.ts', '运行 bun test'],
  denied: 3, reasons: [{ text: 'blocked', n: 2, at: start + 60_000 }, { text: 'no file', n: 1, at: start + 10_000 }],
  tier: { want: 'so.med', got: 'sonnet.high', model: false, effort: true },
  result: 'r1\nr2\nr3\nr4\nr5\nr6',
  ...over,
})
const peers = [view({ id: 'a2', type: 'worker-hard', task: '别的活' }), view({ id: 'a1', type: 'worker', task: '修登录表单' })] // a1 is the peer the clash names

test('detail page: a timeline: instruction, steps, edited files, alert causes (timestamped, oldest first), then the figures', () => {
  const lines = text(detailLines(full(), '/cwd', ZH, peers))
  const me = agentRef('worker-hard', full().task, ZH)
  expect(lines[0]).toBe(' worker-hard · sonnet.high · 改渲染 与一个很长很长很长很长很长很长很长很长很长很长很长很长很长很长的任务描述')
  expect(lines.slice(1)).toEqual([
    ' 指令', '   第一行指令', '   第二行', '   第三行',
    ' 步骤', `   ● done   ${clock(0)} → ${clock(128_000)}   用时 2m08s   轮次 17   最长一步 12s   ! ≠ ×3`,
    '   → 读取 a.ts', '   → 修改 a.ts', '   → 运行 bun test',
    ' 改过的文件 3', '   ✎ hooks/render.tsx  +12 −3  与 worker「修登录…」 冲突', '   ✎ hooks/new.ts  +40 −0', '   ✎ docs/a.md',
    ' 告警',
    `   ${clock(0)} ≠ 档位  ${me} 描述 so.med · 实际 sonnet.high`,
    `   ${clock(10_000)} × 拦截  ${me} 被拒 ×1：no file`,
    `   ${clock(30_000)} ! 冲突  worker「修登录…」 与 ${me} 同时修改 hooks/render.tsx`,
    `   ${clock(60_000)} × 拦截  ${me} 被拒 ×2：blocked`,
    ' Tokens', '   输入（缓存命中）     100.0k', '   输入（缓存未命中）    21.2k', '   输出                   4.5k', '   估算花费            ≈ $0.12',
    ' 工具', '   Bash 12 · Read 8 · Edit 3',
    ' 技能', '   tdd · pr',
    ' 结果', '   r1', '   r2', '   r3', '   r4', '   r5',
  ])
})

test('detail page: only this agent\'s alerts, each line colored like its kind', () => {
  const other = view({ id: 'a1', type: 'worker', task: '修登录表单', denied: 1, reasons: [{ text: 'not mine', n: 1 }] })
  const segs = detailLines(full(), '/cwd', ZH, [full(), other])
  expect(text(segs).join('\n')).not.toContain('not mine')
  const tier = segs.find(l => l.some(s => s.text.includes('档位')))!
  expect(tier.find(s => s.text.includes('档位'))!.color).toBe(PALETTE.red)
})

test('detail page: a conflicting path is red and names the other side; the file counts are colored', () => {
  const segs = detailLines(full(), '/cwd', ZH, peers)
  const row = segs.find(l => l.some(s => s.text.includes('hooks/render.tsx')))!
  expect(row.find(s => s.text.includes('hooks/render.tsx'))!.color).toBe(PALETTE.red)
  expect(row.find(s => s.text.includes('冲突'))!.color).toBe(PALETTE.red)
  expect(row.find(s => s.text === '+12')!.color).toBe(PALETTE.green)
  const other = segs.find(l => l.some(s => s.text.includes('hooks/new.ts')))!
  expect(other[1]!.color).toBe(PALETTE.fg)
  const withMain = detailLines(full({ clashes: [{ path: '/cwd/docs/a.md', other: 'main' }, { path: '/cwd/docs/a.md', other: 'a1' }] }), '/cwd', ZH, peers)
  expect(text(withMain)).toContain('   ✎ docs/a.md  与 main、worker「修登录…」 冲突')
})

test('detail page: a section with nothing to say is left out', () => {
  const bare = view({ id: 'b', type: 'Explore', task: '查', status: 'running' })
  expect(text(detailLines(bare, '/cwd', ZH))).toEqual([' Explore · — · 查', ' 步骤', '   ◐ running'])
  // a clean agent: no Alerts section and no alert line at all
  const lines = text(detailLines(full({ prompt: undefined, spent: undefined, tokens: undefined, files: [], editCount: 0, skills: [], recent: [], result: undefined, denied: 0, reasons: [], tier: undefined, toolCounts: {}, clashes: [] }), '/cwd', ZH))
  for (const gone of ['指令', 'Tokens', '改过的文件', '工具', '技能', '告警', '结果']) expect(lines.some(l => l.startsWith(` ${gone}`))).toBe(false)
  expect(lines.some(l => /档位|拦截|冲突|卡住|[!~≠×]/.test(l))).toBe(false)
})

test('detail page: no token parts, no Tokens section; an unpriced model shows a dash; a backfilled agent knows its edit count but not its paths', () => {
  const lines = text(detailLines(view({ id: 'x', task: 't', status: 'done', tokens: 61275, editCount: 2, elapsedMs: 77_551, startedAt: undefined }), '/cwd', ZH))
  expect(lines).not.toContain(' Tokens')
  expect(text(detailLines(full({ cost: undefined }), '/cwd', ZH))).toContain('   估算花费               ≈ —')
  expect(lines).toContain(' 改过的文件 2')
  expect(lines).toContain('   ✎ 2 files · paths unknown')
  expect(lines).toContain('   ● done   用时 1m17s')
})

test('detail page: a running agent shows an open end, a stall, and only the last ten actions; prompt and result stay capped', () => {
  const recent = Array.from({ length: 14 }, (_, i) => `动作${i}`)
  const lines = text(detailLines(full({ status: 'running', finishedAt: undefined, recent, lastEventAt: start + 90_000, stall: { level: 1, idleMs: 4 * 60_000, tool: 'Bash' }, prompt: 'a\nb\nc\nd\ne', result: undefined }), '/cwd', ZH))
  expect(lines.find(l => l.includes('进行中'))).toContain(`${clock(0)} → 进行中`)
  expect(lines.find(l => l.includes('卡住'))).toContain(`   ${clock(90_000)} ~ 卡住`)
  expect(lines.find(l => l.includes('卡住'))).toContain('已 4m（Bash 未返回）')
  const steps = lines.filter(l => l.startsWith('   → '))
  expect(steps).toHaveLength(RECENT_SHOWN)
  expect(steps.at(-1)).toBe('   → 动作13')
  expect(steps[0]).toBe('   → 动作4')
  expect(lines.filter(l => ['   a', '   b', '   c', '   d', '   e'].includes(l))).toEqual(['   a', '   b', '   c'])
  expect(lines).not.toContain(' 结果')
})

test('detail page: the title carries no row number', () => {
  const [title] = text(detailLines(full(), '/cwd', ZH, peers))
  expect(title).not.toMatch(/#\d/)
})

test('detail page: the same page in English', () => {
  const lines = text(detailLines(full(), '/cwd', EN, peers))
  const me = agentRef('worker-hard', full().task, EN)
  expect(lines.slice(1)).toEqual([
    ' Instruction', '   第一行指令', '   第二行', '   第三行',
    ' Steps', `   ● done   ${clock(0)} → ${clock(128_000)}   took 2m08s   rounds 17   longest step 12s   ! ≠ ×3`,
    '   → 读取 a.ts', '   → 修改 a.ts', '   → 运行 bun test',
    ' Edited files 3', '   ✎ hooks/render.tsx  +12 −3  clashes with worker"修登录…"', '   ✎ hooks/new.ts  +40 −0', '   ✎ docs/a.md',
    ' Alerts',
    `   ${clock(0)} ≠ tier  ${me} described so.med · ran sonnet.high`,
    `   ${clock(10_000)} × denied  ${me} refused ×1: no file`,
    `   ${clock(30_000)} ! conflict  worker"修登录…" and ${me} edited hooks/render.tsx at the same time`,
    `   ${clock(60_000)} × denied  ${me} refused ×2: blocked`,
    ' Tokens', '   Input (cache hit)    100.0k', '   Input (cache miss)    21.2k', '   Output                 4.5k', '   Est. cost           ≈ $0.12',
    ' Tools', '   Bash 12 · Read 8 · Edit 3',
    ' Skills', '   tdd · pr',
    ' Result', '   r1', '   r2', '   r3', '   r4', '   r5',
  ])
  const running = text(detailLines(full({ status: 'running', finishedAt: undefined, stall: { level: 1, idleMs: 4 * 60_000, tool: 'Bash' } }), '/cwd', EN))
  expect(running.find(l => l.includes('in progress'))).toContain(`${clock(0)} → in progress`)
  expect(running.find(l => l.includes('stalled'))).toContain('idle for 4m (Bash not returned)')
})

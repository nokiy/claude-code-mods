import { test, expect } from 'claude-code/testing'

import { historyTable, panel } from './render'
import { DEFAULTS } from './config'
import { view } from './fixture'
import { strings } from './strings'
import type { Lang } from './strings'
import type { Board } from './views'

// Stand-in drawing pieces that keep their children: the tree is plain data, read here for its text.
type Node = { children?: unknown; label?: string } | string | number | boolean | null | undefined | Node[]
const keep = (type: string) => (p: { children?: unknown }) => ({ type, children: p.children })
const ui = { Box: keep('Box'), Text: keep('Text'), Button: (p: { children?: unknown }) => ({ type: 'Button', label: String(p.children) }) } as never
const acts = { open: () => {}, back: () => {}, settings: () => {}, close: () => {}, toggle: () => {}, save: () => {}, mode: () => {}, fold: () => {} }

const textOf = (n: Node): string => {
  if (n === null || n === undefined || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  return n.label ?? textOf(n.children as Node)
}

const board = (lang: Lang, views = [view({ id: 'a', status: 'done', denied: 1, reasons: [{ text: 'no', n: 1 }] })]): Board => ({ views, cwd: '/cwd', cfg: DEFAULTS, t: strings(lang) })
const ctx = { page: { kind: 'list' } as never, draft: null, focusKey: null, ringKey: null, esc: true }

test('table: footer and alert line follow the language', () => {
  const en = textOf(historyTable(ui, board('en'), 100, ctx, acts) as never)
  expect(en).toContain('↑↓ select · Enter detail')
  expect(en).toContain('Esc close')
  expect(en).toContain('denied')
  expect(en).toContain('--:--:-- × denied  worker"task" refused ×1: no') // the time column leads; this refusal's time is unknown
  const zh = textOf(historyTable(ui, board('zh'), 100, ctx, acts) as never)
  expect(zh).toContain('↑↓ 选择 · Enter 详情')
  expect(zh).toContain('拦截')
  expect(zh).toContain('被拒 ×1：no')
  expect(zh).not.toContain('select')
})

test('table: the empty state follows the language', () => {
  expect(textOf(historyTable(ui, board('en', []), 100, ctx, acts) as never)).toContain('No subagents yet this session')
  expect(textOf(historyTable(ui, board('zh', []), 100, ctx, acts) as never)).toContain('本会话还没有子代理')
})

test('settings page: labels follow the language', () => {
  const settings = { ...ctx, page: { kind: 'settings' } as never }
  const en = textOf(panel(ui, board('en'), settings, 100, acts) as never)
  expect(en).toContain('Settings')
  expect(en).toContain('Subagents panel options')
  expect(en).toContain('model.effort column')
  expect(en).toContain('Enter change')
  const zh = textOf(panel(ui, board('zh'), settings, 100, acts) as never)
  expect(zh).toContain('设置')
  expect(zh).toContain('模型.档位列')
  expect(zh).toContain('保存')
})

test('detail page: section titles follow the language', () => {
  const detail = { ...ctx, page: { kind: 'detail', id: 'a' } as never }
  expect(textOf(panel(ui, board('en'), detail, 100, acts) as never)).toContain('Timeline')
  expect(textOf(panel(ui, board('zh'), detail, 100, acts) as never)).toContain('时间线')
})

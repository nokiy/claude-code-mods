import { test, expect } from 'claude-code/testing'

import { activityText, capRows, cellWidth, clip, collapse, contextTokens, countsFromStats, effortLabel, effortName, firstLines, fitRow, formatClock, formatDuration, formatTokens, inScope, modelName, parseDescription, resolveTier, tierFromModel, tierLabel, tierName, tokensOrDash, truncate } from './logic'
import { strings } from './strings'

const ZH = strings('zh')

test('tierFromModel maps model and effort', () => {
  expect(tierFromModel('claude-opus-4-5', 'xhigh')).toBe('op.high')
  expect(tierFromModel('claude-sonnet-5-5', 'medium')).toBe('so.med')
  expect(tierFromModel('claude-haiku-4', 'low')).toBe('ha.low')
  expect(tierFromModel('fable-1', 'max')).toBe('fa.high')
  expect(tierFromModel('claude-sonnet-5-5')).toBe('so')
  expect(tierFromModel('gpt-x', 'low')).toBe(undefined)
  expect(effortLabel(1000)).toBe('low')
  expect(effortLabel(30000)).toBe('high')
})

test('tierLabel prefers the step, then the prefix, then a dash', () => {
  expect(tierLabel('claude-opus-4', 'high', 'so.med · x')).toBe('op.high')
  expect(tierLabel(undefined, undefined, 'so.med · x')).toBe('so.med')
  expect(tierLabel(undefined, undefined, 'plain')).toBe('—')
})

test('parseDescription strips the prefix', () => {
  expect(parseDescription('so.med · 调研子代理行')).toEqual({ tier: 'so.med', task: '调研子代理行' })
  expect(parseDescription('  plain task ')).toEqual({ task: 'plain task' })
})

test('formatTokens and formatDuration', () => {
  expect(formatTokens(999)).toBe('999')
  expect(formatTokens(42300)).toBe('42.3k')
  expect(formatTokens(1_200_000)).toBe('1.2M')
  expect(formatDuration(5000)).toBe('5s')
  expect(formatDuration(72_000)).toBe('1m12s')
  expect(formatDuration(3_900_000)).toBe('1h05m')
})

test('truncate counts cells', () => {
  expect(cellWidth('ab中')).toBe(4)
  expect(truncate('abcdef', 4)).toBe('abc…')
  expect(truncate('abc', 4)).toBe('abc')
  expect(truncate('中文字符', 5)).toBe('中文…')
  expect(truncate('abc', 0)).toBe('')
})

test('activityText per tool', () => {
  expect(activityText('Read', { file_path: '/a/b/claude-code.d.ts' }, ZH)).toBe('读取 claude-code.d.ts')
  expect(activityText('Edit', { file_path: '/a/x.ts' }, ZH)).toBe('修改 x.ts')
  expect(activityText('MultiEdit', { file_path: '/a/x.ts' }, ZH)).toBe('修改 x.ts')
  expect(activityText('Write', { file_path: '/a/y.ts' }, ZH)).toBe('写入 y.ts')
  expect(activityText('Grep', { pattern: 'a'.repeat(30) }, ZH)).toBe(`搜索 "${'a'.repeat(23)}…"`)
  expect(activityText('Glob', { pattern: '**/*.ts' }, ZH)).toBe('查找 **/*.ts')
  expect(activityText('Bash', { description: 'Run tests', command: 'npm t' }, ZH)).toBe('运行 Run tests')
  expect(activityText('Bash', { command: 'ls -la' }, ZH)).toBe('运行 ls -la')
  expect(activityText('WebFetch', { url: 'https://example.com/a?b=1' }, ZH)).toBe('抓取 example.com')
  expect(activityText('WebSearch', { query: 'hooks' }, ZH)).toBe('搜索网页 "hooks"')
  expect(activityText('Skill', { skill: 'tdd' }, ZH)).toBe('技能 tdd')
  expect(activityText('Agent', { subagent_type: 'Explore' }, ZH)).toBe('派发 Explore')
  expect(activityText('LSP', {}, ZH)).toBe('代码导航')
  expect(activityText('TodoWrite', {}, ZH)).toBe('TodoWrite')
})

test('contextTokens and fitRow', () => {
  expect(contextTokens({ input_tokens: 1, output_tokens: 9, cache_read_input_tokens: 2, cache_creation_input_tokens: 3 })).toBe(6)
  const r = fitRow(60, 30, 'a long task description here', 'reading something long')
  expect(cellWidth(r.task) + cellWidth(r.activity) + 30 + 6 <= 60).toBe(true)
  expect(fitRow(200, 30, 'short', 'x')).toEqual({ task: 'short', activity: 'x' })
})

test('modelName, effortName and resolveTier map to full words', () => {
  expect(modelName('claude-opus-4-5')).toBe('opus')
  expect(modelName('claude-sonnet-5-5')).toBe('sonnet')
  expect(modelName('haiku')).toBe('haiku')
  expect(modelName('fable-1')).toBe('fable')
  expect(modelName('gpt-x')).toBe(undefined)
  expect(effortName('xhigh')).toBe('high')
  expect(effortName('medium')).toBe('medium')
  expect(effortName(5000)).toBe('medium')
  expect(effortName(undefined)).toBe(undefined)
  expect(resolveTier('claude-haiku-4', 'low', 'so.med · x')).toEqual({ model: 'haiku', effort: 'low' })
  expect(resolveTier(undefined, undefined, 'so.med · x')).toEqual({ model: 'sonnet', effort: 'medium' })
  expect(resolveTier('claude-opus-4', undefined, 'op.high · x')).toEqual({ model: 'opus', effort: 'high' })
  expect(resolveTier(undefined, undefined, 'plain')).toEqual({ model: undefined, effort: undefined })
})

test('tokens: dash while 0, running figure is one step (no summed outputs)', () => {
  expect(tokensOrDash(0)).toBe('—')
  expect(tokensOrDash(undefined)).toBe('—')
  expect(tokensOrDash(26700)).toBe('26.7k')
  const ctx = contextTokens({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 })
  expect(ctx + 50).toBe(1050)
})

test('collapse whitespace, also inside activity text', () => {
  expect(collapse('a \n\t b   c ')).toBe('a b c')
  expect(parseDescription('so.med · line one\n  line two').task).toBe('line one line two')
  expect(activityText('Bash', { command: 'echo a\n\n   echo b' }, ZH)).toBe('运行 echo a echo b')
})

test('cellWidth: emoji 2, zero-width and combining 0', () => {
  expect(cellWidth('🚀')).toBe(2)
  expect(cellWidth('a\u200bb')).toBe(2)
  expect(cellWidth('e\u0301')).toBe(1)
  expect(cellWidth('✓◐')).toBe(2)
  expect(truncate('🚀🚀🚀', 5)).toBe('🚀🚀…')
})

test('capRows leaves one row for the +N summary', () => {
  expect(capRows(3, 5)).toEqual({ shown: 3, hidden: 0 })
  expect(capRows(5, 5)).toEqual({ shown: 5, hidden: 0 })
  expect(capRows(8, 5)).toEqual({ shown: 4, hidden: 4 })
  expect(capRows(2, 1)).toEqual({ shown: 0, hidden: 2 })
})

test('inScope: an empty scope is everywhere; a set scope is that directory and its subdirectories only', () => {
  expect(inScope('/tmp', '')).toBe(true)
  expect(inScope('/any/where/at/all', '  ')).toBe(true)
  expect(inScope('/work/proj', '/work/proj')).toBe(true)
  expect(inScope('/work/proj/', '/work/proj/')).toBe(true)
  expect(inScope('/work/proj/apps/x', '/work/proj')).toBe(true)
  expect(inScope('/work/proj2', '/work/proj')).toBe(false)
  expect(inScope('/work', '/work/proj')).toBe(false)
  expect(inScope('/tmp', '/work/proj')).toBe(false)
})

import { expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG } from '../hooks/config'
import {
  BUILT_INS,
  HIDDEN_AGENTS,
  agentFromAnswer,
  composePrompt,
  handOffHint,
  defaultsLabel,
  defaultsParts,
  effortsFor,
  frontmatterDescription,
  imageFile,
  imageRoots,
  isClone,
  isListed,
  keywordRoute,
  mergeRoster,
  parseCount,
  placeholders,
  planCommand,
  resolveExact,
  routeLabel,
  settleJob,
  spawnArgs,
  withImagePaths,
  withOffered,
} from '../hooks/logic'

const ROSTER = [
  { name: 'worker', description: '' },
  { name: 'worker-hard', description: '' },
  { name: 'ui', description: '' },
  { name: 'reviewer', description: '' },
  { name: 'researcher', description: '' },
  ...BUILT_INS,
]
const CFG = { ...DEFAULT_CONFIG, aliases: { worker: 'w', 'worker-hard': 'o', ui: 'u', reviewer: 'v' } }

test('resolveExact: name or alias, case-insensitive, no prefixes', () => {
  expect(resolveExact('UI', ROSTER, CFG.aliases)).toBe('ui')
  expect(resolveExact('explore', ROSTER, CFG.aliases)).toBe('Explore')
  expect(resolveExact('O', ROSTER, CFG.aliases)).toBe('worker-hard')
  expect(resolveExact('worker-h', ROSTER, CFG.aliases)).toBe(undefined)
  expect(resolveExact('gen', ROSTER, CFG.aliases)).toBe(undefined)
})

test('parseCount: xN / ×N suffix, clamped to max', () => {
  expect(parseCount('draw a page', 3)).toEqual({ task: 'draw a page', count: 1, note: '' })
  expect(parseCount('draw a page x2', 3)).toEqual({ task: 'draw a page', count: 2, note: '' })
  expect(parseCount('draw ×3', 3)).toEqual({ task: 'draw', count: 3, note: '' })
  expect(parseCount('draw X9', 3)).toEqual({ task: 'draw', count: 3, note: '数量 9 超过上限 3，按 3 个派发' })
  expect(parseCount('fix2', 3).count).toBe(1)
  expect(parseCount('x2', 3)).toEqual({ task: '', count: 2, note: '' })
})

test('planCommand: picker, settings, named dispatch, alias, route', () => {
  expect(planCommand('', ROSTER, CFG)).toEqual({ action: 'pick', picked: '', note: '' })
  expect(planCommand('set', ROSTER, CFG)).toEqual({ action: 'settings' })
  expect(planCommand(' SET ', ROSTER, CFG)).toEqual({ action: 'settings' })
  expect(planCommand('set up ci x2', ROSTER, CFG)).toEqual({ action: 'route', task: 'set up ci', count: 2, note: '' })
  expect(planCommand('setting', ROSTER, CFG)).toEqual({ action: 'settings' })
  expect(planCommand(' Settings ', ROSTER, CFG)).toEqual({ action: 'settings' })
  expect(planCommand('UI', ROSTER, CFG)).toEqual({ action: 'pick', picked: 'ui', note: '' })
  expect(planCommand('ui 画个登录页 x2', ROSTER, CFG)).toEqual({ action: 'dispatch', agent: 'ui', task: '画个登录页', count: 2, note: '' })
  expect(planCommand('w fix the bug', ROSTER, CFG)).toEqual({ action: 'dispatch', agent: 'worker', task: 'fix the bug', count: 1, note: '' })
  expect(planCommand('nosuchword 帮我画个页面 x2', ROSTER, CFG)).toEqual({ action: 'route', task: 'nosuchword 帮我画个页面', count: 2, note: '' })
  expect(planCommand('setting up ci', ROSTER, CFG)).toEqual({ action: 'route', task: 'setting up ci', count: 1, note: '' })
  expect(planCommand('worker-h x', ROSTER, CFG).action).toBe('route')
})

test('keywordRoute: first matching rule wins, case-insensitive', () => {
  expect(keywordRoute('帮我画个页面', DEFAULT_CONFIG.rules)).toEqual({ agent: 'ui', via: 'keyword', keyword: '页面' })
  expect(keywordRoute('please REVIEW this', DEFAULT_CONFIG.rules)).toEqual({ agent: 'reviewer', via: 'keyword', keyword: 'review' })
  expect(keywordRoute('hello', DEFAULT_CONFIG.rules)).toBe(undefined)
})

test('agentFromAnswer validates against the roster', () => {
  expect(agentFromAnswer('ui', ROSTER)).toBe('ui')
  expect(agentFromAnswer('`Reviewer`.', ROSTER)).toBe('reviewer')
  expect(agentFromAnswer('I would pick researcher here', ROSTER)).toBe('researcher')
  expect(agentFromAnswer('designer', ROSTER)).toBe(undefined)
  expect(agentFromAnswer('worker or reviewer', ROSTER)).toBe(undefined)
})

test('routeLabel names the route', () => {
  expect(routeLabel({ agent: 'ui', via: 'keyword', keyword: '页面' })).toBe('关键词「页面」')
  expect(routeLabel({ agent: 'ui', via: 'model' })).toBe('模型判断')
  expect(routeLabel({ agent: 'ui', via: 'default' })).toBe('默认')
})

test('effortsFor: copy 1 of xN (N>=2) at the extra effort, the rest and x1 at the default', () => {
  expect(effortsFor(1, 'high')).toEqual([undefined])
  expect(effortsFor(2, 'high')).toEqual(['high', undefined])
  expect(effortsFor(3, 'max')).toEqual(['max', undefined, undefined])
  expect(effortsFor(3, undefined)).toEqual([undefined, undefined, undefined])
})

const QUICK = 's-dispatch:quick'

test('defaultsLabel: file values, quick from settings, 继承 fallback', () => {
  expect(defaultsLabel({ name: 'worker', description: '', model: 'opus', effort: 'medium' }, DEFAULT_CONFIG, 'sonnet', QUICK)).toBe('opus·medium')
  expect(defaultsLabel({ name: 'Plan', description: '' }, DEFAULT_CONFIG, 'sonnet', QUICK)).toBe('sonnet(继承)·继承')
  expect(defaultsLabel({ name: 'x', description: '', model: 'haiku' }, DEFAULT_CONFIG, 'sonnet', QUICK)).toBe('haiku·继承')
  expect(defaultsLabel({ name: 'claude', description: '' }, DEFAULT_CONFIG, '', QUICK)).toBe('主模型(继承)·继承')
  expect(defaultsLabel({ name: QUICK, description: '' }, { ...DEFAULT_CONFIG, quick: { model: 'haiku', effort: 'high' } }, 'sonnet', QUICK)).toBe('haiku·high')
})

test('defaultsParts: inherited flag drives the dim color, quick follows the settings', () => {
  expect(defaultsParts({ name: 'worker', description: '', model: 'opus', effort: 'medium' }, DEFAULT_CONFIG, 'sonnet', QUICK)).toEqual({ model: 'opus', effort: 'medium', inherited: false, label: 'opus·medium' })
  expect(defaultsParts({ name: 'Plan', description: '' }, DEFAULT_CONFIG, 'sonnet', QUICK)).toEqual({ model: 'sonnet', effort: '继承', inherited: true, label: 'sonnet(继承)·继承' })
  expect(defaultsParts({ name: QUICK, description: '' }, DEFAULT_CONFIG, '', QUICK)).toEqual({ model: 'sonnet', effort: 'low', inherited: false, label: 'sonnet·low' })
  expect(defaultsParts({ name: 'x', description: '', model: 'inherit' }, DEFAULT_CONFIG, '', QUICK).inherited).toBe(true)
})

test('composePrompt prepends the extra prompt', () => {
  expect(composePrompt(undefined, 't')).toBe('t')
  expect(composePrompt('  ', 't')).toBe('t')
  expect(composePrompt('先读规范', 't')).toBe('先读规范\n\n任务：t')
})

test('isClone and mergeRoster drop effort clones', () => {
  expect(isClone('s-dispatch:worker-high')).toBe(true)
  expect(isClone('s-dispatch:quick')).toBe(false)
  expect(isClone('worker-hard')).toBe(false)
  const merged = mergeRoster([{ name: 's-dispatch:ui-low', description: '' }, { name: 'Explore', description: 'file' }], BUILT_INS)
  expect(merged.some(a => a.name === 's-dispatch:ui-low')).toBe(false)
  expect(merged.filter(a => a.name.toLowerCase() === 'explore')).toEqual([{ name: 'Explore', description: 'file' }])
})

test('frontmatterDescription reads quoted and bare values', () => {
  expect(frontmatterDescription('---\nname: x\ndescription: "Read-only search."\nmodel: haiku\n---\nbody')).toBe('Read-only search.')
  expect(frontmatterDescription('no frontmatter')).toBe('')
})

test('withOffered keeps identity when unchanged', () => {
  const list = [{ name: 'ui', description: 'd' }]
  expect(withOffered(list, { name: 'ui', description: 'd' })).toBe(list)
  expect(withOffered(list, { name: 'Plan', description: 'p' }).length).toBe(2)
})

test('spawnArgs carries type, prompt, short description', () => {
  const long = 'a'.repeat(100)
  const spec = spawnArgs('worker', long, 'extra\n\n任务：x')
  expect(spec.subagentType).toBe('worker')
  expect(spec.prompt).toBe('extra\n\n任务：x')
  expect(spec.description.length).toBe(40)
})

test('settleJob: answered, aborted, empty, error', () => {
  const job = { agent: 'ui', task: '画个登录页' }
  expect(settleJob(job, { answer: 'done', isAborted: false, reason: 'answer' })).toEqual({ toast: 'ui 完成', appendText: '[/s ui] result:\ndone' })
  expect(settleJob(job, { answer: '', isAborted: true, reason: 'aborted' }).toast).toBe('ui 已中断')
  expect(settleJob(job, { answer: '  ', isAborted: false, reason: 'answer' }).appendText).toMatch(/no answer/)
  expect(settleJob(job, { answer: '', isAborted: false, reason: 'error' }).toast).toMatch(/失败/)
})

test('isListed hides claude and claude-code-guide only', () => {
  expect(HIDDEN_AGENTS).toEqual(['claude', 'claude-code-guide'])
  expect(['claude', 'claude-code-guide', 'ui', 'Explore'].map(isListed)).toEqual([false, false, true, true])
})

test('withImagePaths: found, missing, repeated, none', () => {
  const P = '/tmp/claude-501/p/s/images/1.png'
  const READ = '\n\n用 Read 工具打开上面的图片路径查看图片。'
  const task = '看 [Image #1] 和 [Image #4] 再看 [Image #1]'
  expect(placeholders(task)).toEqual([1, 4])
  expect(withImagePaths(task, new Map([[1, P], [4, undefined]]))).toEqual({
    text: `看 [Image #1: ${P}] 和 [Image #4] 再看 [Image #1: ${P}]${READ}`,
    note: '[Image #4] 没找到图片文件，子代理看不到这张图',
  })
  expect(withImagePaths('[Image #2] [Image #3]', new Map([[2, undefined], [3, undefined]]))).toEqual({
    text: '[Image #2] [Image #3]',
    note: '[Image #2] [Image #3] 没找到图片文件，子代理看不到这些图',
  })
  expect(withImagePaths('draw', new Map())).toEqual({ text: 'draw', note: '' })
  expect(imageFile('/d', 7)).toBe('/d/7.png')
})

test('imageRoots: CLAUDE_CODE_TMPDIR and its claude-<uid> child, else /tmp/claude-<uid>', () => {
  expect(imageRoots(undefined, '501')).toEqual(['/tmp/claude-501'])
  expect(imageRoots('/x/tmp/', '501')).toEqual(['/x/tmp/claude-501', '/x/tmp'])
  expect(imageRoots('/x/tmp', '')).toEqual(['/x/tmp'])
  expect(imageRoots(undefined, '')).toEqual([])
})

test('handOffHint: ahead (hidden, before the task) or under it; count and 附加提示词 (one line, trailing 。 dropped) only when there', () => {
  expect(handOffHint('ui', 1, '  ', false)).toBe('请在后台派遣 ui 子代理完成上面的任务；由你结合前面的对话编排说明后再派。')
  expect(handOffHint('worker', 2, undefined, false)).toBe('请在后台派遣 worker 子代理完成上面的任务，派 2 份；由你结合前面的对话编排说明后再派。')
  expect(handOffHint('ui', 3, '先读\n规范。', true)).toBe(
    '接下来这条消息是用户用 /s 交来的任务：请在后台派遣 ui 子代理完成它，派 3 份，要求：先读 规范；由你结合前面的对话编排说明后再派，不要自己动手做。',
  )
})

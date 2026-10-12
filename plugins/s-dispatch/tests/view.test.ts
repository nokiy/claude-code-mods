import { expect, test } from 'claude-code/testing'

import { DEFAULT_CONFIG } from '../hooks/config'
import { AUTO, activeTab, draftHome, renameNote, breadcrumb, chipHint, chipOptions, filterAgents, firstFieldKey, fitCells, levelHint, modelColor, nextLevel, optionLabel, pickerRows, ringTarget, topChoice } from '../hooks/view'

const QUICK = 's-dispatch:quick'

test('pickerRows: name, model·effort, alias, description; columns aligned, description fits the width', () => {
  const cfg = { ...DEFAULT_CONFIG, aliases: { worker: 'w', 'claude-code-guide': 'c' } }
  const long = 'Routine implementation and tests, plus edits to docs, skills and config'
  const agents = [
    { name: 'worker', description: long, model: 'opus', effort: 'medium' },
    { name: 'claude-code-guide', description: 'Answers questions' },
    { name: QUICK, description: '' },
  ]
  const rows = pickerRows(agents, cfg, 'sonnet', QUICK, 200)
  expect(rows.map(r => r.name)).toEqual(['worker', 'claude-code-guide', QUICK])
  expect(rows.map(r => `${r.nameCell}  ${r.defaultsCell}  ${r.aliasCell}  ${r.description}`.trimEnd())).toEqual([
    `worker             opus·medium        w  ${long.slice(0, 39)}…`,
    'claude-code-guide  sonnet(继承)·继承  c  Answers questions',
    's-dispatch:quick   sonnet·low         -',
  ])
  expect(rows.map(r => r.color)).toEqual(['magenta', undefined, 'blue'])
  // 2 marker + 17 name + 2 + 17 defaults + 2 + 1 alias + 2 = 43 cells before the description.
  expect(pickerRows(agents, cfg, 'sonnet', QUICK, 53)[1]!.description).toBe('Answers q…')
  expect(pickerRows(agents, cfg, 'sonnet', QUICK, 46)[1]!.description).toBe('')
})

test('modelColor: haiku green, sonnet blue, opus magenta, inherited dim', () => {
  expect(['haiku', 'sonnet', 'opus', 'fable'].map(m => modelColor(m, false))).toEqual(['green', 'blue', 'magenta', undefined])
  expect(modelColor('opus', true)).toBe(undefined)
})

test('fitCells counts wide characters as two cells', () => {
  expect(fitCells('设计页面原型', 7)).toBe('设计页…')
  expect(fitCells('abc', 3)).toBe('abc')
})

test('chip options lead with a stray current value; hints explain the chosen option', () => {
  expect(chipOptions('routeMode', 'hybrid').map(c => c.label)).toEqual(['仅关键词', '仅小模型', '混合', '关闭'])
  expect(chipOptions('maxCount', '7').map(c => c.value)).toEqual(['7', '1', '2', '3', '4', '5'])
  expect(chipOptions('quickModel', 'inherit').map(c => c.value)).toEqual(['inherit', 'haiku', 'sonnet', 'opus'])
  expect(chipHint('routeMode', 'keyword')).toBe('仅关键词：只按下面的规则匹配，不花钱')
  expect(chipHint('routeMode', 'model')).toBe('仅小模型：让 Haiku 读任务和代理描述来挑，约 1–2 秒')
  expect(chipHint('routeMode', 'hybrid')).toBe('混合：先查关键词，没命中再问 Haiku')
  expect(chipHint('routeMode', 'off')).toBe('关闭：一律派默认代理')
  expect(chipHint('ttl', '5m')).toBe('5m：便宜但易过期 · 只有 5m / 1h 两档，写入 ~/.claude/settings.json')
  expect(chipHint('ttl', '')).toMatch(/^未设置/)
  expect(chipHint('quickModel', 'haiku')).toBe('haiku：最快最省，适合简单活')
  expect(chipHint('maxCount', '3')).toBe('末尾 xN 最多派 3 份，超出按 3 份派发')
  expect(chipHint('extra', 'none')).toBe('无：每份都用代理默认档位')
  expect(chipHint('extra', 'high')).toBe('high：x2 及以上时第 1 份用 high，其余用默认；x1 用默认')
  expect(chipHint('visible', 'off')).toMatch(/^隐藏：/)
})

test('breadcrumb names the tab, and the agent while one is open', () => {
  expect(breadcrumb('general', '')).toBe('设置 › 通用')
  expect(breadcrumb('route', 'ui')).toBe('设置 › 路由')
  expect(breadcrumb('agents', 'ui')).toBe('设置 › 代理 › ui')
  expect(breadcrumb('nope', '')).toBe('设置 › 通用')
  expect([activeTab('dispatch'), activeTab('route'), activeTab('')]).toEqual(['general', 'route', 'general'])
})

test('nextLevel: Esc climbs detail → list → tab bar → close; presses and ring moves set the level', () => {
  const esc = (hasPopup: boolean) => ({ kind: 'escape', hasPopup }) as const
  expect([nextLevel(2, esc(false)), nextLevel(1, esc(false)), nextLevel(0, esc(false))]).toEqual([1, 0, 'close'])
  // An open dropdown or rule draft folds first, the level kept.
  expect([nextLevel(1, esc(true)), nextLevel(2, esc(true))]).toEqual([1, 2])
  expect(nextLevel(2, { kind: 'back' })).toBe(1)
  expect(nextLevel(1, { kind: 'openAgent' })).toBe(2)
  expect([nextLevel(0, { kind: 'tab' }), nextLevel(2, { kind: 'tab' })]).toEqual([1, 1])
  const ring = (key: string | undefined, hasDetail = false) => ({ kind: 'ring', key, hasDetail }) as const
  expect(nextLevel(1, ring('tab:route'))).toBe(0)
  expect(nextLevel(2, ring(undefined, true))).toBe(0)
  expect(nextLevel(0, ring('c:ttl:5m'))).toBe(1)
  expect(nextLevel(0, ring('field:vis:ui', true))).toBe(2)
  expect([nextLevel(1, ring('close')), nextLevel(2, ring('close', true))]).toEqual([1, 2])
})

test('firstFieldKey and levelHint', () => {
  expect([firstFieldKey('general', 'ui'), firstFieldKey('route', 'ui'), firstFieldKey('agents', 'ui'), firstFieldKey('agents', undefined)]).toEqual([
    'field:ttl',
    'field:routeMode',
    'agent:ui',
    undefined,
  ])
  expect(ringTarget('tab:general', 'tab:route', 'field:ttl')).toBe('field:ttl')
  expect(ringTarget('tab:general', 'field:ttl', 'field:ttl')).toBe('field:ttl')
  expect(ringTarget('field:maxCount', 'tab:agents', 'field:ttl')).toBe('tab:agents')
  expect(ringTarget('tab:agents', undefined, 'agent:ui')).toBe(undefined)
  expect(ringTarget('tab:general', 'tab:route', undefined)).toBe('tab:route')
  expect([levelHint(0), levelHint(1), levelHint(2)].map(h => h.split(' · ').at(-1))).toEqual(['Esc 关闭', 'Esc 返回页签', 'b/Esc 取消返回列表'])
})

test('optionLabel: a dropdown option carries its short explanation', () => {
  expect(optionLabel('routeMode', { value: 'hybrid', label: '混合' })).toBe('混合 · 先查关键词，没命中再问 Haiku')
  expect(optionLabel('maxCount', { value: '2', label: '2' })).toBe('2')
})

test('filterAgents: exact alias, then name prefix, then name/description substring; empty keeps all', () => {
  const agents = [
    { name: 'reviewer', description: 'reviews diffs' },
    { name: 'ui', description: 'UI work' },
    { name: 'worker', description: 'Implements briefs' },
    { name: 'worker-hard', description: 'hard ones' },
    { name: 'Plan', description: 'plans the work' },
  ]
  const aliases = { reviewer: 'r', ui: 'u', worker: 'w', 'worker-hard': 'o', Plan: 'p' }
  const names = (q: string) => filterAgents(agents, aliases, q).map(a => a.name)
  expect(names('')).toEqual(['reviewer', 'ui', 'worker', 'worker-hard', 'Plan'])
  expect(names('O')).toEqual(['worker-hard', 'ui', 'worker', 'Plan'])
  expect(names('w')).toEqual(['worker', 'worker-hard', 'reviewer', 'ui', 'Plan'])
  expect(names('work')).toEqual(['worker', 'worker-hard', 'ui', 'Plan'])
  expect(names('pl')).toEqual(['Plan', 'worker'])
  expect(names('zzz')).toEqual([])
  // Enter in 代理: 自动路由 on an empty filter, else the best match, else nothing.
  expect([topChoice(agents, aliases, ''), topChoice(agents, aliases, ' '), topChoice(agents, aliases, 'o'), topChoice(agents, aliases, 'zzz')]).toEqual([
    AUTO,
    AUTO,
    'worker-hard',
    undefined,
  ])
})

test('renameNote and draftHome', () => {
  expect(renameNote('s', 'su', true)).toBe('已改名为 /su，插件已重载，只保留这一个')
  expect(renameNote('s', 'su', false)).toBe('已改名为 /su；旧名字 /s 要重载或下次会话才消失')
  expect([draftHome(null), draftHome({}), draftHome({ index: 2 })]).toEqual(['ruleAdd', 'ruleAdd', 'rule:2'])
})

test('dispatchMode chips: 交给主会话 / 直接派, each explained', () => {
  expect(chipOptions('dispatchMode', 'main').map(c => c.label)).toEqual(['交给主会话', '直接派'])
  expect(chipHint('dispatchMode', 'main')).toMatch(/^交给主会话：.*不走路由$/)
  expect(chipHint('dispatchMode', 'direct')).toMatch(/^直接派：.*路由/)
})

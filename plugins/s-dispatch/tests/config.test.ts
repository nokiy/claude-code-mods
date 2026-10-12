import { expect, test } from 'claude-code/testing'

import {
  DEFAULT_CONFIG,
  DEFAULT_VISIBLE,
  agentForm,
  aliasError,
  applyAgentForm,
  applyRuleDraft,
  isFormChanged,
  isOwnProvider,
  assignAliases,
  cloneSpec,
  commandNameOf,
  formatRule,
  isVisible,
  normalizeConfig,
  parseRule,
  quickSpec,
  readJsonKey,
  validateTtl,
  withJsonKey,
} from '../hooks/config'

const ORDER = ['Explore', 'general-purpose', 'merger', 'researcher', 'reviewer', 'ui', 'worker', 'worker-hard']

test('assignAliases: current roster gets e,g,m,r,v,u,w,o', () => {
  const aliases = assignAliases(ORDER, {})
  expect(ORDER.map(n => aliases[n])).toEqual(['e', 'g', 'm', 'r', 'v', 'u', 'w', 'o'])
})

test('assignAliases keeps assigned ones, skips non-letters, same object when unchanged', () => {
  const kept = { reviewer: 'r' }
  const next = assignAliases(['researcher', 'reviewer'], kept)
  expect(next).toEqual({ reviewer: 'r', researcher: 'e' })
  expect(assignAliases(['reviewer'], kept)).toBe(kept)
  expect(assignAliases(['x-1y'], { a: 'x' })).toEqual({ a: 'x', 'x-1y': 'y' })
  expect(assignAliases(['ab'], { p: 'a', q: 'b' })).toEqual({ p: 'a', q: 'b' })
})

test('aliasError rejects duplicates, names, reserved words', () => {
  const aliases = { worker: 'w', ui: 'u' }
  expect(aliasError(aliases, ORDER, 'ui', 'W')).toBe('「W」已被 worker 占用，不能设置')
  expect(aliasError(aliases, ORDER, 'ui', 'merger')).toBe('「merger」是代理 merger 的名字')
  expect(aliasError(aliases, ORDER, 'ui', 'setting')).toBe('「setting」是保留字')
  expect(aliasError(aliases, ORDER, 'ui', 'set')).toBe('「set」是保留字')
  expect(aliasError(aliases, ORDER, 'ui', 'u')).toBe(undefined)
  expect(aliasError(aliases, ORDER, 'ui', '')).toBe(undefined)
})

test('normalizeConfig fills defaults and keeps what fits', () => {
  expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG)
  const cfg = normalizeConfig({ routeMode: 'model', maxCount: 5, quick: { effort: 'nope' }, commandName: 'bad name', multiEffort: 'ladder', extraEffort: { worker: 'high', ui: 'turbo', x: 3 } })
  expect(cfg.routeMode).toBe('model')
  expect(cfg.maxCount).toBe(5)
  expect(cfg.quick).toEqual({ model: 'sonnet', effort: 'low' })
  expect(cfg.commandName).toBe(null)
  expect(cfg.extraEffort).toEqual({ worker: 'high' })
  expect('multiEffort' in cfg).toBe(false)
  expect(DEFAULT_CONFIG.rules.map(formatRule)).toEqual([
    '页面/原型/草图/界面 → ui',
    '调研/查文档/research → researcher',
    '审查/review → reviewer',
    '修/实现/fix → worker',
  ])
})

test('commandNameOf: stored, else option, else s', () => {
  expect(commandNameOf(DEFAULT_CONFIG, undefined)).toBe('s')
  expect(commandNameOf(DEFAULT_CONFIG, 'd')).toBe('d')
  expect(commandNameOf({ ...DEFAULT_CONFIG, commandName: 'go' }, 'd')).toBe('go')
  expect(commandNameOf(DEFAULT_CONFIG, 'setting')).toBe('s')
  expect(commandNameOf(DEFAULT_CONFIG, 'set')).toBe('s')
})

test('isVisible: default visible set, stored choices win', () => {
  expect(DEFAULT_VISIBLE).toEqual(['ui', 'worker', 'worker-hard', 'researcher', 'reviewer', 'Explore', 'general-purpose'])
  for (const name of DEFAULT_VISIBLE) expect(isVisible(DEFAULT_CONFIG, name)).toBe(true)
  for (const name of ['merger', 'Plan', 'claude-code-guide', 's-dispatch:quick', 'loki-pm:scout']) expect(isVisible(DEFAULT_CONFIG, name)).toBe(false)
  expect(isVisible({ ...DEFAULT_CONFIG, visibleAgents: { ui: false, merger: true } }, 'ui')).toBe(false)
  expect(isVisible({ ...DEFAULT_CONFIG, visibleAgents: { ui: false, merger: true } }, 'merger')).toBe(true)
})

test('parseRule reads and validates rule lines', () => {
  expect(parseRule('页面 / 原型 → UI', ORDER)).toEqual({ rule: { keywords: ['页面', '原型'], agent: 'ui' } })
  expect(parseRule('a->worker', ORDER)).toEqual({ rule: { keywords: ['a'], agent: 'worker' } })
  expect(parseRule('a → nobody', ORDER)).toEqual({ error: '没有代理叫「nobody」' })
  expect(parseRule('just words', ORDER)).toEqual({ error: '格式：关键词1/关键词2 → agent' })
})

test('validateTtl and the settings key write', () => {
  expect(validateTtl(' 1h ')).toBe('1h')
  expect(validateTtl('30m')).toBe(undefined)
  const text = '{\n  "a": 1,\n  "b": {\n    "c": [\n      1\n    ]\n  }\n}\n'
  expect(readJsonKey(text, 'subagentPromptCacheTtl')).toBe('')
  const out = withJsonKey(text, 'subagentPromptCacheTtl', '5m')
  expect(out).toEqual({ text: '{\n  "a": 1,\n  "b": {\n    "c": [\n      1\n    ]\n  },\n  "subagentPromptCacheTtl": "5m"\n}\n' })
  expect(readJsonKey('text' in out ? out.text : '', 'subagentPromptCacheTtl')).toBe('5m')
  expect('error' in withJsonKey('not json', 'k', 'v')).toBe(true)
  expect('error' in withJsonKey('[1]', 'k', 'v')).toBe(true)
})

test('cloneSpec copies frontmatter and body, overrides effort', () => {
  const file = '---\nname: worker-hard\ndescription: "Hard ones."\nmodel: opus\neffort: high\ntools: Read, Bash\npermissionMode: plan\nskills: [loki-pm:diagnosing-bugs]\n---\nDo the work.\n'
  expect(cloneSpec('worker-hard', file, 'low')).toEqual({
    name: 'worker-hard-low',
    description: 'Hard ones.',
    prompt: 'Do the work.',
    effort: 'low',
    model: 'opus',
    tools: ['Read', 'Bash'],
    permissionMode: 'plan',
    skills: ['loki-pm:diagnosing-bugs'],
  })
  expect(cloneSpec('x', 'no frontmatter', 'low')).toBe(undefined)
})

test('quickSpec follows the settings', () => {
  const spec = quickSpec({ ...DEFAULT_CONFIG, quick: { model: 'haiku', effort: 'medium' } })
  expect([spec.name, spec.model, spec.effort, spec.tools]).toEqual(['quick', 'haiku', 'medium', undefined])
  expect(quickSpec(DEFAULT_CONFIG, 'high').name).toBe('quick-high')
})

test('applyRuleDraft: an edit replaces its rule in place, a new one appends; validated as a typed rule', () => {
  const rules = [
    { keywords: ['a'], agent: 'ui' },
    { keywords: ['b'], agent: 'worker' },
  ]
  const names = ['ui', 'worker']
  expect(applyRuleDraft(rules, { keywords: 'x/y', agent: 'ui', index: 1 }, names)).toEqual({ rules: [rules[0], { keywords: ['x', 'y'], agent: 'ui' }] })
  expect(applyRuleDraft(rules, { keywords: 'c', agent: 'worker' }, names)).toEqual({ rules: [...rules, { keywords: ['c'], agent: 'worker' }] })
  expect(applyRuleDraft(rules, { keywords: ' / ', agent: 'ui', index: 0 }, names)).toEqual({ error: '至少要一个关键词' })
  expect(applyRuleDraft(rules, { keywords: 'c', agent: '' }, names)).toEqual({ error: '先选一个派发代理' })
  expect(applyRuleDraft(rules, { keywords: 'c', agent: 'nobody' }, names)).toEqual({ error: '没有代理叫「nobody」' })
})

test('isOwnProvider: the plain name and inline-load forms, nothing else', () => {
  expect(['s-dispatch', 's-dispatch@inline', 's-dispatch_inline-9dc6eb267b53', 's-dispatcher', 'other'].map(isOwnProvider)).toEqual([true, true, true, false, false])
})

test('agent form: filled from the settings; applyAgentForm writes only what changed, the alias checked', () => {
  const cfg = { ...DEFAULT_CONFIG, aliases: { ui: 'u', worker: 'w' }, prompts: { ui: 'p' } }
  const names = ['ui', 'worker']
  const form = agentForm(cfg, 'ui')
  expect(form).toEqual({ name: 'ui', visible: 'on', alias: 'u', extra: 'none', prompt: 'p' })
  expect(isFormChanged(cfg, form)).toBe(false)
  expect(applyAgentForm(cfg, form, names)).toEqual({ config: cfg })
  const edited = { ...form, alias: ' X ', extra: 'high', prompt: '', visible: 'off' as const }
  expect(isFormChanged(cfg, edited)).toBe(true)
  const out = applyAgentForm(cfg, edited, names)
  expect('config' in out && out.config).toEqual({ ...cfg, aliases: { ui: 'x', worker: 'w' }, extraEffort: { ui: 'high' }, prompts: {}, visibleAgents: { ui: false } })
  expect(applyAgentForm(cfg, { ...form, alias: 'w', extra: 'low' }, names)).toEqual({ error: '「w」已被 worker 占用，不能设置' })
})

test('routeEffort: a store without it reads low; only low/medium/high survive', () => {
  expect(normalizeConfig({}).routeEffort).toBe('low')
  expect(normalizeConfig({ routeEffort: 'medium' }).routeEffort).toBe('medium')
  expect(normalizeConfig({ routeEffort: 'max' }).routeEffort).toBe('low')
})

test('dispatchMode: main by default; only direct switches it', () => {
  expect(DEFAULT_CONFIG.dispatchMode).toBe('main')
  expect(normalizeConfig({}).dispatchMode).toBe('main')
  expect(normalizeConfig({ dispatchMode: 'direct' }).dispatchMode).toBe('direct')
  expect(normalizeConfig({ dispatchMode: 'spawn' }).dispatchMode).toBe('main')
})

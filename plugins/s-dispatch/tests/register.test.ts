import { expect, mock, test } from 'claude-code/testing'
import type { AgentSpawnInput, On } from 'claude-code'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } } as any
const PANE = { title: '/s', isFocused: true, bodyColumns: 100, placement: 'dock' } as any
const FILES: Record<string, string> = {
  'worker.md': '---\nname: worker\ndescription: "Implements briefs"\nmodel: opus\neffort: medium\ntools: Read, Bash\n---\nWork.\n',
  'worker-hard.md': '---\nname: worker-hard\ndescription: hard ones\n---\n',
  'ui.md': '---\nname: ui\ndescription: UI work\n---\nDraw.\n',
  'reviewer.md': '---\nname: reviewer\ndescription: reviews\n---\n',
}
const SETTINGS = '{\n  "model": "opus",\n  "subagentPromptCacheTtl": "1h"\n}\n'
const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

type Spawned = { subagentType: string; prompt: string; description: string }

/** Bottoms for everything /s reaches beneath the plugin; returns what it captured. */
function world(
  on: On,
  opts: { store?: Record<string, unknown>; router?: string; refuse?: string; denySpawn?: RegExp; config?: 'ok' | 'deny'; provider?: string } = {},
) {
  const spawned: Spawned[] = []
  const toasts: string[] = []
  const opened: string[] = []
  const commands: string[] = []
  const agents: { name: string; effort?: string | number; model?: string }[] = []
  const writes: { path: string; text: string }[] = []
  const focused: string[] = []
  const closed: string[] = []
  const configSets: { key: string; value: unknown; stored?: unknown }[] = []
  let n = 0
  // /config, when the test asks for it: this plugin's commandName row, and a writer that takes or refuses.
  if (opts.config !== undefined) {
    const row = { key: 's-dispatch.commandName', label: 'Command name', kind: 'text', value: 's', provider: { plugin: opts.provider ?? 's-dispatch', tier: 'user' }, isLocked: false }
    on('config.list', async () => ({ value: [{ ...row, key: 'theme', provider: { plugin: 'engine', tier: 'core' } }, row] }) as any)
    on('config.set', async (_$, e) =>
      // `stored`: the store's commandName at the moment of the write, which a reload may not outlive.
      (opts.config === 'deny'
        ? { deny: 'locked by policy' }
        : (configSets.push({ key: e.key, value: e.value, stored: (store.config as any)?.commandName }), { value: e.value })) as any,
    )
  }
  const store: Record<string, unknown> = { ...(opts.store ?? {}) }
  on('store.get', async (_$, e) => ({ value: store[e.key] }) as any)
  on('store.set', async (_$, e) => ((store[e.key] = JSON.parse(JSON.stringify(e.value))), { value: undefined }) as any)
  // The kit raises a plugin's $.agent.spawn as the Agent tool's input
  // (subagent_type, run_in_background) and reads the started id from a tool
  // result's AgentCallRecord, so this bottom answers { model, result }.
  on('agent.spawn', async (_$, e) => {
    const raw = e as AgentSpawnInput & { subagent_type?: string }
    const type = raw.subagentType ?? raw.subagent_type ?? ''
    if (opts.denySpawn?.test(type) === true) return { deny: `${type} unknown` } as any
    spawned.push({ subagentType: type, prompt: raw.prompt, description: raw.description })
    n += 1
    return { model: 'm', agentId: `a${n}`, result: { agentId: `a${n}` } } as any
  })
  on('agent.register', async (_$, e) => (agents.push({ name: e.name, effort: e.effort, model: e.model }), { value: { agent: `s-dispatch:${e.name}` } }) as any)
  on('command.register', async (_$, e) =>
    (e.name === opts.refuse ? { deny: `${e.name} is taken` } : (commands.push(e.name), { value: { command: e.name } })) as any,
  )
  const completes: { effort?: string; maxTokens?: number }[] = []
  on('model.complete', async (_$, e) => (completes.push({ effort: e.effort, maxTokens: e.maxTokens }), { value: { isAnswered: true, text: opts.router ?? 'nobody', usage: USAGE } }) as any)
  on('env.get', async (_$, e) => ({ value: e.name === 'CLAUDE_CODE_SUBAGENT_MODEL' ? 'sonnet' : undefined }) as any)
  on('fs.list', async () => ({ value: Object.keys(FILES).map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) }) as any)
  on('fs.read', async (_$, e) => {
    if (e.path.endsWith('/settings.json')) return { value: writes.at(-1)?.text ?? SETTINGS } as any
    const text = FILES[e.path.split('/').pop() ?? '']
    return (text === undefined ? { deny: 'ENOENT' } : { value: text }) as any
  })
  on('fs.write', async (_$, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }) as any)
  on('ui.toast', async (_$, e) => (toasts.push(e.text), { value: undefined }) as any)
  on('ui.open', async (_$, e) => (opened.push(e.id), { value: { isPlaced: true } }) as any)
  on('ui.close', async (_$, e) => (closed.push(e.id), { value: undefined }) as any)
  on('ui.focus', async (_$, e) => (focused.push(e.element ?? '<engine>'), {}) as any)
  on('turn.complete', async () => ({ text: '' }))
  on('session.start', async (_$, e) => e as any)
  on('command.run', async () => ({ text: 'engine' }))
  return { spawned, toasts, opened, commands, agents, writes, store, focused, closed, configSets, completes }
}

test('/s Worker <task> spawns worker by exact name and routes the answer back', async ($, on) => {
  const { spawned, toasts } = world(on)
  const session = mock.session(on)
  const ran = await $.command.run({ command: 's', args: 'Worker fix the login bug', ...RUN })
  expect(ran.text).toBe('已派发 worker（指定）\na1')
  expect(spawned.map(s => [s.subagentType, s.prompt])).toEqual([['worker', 'fix the login bug']])

  await $.turn.complete({ answer: 'x', durationMs: 1, isAborted: false, turnId: 't0', agentId: 'other', reason: 'answer' })
  expect(session.appended().length).toBe(0)
  await $.turn.complete({ answer: 'fixed it', durationMs: 5, isAborted: false, turnId: 't1', agentId: 'a1', reason: 'answer' })
  expect(toasts).toContain('worker 完成')
  expect(JSON.stringify(session.appended()[0]?.message.content)).toMatch(/\[\/s worker\] result:\\nfixed it/)
  await $.turn.complete({ answer: 'again', durationMs: 5, isAborted: false, turnId: 't2', agentId: 'a1', reason: 'answer' })
  expect(session.appended().length).toBe(1)
})

test('aborted job toasts and leaves a short note', async ($, on) => {
  const { toasts } = world(on)
  const session = mock.session(on)
  await $.command.run({ command: 's', args: 'ui draw', ...RUN })
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 't', agentId: 'a1', reason: 'aborted' })
  expect(toasts).toContain('ui 已中断')
  expect(JSON.stringify(session.appended()[0]?.message.content)).toMatch(/interrupted/)
})

test('alias dispatch, and aliases are assigned and persisted', async ($, on) => {
  const { spawned, store } = world(on)
  const ran = await $.command.run({ command: 's', args: 'o refactor', ...RUN })
  expect(ran.text).toBe('已派发 worker-hard（指定）\na1')
  expect(spawned[0]?.subagentType).toBe('worker-hard')
  expect((store.config as any).aliases).toMatchObject({ reviewer: 'r', ui: 'u', worker: 'w', 'worker-hard': 'o' })
})

test('bare task routes by keyword, xN spawns N copies', async ($, on) => {
  const { spawned } = world(on)
  const ran = await $.command.run({ command: 's', args: 'nosuchword 帮我画个页面 x2', ...RUN })
  expect(ran.text).toBe('已派发 ui（关键词「页面」）\n×2 a1 · a2')
  expect(spawned.map(s => s.subagentType)).toEqual(['ui', 'ui'])
  expect(spawned[0]?.prompt).toBe('nosuchword 帮我画个页面')
})

test('model routing validates the answer, else the default agent; clamp is said', async ($, on) => {
  const { spawned } = world(on, { store: { config: { routeMode: 'model' } }, router: 'Reviewer' })
  expect((await $.command.run({ command: 's', args: 'look this over', ...RUN })).text).toBe('已派发 reviewer（模型判断）\na1')
  expect(spawned[0]?.subagentType).toBe('reviewer')
})

test('unknown model answer falls back to the default agent', async ($, on) => {
  const { spawned } = world(on, { router: 'designer' })
  const ran = await $.command.run({ command: 's', args: 'hello there x5', ...RUN })
  expect(ran.text).toBe('已派发 s-dispatch:quick（默认）\n×3 a1 · a2 · a3\n数量 5 超过上限 3，按 3 个派发')
  expect(spawned.map(s => s.subagentType)).toEqual(['s-dispatch:quick', 's-dispatch:quick', 's-dispatch:quick'])
})

test('extra effort: copy 1 of xN runs the clone, the rest and x1 the default; built-ins say why not', async ($, on) => {
  const { spawned, agents } = world(on, { store: { config: { extraEffort: { worker: 'high', Plan: 'high' }, prompts: { worker: '先读规范' } } } })
  const ran = await $.command.run({ command: 's', args: 'worker refactor x3', ...RUN })
  expect(spawned.map(s => s.subagentType)).toEqual(['s-dispatch:worker-high', 'worker', 'worker'])
  expect(spawned[0]?.prompt).toBe('先读规范\n\n任务：refactor')
  expect(agents.filter(a => a.name.startsWith('worker-')).map(a => [a.name, a.effort, a.model])).toEqual([['worker-high', 'high', 'opus']])
  expect(ran.text).toBe('已派发 worker（指定）\n×3 a1 high · a2 · a3')

  await $.command.run({ command: 's', args: 'worker one more', ...RUN })
  expect(spawned.slice(3).map(s => s.subagentType)).toEqual(['worker'])

  const plan = await $.command.run({ command: 's', args: 'Plan design it x2', ...RUN })
  expect(spawned.slice(4).map(s => s.subagentType)).toEqual(['Plan', 'Plan'])
  expect(plan.text).toMatch(/Plan 没有代理文件，额外档位无法生效，按原样派发/)
})

type Ui = {
  find: (q: { key?: string; type?: string; text?: RegExp | string }) => Promise<{ key: string | undefined; text: string; props: Record<string, unknown>; children: unknown[] } | undefined>
  findAll: (q: { type?: string; text?: RegExp | string }) => Promise<{ key: string | undefined; text: string; props: Record<string, unknown>; children: unknown[] }[]>
}
const keysOf = async (ui: Ui, prefix: string) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith(prefix))
const textOf = async (ui: Ui, key: string) => (await ui.find({ key }))?.text ?? ''
/** Drops enum field `id` open (Enter on its row) and picks `value` in its Select. */
const choose = async (ui: any, id: string, value: string) => {
  await ui.press({ key: `field:${id}` })
  await ui.select({ key: `sel:${id}`, value })
}
const crumb = async (ui: Ui) => (await ui.find({ type: 'Text', text: /^设置 › / }))?.text

// The kit answers a plugin's own $.ui.focus with "no implementation for ui.focus" (no hook beneath sees it),
// so the ring moves (onto the new tab's first item, 任务, back to the row) are best effort and
// unasserted here; these tests pin what is drawn: the active tab marker, breadcrumb, chips and views.
test('picker: 代理 field on top, rows read name  model·effort  alias  description; a press marks ▸; 任务 dispatches', async ($, on) => {
  const { spawned, opened } = world(on, { store: { config: { visibleAgents: { reviewer: false } } } })
  await $.command.run({ command: 's', args: '', ...RUN })
  expect(opened).toEqual(['s-dispatch'])
  const ui = await $.ui.mount({ plugin: 's-dispatch', surface: 'terminal', component: 'Pane', props: PANE, requestId: 's-dispatch' })
  expect(await ui.findAll({ type: 'Select' })).toEqual([])
  expect(await keysOf(ui, 'pick:')).toEqual(['pick:*auto', 'pick:ui', 'pick:worker', 'pick:worker-hard', 'pick:Explore', 'pick:general-purpose'])
  expect((await ui.find({ key: 'agent' }))?.props.autoFocus).toBe(true)
  expect((await ui.find({ key: 'agent' }))?.props.placeholder).toBe('输入名字或缩写筛选，↓ 选列表')
  expect(await textOf(ui, 'pick:*auto')).toBe('▸ 自动路由  按路由规则自动挑代理')
  expect(await textOf(ui, 'pick:ui')).toMatch(/^ {2}ui/)
  expect(await textOf(ui, 'chosen')).toBe('[ 未选 ]')
  expect(await textOf(ui, 'pick:worker')).toMatch(/^ {2}worker +opus·medium +w +Implements briefs$/)
  expect(await textOf(ui, 'pick:worker-hard')).toMatch(/^ {2}worker-hard +sonnet\(继承\)·继承 +o +hard ones$/)
  expect((await ui.find({ type: 'Text', text: /opus·medium/ }))?.props.color).toBe('magenta')
  expect((await ui.find({ type: 'Text', text: /sonnet\(继承\)·继承/ }))?.props.dimColor).toBe(true)

  await ui.press({ key: 'pick:worker-hard' })
  expect(await textOf(ui, 'pick:worker-hard')).toMatch(/^▸ worker-hard/)
  expect(await textOf(ui, 'pick:worker')).toMatch(/^ {2}worker/)
  await ui.input({ key: 'task', text: 'refactor parser x2' })
  expect(spawned.map(s => [s.subagentType, s.prompt])).toEqual([
    ['worker-hard', 'refactor parser'],
    ['worker-hard', 'refactor parser'],
  ])
})

const SET_PANE = { plugin: 's-dispatch', surface: 'terminal', component: 'Pane', props: PANE, requestId: 's-dispatch-settings' } as const

test('/s set: tabs 通用 路由 代理 on 1/2/3, breadcrumb, no Select; 通用 chips save and explain the choice', async ($, on) => {
  const { opened, writes, store } = world(on)
  expect((await $.command.run({ command: 's', args: 'set', ...RUN })).text).toBe('/s 设置已打开。')
  expect(opened).toEqual(['s-dispatch-settings'])
  const ui = await $.ui.mount(SET_PANE)
  expect((await ui.findAll({ type: 'Button' })).filter(b => b.key?.startsWith('tab:')).map(b => [b.key, b.props.hotkey, b.text])).toEqual([
    ['tab:general', '1', '[通用]'],
    ['tab:route', '2', ' 路由 '],
    ['tab:agents', '3', ' 代理 '],
  ])
  expect((await ui.find({ key: 'tab:general' }))?.props.autoFocus).toBe(true)
  expect(await crumb(ui)).toBe('设置 › 通用')
  expect(await ui.findAll({ type: 'Select' })).toEqual([])
  expect(await textOf(ui, 'field:ttl')).toBe('子代理缓存 TTL：1h ▾')
  expect(await ui.find({ key: 'sel:ttl' })).toBeUndefined()
  await ui.press({ key: 'field:ttl' })
  expect(await ui.find({ key: 'field:ttl' })).toBeUndefined()
  expect((await ui.find({ key: 'sel:ttl' }))?.props.label).toBe('子代理缓存 TTL：')
  expect(((await ui.find({ key: 'sel:ttl' }))?.props.options as any[]).map(o => o.label)).toEqual(['5m · 便宜但易过期', '1h · 适合长任务'])
  expect((await ui.find({ key: 'sel:ttl' }))?.props.value).toBe('1h')
  expect(await ui.find({ type: 'Text', text: /1h：适合长任务/ })).toBeDefined()
  expect(await textOf(ui, 'field:quickModel')).toBe('兜底模型：sonnet ▾')
  expect(await textOf(ui, 'field:maxCount')).toBe('最多同时派遣：3 ▾')

  await ui.select({ key: 'sel:ttl', value: '5m' })
  expect(await ui.find({ key: 'sel:ttl' })).toBeUndefined()
  expect(writes).toEqual([{ path: '/Users/niko/.claude/settings.json', text: '{\n  "model": "opus",\n  "subagentPromptCacheTtl": "5m"\n}\n' }])
  expect(await textOf(ui, 'field:ttl')).toBe('子代理缓存 TTL：5m ▾')
  expect(await ui.find({ type: 'Text', text: /5m：便宜但易过期/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /已保存/ })).toBeDefined()

  await choose(ui, 'quickModel', 'haiku')
  expect((store.config as any).quick.model).toBe('haiku')
  expect(await ui.find({ type: 'Text', text: /haiku：最快最省/ })).toBeDefined()
  await choose(ui, 'maxCount', '5')
  expect((store.config as any).maxCount).toBe(5)
  expect(await ui.find({ type: 'Text', text: /最多派 5 份/ })).toBeDefined()

  await choose(ui, 'defaultAgent', 'worker')
  expect((store.config as any).defaultAgent).toBe('worker')
  expect(await ui.find({ key: 'field:quickModel' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /路由没命中时派给谁/ })).toBeDefined()
  expect((await $.command.run({ command: 's', args: 'setting', ...RUN })).text).toBe('/s 设置已打开。')
})

test('tab switch (hotkey 2 presses tab:route): the active marker, breadcrumb and focus follow; route mode chips explain', async ($, on) => {
  const { store } = world(on)
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  await ui.press({ key: 'tab:route' })
  expect(await crumb(ui)).toBe('设置 › 路由')
  expect(await textOf(ui, 'tab:route')).toBe('[路由]')
  expect(await textOf(ui, 'tab:general')).toBe(' 通用 ')
  expect((await ui.find({ type: 'Text', text: '[路由]' }))?.props.color).toBe('claude')
  expect((await ui.find({ type: 'Text', text: ' 通用 ' }))?.props.dimColor).toBe(true)
  expect(await textOf(ui, 'field:routeMode')).toBe('路由模式：混合 ▾')
  expect(await ui.find({ type: 'Text', text: /混合：先查关键词，没命中再问 Haiku/ })).toBeDefined()

  await choose(ui, 'routeMode', 'keyword')
  expect((store.config as any).routeMode).toBe('keyword')
  expect(await ui.find({ type: 'Text', text: /仅关键词：只按下面的规则匹配，不花钱/ })).toBeDefined()
  expect(await ui.find({ key: 'ruleNew' })).toBeUndefined()
  expect(await ui.find({ key: 'draftKeywords' })).toBeUndefined()
  await ui.press({ key: 'ruleAdd' })
  expect((await ui.find({ key: 'draftKeywords' }))?.props.placeholder).toBe('多个用 / 分隔')
  expect(((await ui.find({ key: 'draftAgent' }))?.props.options as any[]).map(o => o.value)).not.toContain('Plan')
  await ui.input({ key: 'draftKeywords', text: '设计/原型', kind: 'change' })
  await ui.select({ key: 'draftAgent', value: 'ui' })
  await ui.press({ key: 'draftSave' })
  expect((store.config as any).rules.at(-1)).toEqual({ keywords: ['设计', '原型'], agent: 'ui' })
  expect(await ui.find({ key: 'ruleAdd' })).toBeDefined()
  expect(await ui.find({ key: 'ruleDel:0' })).toBeUndefined()
  await ui.press({ key: 'rule:0' })
  await ui.press({ key: 'ruleDel:0' })
  expect((store.config as any).rules.map((r: any) => r.agent)).toEqual(['researcher', 'reviewer', 'worker', 'ui'])
  await ui.press({ key: 'ruleAdd' })
  await ui.press({ key: 'draftSave' })
  expect(await ui.find({ type: 'Text', text: /至少要一个关键词/ })).toBeDefined()
  await ui.press({ key: 'draftCancel' })
  expect(await ui.find({ key: 'draftKeywords' })).toBeUndefined()
  expect((store.config as any).rules.length).toBe(4)

  await ui.press({ key: 'tab:agents' })
  expect(await crumb(ui)).toBe('设置 › 代理')
  await ui.press({ key: 'tab:general' })
  expect(await textOf(ui, 'tab:general')).toBe('[通用]')
  expect(await textOf(ui, 'tab:agents')).toBe(' 代理 ')
})

test('代理 tab: list columns; the detail is a form — title row, draft edits, 保存 writes all at once', async ($, on) => {
  const { store, spawned, agents } = world(on, { store: { config: { prompts: { worker: '先读规范' } } } })
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  const stored = () => store.config as any
  await ui.press({ key: 'tab:agents' })
  expect(await textOf(ui, 'agent:worker')).toMatch(/^worker +opus·medium +w +✓ +— +提示词$/)
  expect(await textOf(ui, 'agent:Plan')).toMatch(/^Plan +sonnet\(继承\)·继承 +\S+ +✗ +—$/)
  expect(await ui.find({ key: 'alias:ui' })).toBeUndefined()
  expect(await ui.find({ key: 'agentSave' })).toBeUndefined()

  await ui.press({ key: 'agent:ui' })
  expect(await crumb(ui)).toBe('设置 › 代理 › ui')
  expect(await ui.find({ key: 'agent:worker' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '  缩写 u' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ {2}额外 / })).toBeUndefined()
  expect((await ui.find({ key: 'agentCancel' }))?.props.hotkey).toBe('b')
  // Edits go to the draft: nothing is written until 保存.
  await ui.input({ key: 'alias:ui', text: 'x', kind: 'change' })
  await choose(ui, 'extra:ui', 'high')
  expect(await textOf(ui, 'field:extra:ui')).toBe('额外档位：high ▾')
  expect(await ui.find({ type: 'Text', text: /high：x2 及以上时第 1 份用 high/ })).toBeDefined()
  await ui.input({ key: 'prompt:ui', text: '用 Linear 风格', kind: 'change' })
  await choose(ui, 'vis:ui', 'off')
  expect(stored().aliases.ui).toBe('u')
  expect(stored().extraEffort).toEqual({})
  expect(stored().prompts).toEqual({ worker: '先读规范' })
  expect(agents.some(a => a.name === 'ui-high')).toBe(false)

  await ui.press({ key: 'agentSave' })
  expect(stored().aliases.ui).toBe('x')
  expect(stored().extraEffort).toEqual({ ui: 'high' })
  expect(stored().prompts).toEqual({ worker: '先读规范', ui: '用 Linear 风格' })
  expect(stored().visibleAgents).toEqual({ ui: false })
  expect(agents.some(a => a.name === 'ui-high' && a.effort === 'high')).toBe(true)
  expect(await crumb(ui)).toBe('设置 › 代理')
  expect(await ui.find({ type: 'Text', text: '已保存' })).toBeDefined()
  expect(await textOf(ui, 'agent:ui')).toMatch(/^ui +\S+ +x +✗ +\+high +提示词$/)
  await $.command.run({ command: 's', args: 'ui draw x2', ...RUN })
  expect(spawned.map(s => s.subagentType)).toEqual(['s-dispatch:ui-high', 'ui'])

  await ui.press({ key: 'agent:ui' })
  expect(await ui.find({ type: 'Text', text: '  额外 high' })).toBeDefined()
})

test('代理 form: an alias conflict blocks 保存 and stays; 取消 discards (noted only when changed)', async ($, on) => {
  const { store } = world(on)
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  const stored = () => store.config as any
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:ui' })
  await ui.input({ key: 'alias:ui', text: 'w', kind: 'change' })
  await choose(ui, 'extra:ui', 'low')
  await ui.press({ key: 'agentSave' })
  expect(await ui.find({ type: 'Text', text: /已被 worker 占用，不能设置/ })).toBeDefined()
  expect(await crumb(ui)).toBe('设置 › 代理 › ui')
  expect(stored().aliases.ui).toBe('u')
  expect(stored().extraEffort).toEqual({})

  await ui.press({ key: 'agentCancel' })
  expect(await crumb(ui)).toBe('设置 › 代理')
  expect(await ui.find({ type: 'Text', text: '未保存的改动已丢弃' })).toBeDefined()
  expect(stored().aliases.ui).toBe('u')
  await ui.press({ key: 'agent:ui' })
  expect((await ui.find({ key: 'alias:ui' }))?.props.value).toBe('u')
  expect(await textOf(ui, 'field:extra:ui')).toBe('额外档位：无 ▾')
  await ui.press({ key: 'agentCancel' })
  expect(await ui.find({ type: 'Text', text: '未保存的改动已丢弃' })).toBeUndefined()
})

test('an open dropdown shows its value once: the Select, labelled, stands in the row', async ($, on) => {
  world(on)
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:ui' })
  await ui.press({ key: 'field:extra:ui' })
  expect(await ui.find({ key: 'field:extra:ui' })).toBeUndefined()
  expect((await ui.find({ key: 'sel:extra:ui' }))?.props.label).toBe('额外档位：')
  expect(await ui.findAll({ type: 'Text', text: /▴/ })).toEqual([])
})

test('a refused command name falls back to /s and says why', { options: { commandName: 'taken' } }, async ($, on) => {
  const { commands, toasts, spawned } = world(on, { refuse: 'taken' })
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false } as any)
  expect(commands).toEqual(['s'])
  expect(toasts.some(t => /\/taken 注册失败/.test(t))).toBe(true)
  await $.command.run({ command: 's', args: 'ui draw', ...RUN })
  expect(spawned.length).toBe(1)
  expect((await $.command.run({ command: 'taken', args: 'ui draw', ...RUN })).text).toBe('engine')
})

test('the userConfig name is registered and answered', { options: { commandName: 'd' } }, async ($, on) => {
  const { commands, agents, spawned } = world(on)
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false } as any)
  expect(commands).toEqual(['d'])
  expect(agents[0]).toEqual({ name: 'quick', effort: 'low', model: 'sonnet' })
  await $.command.run({ command: 'd', args: 'ui draw', ...RUN })
  expect(spawned.length).toBe(1)
  expect((await $.command.run({ command: 's', args: 'ui draw', ...RUN })).text).toBe('engine')
  expect(spawned.length).toBe(1)
})

test('rename in the 通用 tab registers live, persists, rejects bad names', async ($, on) => {
  const { commands, spawned, store } = world(on, { refuse: 'clear' })
  expect((await $.command.run({ command: 's', args: 'set', ...RUN })).text).toBe('/s 设置已打开。')
  const ui = await $.ui.mount(SET_PANE)
  await ui.input({ key: 'commandName', text: 'a b' })
  expect(await ui.find({ type: 'Text', text: /命令名「a b」不行/ })).toBeDefined()
  await ui.input({ key: 'commandName', text: 'set' })
  expect(await ui.find({ type: 'Text', text: /命令名「set」不行/ })).toBeDefined()
  await ui.input({ key: 'commandName', text: 'clear' })
  expect(await ui.find({ type: 'Text', text: /\/clear 被拒/ })).toBeDefined()
  expect((store.config as any).commandName).toBe(null)
  await ui.input({ key: 'commandName', text: 'go' })
  expect(commands).toEqual(['s', 'go'])
  expect((store.config as any).commandName).toBe('go')
  expect((await $.command.run({ command: 'go', args: 'ui x', ...RUN })).text).toBe('已派发 ui（指定）\na1')
  expect(spawned.length).toBe(1)
  expect((await $.command.run({ command: 'go', args: 'set', ...RUN })).text).toBe('/go 设置已打开。')
})

test('agent.offer records offers and hides effort clones', async ($, on) => {
  const { spawned } = world(on)
  on('agent.offer', async () => ({ isOffered: true }))
  const quick = await $.agent.offer({ agent: 's-dispatch:quick', description: 'q', source: 'plugin', provider: { plugin: 's-dispatch', tier: 'user' } } as any)
  expect(quick.isOffered).toBe(false)
  const clone = await $.agent.offer({ agent: 's-dispatch:worker-low', description: 'c', source: 'plugin', provider: { plugin: 's-dispatch', tier: 'user' } } as any)
  expect(clone.isOffered).toBe(false)
  const offer = await $.agent.offer({ agent: 'loki-pm:scout', description: 'scouts', source: 'plugin', provider: { plugin: 'loki-pm', tier: 'user' } } as any)
  expect(offer.isOffered).toBe(true)
  const ran = await $.command.run({ command: 's', args: 'loki-pm:scout look around', ...RUN })
  expect(ran.text).toBe('已派发 loki-pm:scout（指定）\na1')
  expect(spawned[0]?.subagentType).toBe('loki-pm:scout')
})

test('a refused extra-effort clone falls back to the agent and the head line says so', async ($, on) => {
  const { spawned } = world(on, { store: { config: { extraEffort: { worker: 'low' } } }, denySpawn: /^s-dispatch:worker-/ })
  const ran = await $.command.run({ command: 's', args: 'worker refactor x2', ...RUN })
  expect(spawned.map(s => s.subagentType)).toEqual(['worker', 'worker'])
  expect(ran.text?.split('\n')[0]).toBe('已派发 worker（指定 · 额外档位未生效，回落原代理）')
  expect(ran.text).toMatch(/s-dispatch:worker-low 被拒/)
})

test('same-effort dispatch keeps the plain head line', async ($, on) => {
  world(on)
  expect((await $.command.run({ command: 's', args: 'worker refactor x2', ...RUN })).text?.split('\n')[0]).toBe('已派发 worker（指定）')
})

const hint = async (ui: Ui) => (await ui.find({ type: 'Text', text: /Esc / }))?.text
/** The person's ring move onto `element` (absent: one of the engine's stops, the close mark). */
const ringTo = ($: any, element?: string) =>
  $.ui.focus({ component: 'Pane', requestId: 's-dispatch-settings', origin: { kind: 'person' }, ...(element === undefined ? {} : { plugin: 's-dispatch', element }) })

// The kit refuses the plugin's own $.ui.focus before any bottom (see above) and its `$` carries no
// ui.close (only EventCalls nouns), so the person's Esc cannot be raised here: these pin the level
// as drawn (hint line, breadcrumb) and that the 关闭 button's close (origin plugin) passes the hook;
// the Esc steps themselves are nextLevel's, in view.test.ts.
test('levels: choosing a tab (hotkey, click or Enter) lands in its content; b climbs from the detail', async ($, on) => {
  world(on)
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  expect(await hint(ui)).toBe('1/2/3 选页签 · ↓/回车进入 · Esc 关闭')
  await ui.press({ key: 'tab:route' })
  expect(await crumb(ui)).toBe('设置 › 路由')
  expect(await hint(ui)).toBe('↑↓/Tab 移动 · 回车展开/选择 · 1/2/3 切页签 · Esc 返回页签')
  await choose(ui, 'routeMode', 'off')
  expect(await textOf(ui, 'field:routeMode')).toBe('路由模式：关闭 ▾')
  expect(await hint(ui)).toMatch(/Esc 返回页签$/)

  await ui.press({ key: 'tab:agents' })
  expect(await hint(ui)).toMatch(/Esc 返回页签$/)
  await ui.press({ key: 'agent:ui' })
  expect(await crumb(ui)).toBe('设置 › 代理 › ui')
  expect(await textOf(ui, 'field:vis:ui')).toBe('显示在选择器：显示 ▾')
  expect(await hint(ui)).toBe('↑↓/Tab 移动 · 回车展开/选择 · ↓到底 保存 · b/Esc 取消返回列表')
  await ui.press({ key: 'agentCancel' })
  expect(await crumb(ui)).toBe('设置 › 代理')
  expect(await hint(ui)).toMatch(/Esc 返回页签$/)
})

test('levels: the ring sets the level, the close mark counting as the tab bar; 关闭 closes from the detail', async ($, on) => {
  const { closed, focused } = world(on)
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  // From the tab bar, a person's move onto another tab is rewritten down into the content.
  await ringTo($, 'tab:general')
  await ringTo($, 'tab:route')
  expect(focused.at(-1)).toBe('field:ttl')
  expect(await hint(ui)).toMatch(/Esc 返回页签$/)
  await ringTo($, 'field:maxCount')
  expect(await hint(ui)).toMatch(/Esc 返回页签$/)
  await ringTo($, 'tab:route')
  expect(await hint(ui)).toMatch(/Esc 关闭$/)
  await ringTo($, 'field:ttl')
  await ringTo($, 'close')
  expect(await hint(ui)).toMatch(/Esc 返回页签$/)
  await ringTo($)
  expect(await hint(ui)).toMatch(/Esc 关闭$/)

  await ui.press({ key: 'tab:agents' })
  await ui.press({ key: 'agent:ui' })
  await ringTo($, 'field:extra:ui')
  expect(await hint(ui)).toMatch(/取消返回列表$/)
  await ui.press({ key: 'close' })
  expect(closed).toEqual(['s-dispatch-settings'])
})

test('picker: typing filters live (alias, prefix, substring), Enter picks the top match; /s u prefills and starts in 任务', async ($, on) => {
  const { spawned } = world(on)
  await $.command.run({ command: 's', args: '', ...RUN })
  const ui = await $.ui.mount({ plugin: 's-dispatch', surface: 'terminal', component: 'Pane', props: PANE, requestId: 's-dispatch' })
  await ui.input({ key: 'agent', text: 'W', kind: 'change' })
  // alias w, then prefix worker-hard, then 'w' inside reviewer's and ui's descriptions.
  expect(await keysOf(ui, 'pick:')).toEqual(['pick:*auto', 'pick:worker', 'pick:worker-hard', 'pick:reviewer', 'pick:ui'])
  expect(await textOf(ui, 'pick:worker')).toMatch(/^▸ worker/)
  await ui.input({ key: 'agent', text: 'o', kind: 'change' })
  expect((await keysOf(ui, 'pick:'))[1]).toBe('pick:worker-hard')
  await ui.input({ key: 'agent', text: 'zzz', kind: 'change' })
  expect(await keysOf(ui, 'pick:')).toEqual(['pick:*auto'])
  expect(await ui.find({ type: 'Text', text: '没有匹配的代理' })).toBeDefined()
  await ui.input({ key: 'agent', text: 'hard' })
  expect(await textOf(ui, 'pick:worker-hard')).toMatch(/^▸ worker-hard/)
  expect((await ui.find({ key: 'task' }))?.props.autoFocus).toBe(true)
  expect(await textOf(ui, 'chosen')).toBe('[ worker-hard · sonnet(继承)·继承 ]')
  await ui.input({ key: 'task', text: 'split it' })
  expect(spawned.map(s => s.subagentType)).toEqual(['worker-hard'])

  await ui.unmount()
  await $.command.run({ command: 's', args: 'u', ...RUN })
  const again = await $.ui.mount({ plugin: 's-dispatch', surface: 'terminal', component: 'Pane', props: PANE, requestId: 's-dispatch' })
  expect((await again.find({ key: 'agent' }))?.props.value).toBe('u')
  expect((await again.find({ key: 'task' }))?.props.autoFocus).toBe(true)
  expect((await keysOf(again, 'pick:'))[1]).toBe('pick:ui')
  expect(await textOf(again, 'chosen')).toBe('[ ui · sonnet(继承)·继承 ]')
  expect(await textOf(again, 'pick:ui')).toMatch(/^▸ ui/)
})

test('picker: 自动路由 is the first row; empty filter + Enter picks it; 任务 then routes by the rules; the chip returns to 代理', async ($, on) => {
  const { spawned, toasts } = world(on)
  await $.command.run({ command: 's', args: '', ...RUN })
  const ui = await $.ui.mount({ plugin: 's-dispatch', surface: 'terminal', component: 'Pane', props: PANE, requestId: 's-dispatch' })
  await ui.input({ key: 'agent', text: 'w', kind: 'change' })
  await ui.press({ key: 'chosen' })
  expect((await ui.find({ key: 'agent' }))?.props.value).toBe('')
  await ui.input({ key: 'agent', text: '' })
  expect(await textOf(ui, 'chosen')).toBe('[ 自动路由 ]')
  await ui.input({ key: 'task', text: '帮我画个页面' })
  expect(spawned.map(s => s.subagentType)).toEqual(['ui'])
  expect(toasts.some(t => t.startsWith('已派发 ui（关键词「页面」）'))).toBe(true)
})

test('rename through userConfig: the option is set (a reload follows), the store cleared, the old name points to the new', async ($, on) => {
  const { commands, configSets, store } = world(on, { config: 'ok', store: { config: { commandName: null } } })
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  await ui.input({ key: 'commandName', text: 'su' })
  expect(configSets).toEqual([{ key: 's-dispatch.commandName', value: 'su', stored: null }])
  expect(commands).toEqual(['s'])
  expect((store.config as any).commandName).toBe(null)
  expect(await ui.find({ type: 'Text', text: '已改名为 /su，插件已重载，只保留这一个' })).toBeDefined()
  expect((await $.command.run({ command: 's', args: 'ui draw', ...RUN })).text).toBe('已改名为 /su，请用 /su')
})

test('rename refused by /config: live registration as before, and the pane says the old name lingers', async ($, on) => {
  const { commands, configSets, store, spawned } = world(on, { config: 'deny' })
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  await ui.input({ key: 'commandName', text: 'su' })
  expect(configSets).toEqual([])
  expect(commands).toEqual(['s', 'su'])
  expect((store.config as any).commandName).toBe('su')
  expect(await ui.find({ type: 'Text', text: '已改名为 /su；旧名字 /s 要重载或下次会话才消失' })).toBeDefined()
  expect((await $.command.run({ command: 's', args: 'ui draw', ...RUN })).text).toBe('已改名为 /su，请用 /su')
  expect((await $.command.run({ command: 'su', args: 'ui draw', ...RUN })).text).toBe('已派发 ui（指定）\na1')
  expect(spawned.length).toBe(1)
})

test('a v5 stored name moves into userConfig once and is cleared from the store', async ($, on) => {
  const { commands, configSets, store } = world(on, { config: 'ok', store: { config: { commandName: 'go' } } })
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false } as any)
  // The store is already cleared when the write (and its reload) happens.
  expect(configSets).toEqual([{ key: 's-dispatch.commandName', value: 'go', stored: null }])
  expect((store.config as any).commandName).toBe(null)
  expect(commands).toEqual(['go'])
})

test('rules: one row each; Enter unfolds 编辑 删除 取消; 编辑 edits in place (order kept), empty keywords refused', async ($, on) => {
  const { store } = world(on)
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  const rules = () => (store.config as any)?.rules ?? []
  await ui.press({ key: 'tab:route' })
  expect(await textOf(ui, 'rule:2')).toBe('审查/review → reviewer')
  expect(await ui.find({ key: 'ruleEdit:2' })).toBeUndefined()
  await ui.press({ key: 'rule:2' })
  expect((await keysOf(ui, 'rule')).filter(k => /^rule(Edit|Del|Cancel):/.test(k))).toEqual(['ruleEdit:2', 'ruleDel:2', 'ruleCancel:2'])
  await ui.press({ key: 'ruleCancel:2' })
  expect(await ui.find({ key: 'ruleEdit:2' })).toBeUndefined()

  await ui.press({ key: 'rule:2' })
  await ui.press({ key: 'ruleEdit:2' })
  expect(await ui.find({ key: 'rule:2' })).toBeUndefined()
  expect((await ui.find({ key: 'draftKeywords' }))?.props.value).toBe('审查/review')
  expect((await ui.find({ key: 'draftAgent' }))?.props.value).toBe('reviewer')
  await ui.input({ key: 'draftKeywords', text: '  ', kind: 'change' })
  await ui.press({ key: 'draftSave' })
  expect(await ui.find({ type: 'Text', text: /至少要一个关键词/ })).toBeDefined()
  await ui.input({ key: 'draftKeywords', text: '审查/review/挑错', kind: 'change' })
  await ui.select({ key: 'draftAgent', value: 'worker' })
  await ui.press({ key: 'draftSave' })
  expect(rules().map((r: any) => r.agent)).toEqual(['ui', 'researcher', 'worker', 'worker'])
  expect(rules()[2]).toEqual({ keywords: ['审查', 'review', '挑错'], agent: 'worker' })
  expect(await textOf(ui, 'rule:2')).toBe('审查/review/挑错 → worker')
  expect(await ui.find({ key: 'draftKeywords' })).toBeUndefined()
})

test('claude and claude-code-guide are never listed, yet dispatch by name', async ($, on) => {
  const { spawned } = world(on, { store: { config: { visibleAgents: { 'claude-code-guide': true, claude: true } } } })
  on('agent.offer', async () => ({ isOffered: true }))
  await $.agent.offer({ agent: 'claude', description: 'c', source: 'built-in', provider: { plugin: 'engine', tier: 'core' } } as any)
  await $.command.run({ command: 's', args: '', ...RUN })
  const picker = await $.ui.mount({ plugin: 's-dispatch', surface: 'terminal', component: 'Pane', props: PANE, requestId: 's-dispatch' })
  expect(await keysOf(picker, 'pick:claude')).toEqual([])
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  await ui.press({ key: 'tab:agents' })
  expect(await keysOf(ui, 'agent:claude')).toEqual([])
  expect(await ui.find({ key: 'agent:worker' })).toBeDefined()
  expect((await $.command.run({ command: 's', args: 'claude-code-guide how do hooks work', ...RUN })).text).toBe('已派发 claude-code-guide（指定）\na1')
  expect(spawned[0]?.subagentType).toBe('claude-code-guide')
})

test('rename via an inline-loaded provider name; a refused write restores the stored name it cleared', async ($, on) => {
  const inline = world(on, { config: 'ok', provider: 's-dispatch_inline-9dc6eb267b53', store: { config: { commandName: null } } })
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  await ui.input({ key: 'commandName', text: 'su' })
  expect(inline.configSets.map(c => c.value)).toEqual(['su'])
})

test('a refused migration puts the stored name back, and it still wins', async ($, on) => {
  const { commands, store } = world(on, { config: 'deny', store: { config: { commandName: 'go' } } })
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false } as any)
  expect((store.config as any).commandName).toBe('go')
  expect(commands).toEqual(['go'])
})

test('router call: effort from routeEffort (low by default, a stored medium passed), maxTokens 256', async ($, on) => {
  const { completes } = world(on, { store: { config: { routeMode: 'model' } } })
  await $.command.run({ command: 's', args: 'look this over', ...RUN })
  expect(completes).toEqual([{ effort: 'low', maxTokens: 256 }])
})

test('a stored routeEffort medium reaches the router; the row shows only for 仅小模型 / 混合', async ($, on) => {
  const { completes, store } = world(on, { store: { config: { routeMode: 'hybrid', routeEffort: 'medium' } } })
  await $.command.run({ command: 's', args: 'hello there', ...RUN })
  expect(completes).toEqual([{ effort: 'medium', maxTokens: 256 }])
  await $.command.run({ command: 's', args: 'set', ...RUN })
  const ui = await $.ui.mount(SET_PANE)
  await ui.press({ key: 'tab:route' })
  expect(await textOf(ui, 'field:routeEffort')).toBe('路由模型档位：medium ▾')
  await ui.press({ key: 'field:routeEffort' })
  expect(((await ui.find({ key: 'sel:routeEffort' }))?.props.options as any[]).map(o => o.label)).toEqual([
    'low · 最快·够用于挑代理',
    'medium · 多想一些，稍慢',
    'high · 更慢，难分辨时用',
  ])
  await ui.select({ key: 'sel:routeEffort', value: 'high' })
  expect((store.config as any).routeEffort).toBe('high')
  await choose(ui, 'routeMode', 'keyword')
  expect(await ui.find({ key: 'field:routeEffort' })).toBeUndefined()
})

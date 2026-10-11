// /s: dispatch any subagent in the background, route a bare task, pick from a
// pane, and edit the settings (/s set). Every function taking `$` lives in this
// file (the engine follows `$` only into functions declared here); as are the
// state atoms and pane ids the scan reads; pure rules are in hooks/logic.ts and hooks/config.ts, drawing data in hooks/view.ts.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, RenderElement, RenderInput, Register } from 'claude-code'

import type { SDispatchAgent, SDispatchAgentForm, SDispatchConfig, SDispatchJob, SDispatchRuleDraft } from '../types'
import {
  DEFAULT_CONFIG,
  agentForm as formOf,
  applyAgentForm,
  applyRuleDraft,
  assignAliases,
  cloneSpec,
  commandNameOf,
  isFormChanged,
  isOwnProvider,
  isValidCommandName,
  isVisible,
  normalizeConfig,
  quickSpec,
  readJsonKey,
  validateTtl,
  withJsonKey,
} from './config'
import type { CloneSpec } from './config'
import {
  BUILT_INS,
  agentFromAnswer,
  cellWidth,
  composePrompt,
  defaultsParts,
  effortsFor,
  frontmatterField,
  isClone,
  isListed,
  keywordRoute,
  mergeRoster,
  padCells,
  parseCount,
  planCommand,
  routeLabel,
  routePrompt,
  settleJob,
  shorten,
  spawnArgs,
  withOffered,
} from './logic'
import type { Route } from './logic'
import { ACCENT, AUTO, TABS, activeTab, breadcrumb, chipHint, chipOptions, draftHome, filterAgents, firstFieldKey, levelHint, modelColor, nextLevel, optionLabel, pickerRows, renameNote, ringTarget, topChoice } from './view'
import type { ChipField, Level } from './view'
const PICKER = 's-dispatch'
const SETTINGS = 's-dispatch-settings'
const AGENTS_DIR = '/Users/niko/.claude/agents'
const SETTINGS_FILE = '/Users/niko/.claude/settings.json'
const TTL_KEY = 'subagentPromptCacheTtl'
const QUICK = 's-dispatch:quick'
const QUICK_ENTRY: SDispatchAgent = { name: QUICK, description: 'Quick general helper dispatched by /s' }

const offered = atom({ plugin: 's-dispatch', key: 'offered' } as const, [] as SDispatchAgent[])
const roster = atom({ plugin: 's-dispatch', key: 'roster' } as const, [] as SDispatchAgent[])
const picked = atom({ plugin: 's-dispatch', key: 'picked' } as const, '')
const note = atom({ plugin: 's-dispatch', key: 'note' } as const, '')
const jobs = atom({ plugin: 's-dispatch', key: 'jobs' } as const, {} as Record<string, SDispatchJob>)
const config = atom({ plugin: 's-dispatch', key: 'config' } as const, DEFAULT_CONFIG)
const tab = atom({ plugin: 's-dispatch', key: 'tab' } as const, 'general')
const settingsNote = atom({ plugin: 's-dispatch', key: 'settingsNote' } as const, '')
const ttl = atom({ plugin: 's-dispatch', key: 'ttl' } as const, '')
const expanded = atom({ plugin: 's-dispatch', key: 'expanded' } as const, '')
const fallbackModel = atom({ plugin: 's-dispatch', key: 'fallbackModel' } as const, '')
const commandName = atom({ plugin: 's-dispatch', key: 'commandName' } as const, 's')
const level = atom({ plugin: 's-dispatch', key: 'level' } as const, 0 as Level)
const ring = atom({ plugin: 's-dispatch', key: 'ring' } as const, '')
const query = atom({ plugin: 's-dispatch', key: 'query' } as const, '')
const pickerRing = atom({ plugin: 's-dispatch', key: 'pickerRing' } as const, '')
const agentForm = atom({ plugin: 's-dispatch', key: 'agentForm' } as const, null as SDispatchAgentForm | null)
const dropdown = atom({ plugin: 's-dispatch', key: 'dropdown' } as const, '')
const draft = atom({ plugin: 's-dispatch', key: 'draft' } as const, null as SDispatchRuleDraft | null)

// Module variables on purpose: they start over on each load, as the engine's registrations do.
const load = {
  isRegistered: false,
  /** Registration tries this load; capped so a refusing engine costs each prompt nothing. */
  attempts: 0,
  options: {} as PluginOptions,
}
/** Names this load may answer: the userConfig name and the 's' fallback, plus a live rename. */
const candidates = new Set<string>()
/** Names the engine accepted this load; the command.run hook answers only these. */
const answered = new Set<string>()
/** Names retired by a rename this load, old -> new: they answer with a pointer to the new name. */
const retired = new Map<string, string>()
/** Agent specs registered this load, by name, so an unchanged clone is not registered again. */
const registeredSpecs = new Map<string, string>()

/** The settings from $.store, mirrored into state for drawing. */
async function loadConfig($: EngineInterface): Promise<SDispatchConfig> {
  const loaded = normalizeConfig(await $.store.get('config').catch(() => undefined))
  await update($, config, () => loaded)
  return loaded
}

/** Applies `change` to the settings, persists them and mirrors them into state. */
async function saveConfig($: EngineInterface, change: (c: SDispatchConfig) => SDispatchConfig): Promise<SDispatchConfig> {
  const next = change(normalizeConfig(await $.store.get('config').catch(() => undefined)))
  await $.store.set('config', next)
  await update($, config, () => next)
  return next
}

/** Registers `/name` and starts answering it; the engine's refusal comes back as `error`. */
async function tryRegister($: EngineInterface, name: string): Promise<{ name: string } | { error: string }> {
  try {
    const done = await $.command.register({
      name,
      description: `后台派发子代理：/${name} [agent] <task> [xN] · /${name} set`,
      argumentHint: '[agent|set] <task> [xN]',
    })
    candidates.add(done.command)
    answered.add(done.command)
    await update($, commandName, () => done.command)
    return { name: done.command }
  } catch (error) {
    return { error: String(error) }
  }
}

/** Registers one agent spec; false when the engine refuses it. */
async function registerAgent($: EngineInterface, spec: CloneSpec): Promise<boolean> {
  const key = JSON.stringify(spec)
  if (registeredSpecs.get(spec.name) === key) return true
  try {
    await $.agent.register(spec)
    registeredSpecs.set(spec.name, key)
    return true
  } catch {
    return false
  }
}

/** The quick agent, plus the extra-effort clone of every agent that has one set. */
async function registerAgents($: EngineInterface, cfg: SDispatchConfig): Promise<void> {
  await registerAgent($, quickSpec(cfg))
  for (const [agent, effort] of Object.entries(cfg.extraEffort)) await effortVariant($, agent, effort, cfg)
}

/** Register the command and agents once per load. A mod hot-loaded mid-session misses session.start, so prompts register too. */
async function ensureCommand($: EngineInterface): Promise<void> {
  if (load.isRegistered || load.attempts >= 3) return
  load.isRegistered = true
  load.attempts += 1
  const cfg = await loadConfig($)
  const migrated = await migrateCommandName($, cfg)
  const wanted = migrated ?? commandNameOf(cfg, load.options.commandName)
  let got = await tryRegister($, wanted)
  if ('error' in got && wanted !== 's') {
    $.ui.toast(`/${wanted} 注册失败（${got.error}），改用 /s`)
    got = await tryRegister($, 's')
  }
  if ('error' in got) {
    load.isRegistered = false // a later event tries again
    return
  }
  await registerAgents($, cfg).catch(() => {}) // agents never block the command
  // A normal start is silent; only a failure or a fallback (above) toasts.
}

/** This plugin's `commandName` row in /config, by the key `$.config.list()` gives it; undefined when not listed. */
async function commandRow($: EngineInterface): Promise<string | undefined> {
  const rows = await $.config.list().catch(() => [])
  const row = rows.find(r => isOwnProvider(r.provider.plugin) && r.key.split('.').pop() === 'commandName')
  // The debug log names what matched (or what was there), so a live miss can be read off it.
  $.ui.log(
    row === undefined
      ? `s-dispatch: no commandName row among ${rows.filter(r => r.key.endsWith('.commandName')).map(r => `${r.provider.plugin}:${r.key}`).join(', ') || 'none'}`
      : `s-dispatch: commandName row ${row.key} (provider ${row.provider.plugin})`,
    { to: 'debug' },
  )
  return row?.key
}

/** Sets the userConfig command name (a change reloads the plugin); the deny or error as text, '' once written. */
async function setCommandOption($: EngineInterface, name: string): Promise<string> {
  const key = await commandRow($)
  if (key === undefined) return '找不到 commandName 配置项'
  const done = await $.config.set({ key, value: name }).catch(error => ({ deny: String(error) }))
  return done.deny ?? ''
}

/**
 * v5 kept a renamed command in the store; userConfig is the one source now. A stored name over a
 * default option moves there once (the reload that follows registers it) and the store is cleared.
 * Answers the name to register meanwhile; undefined to go on as configured.
 */
async function migrateCommandName($: EngineInterface, cfg: SDispatchConfig): Promise<string | undefined> {
  const stored = cfg.commandName
  if (stored === null) return undefined
  const option = commandNameOf({ ...cfg, commandName: null }, load.options.commandName)
  if (option !== stored && option !== 's') return undefined // a chosen option and a stored name: keep v5's order
  // Cleared before the write: the reload it triggers may cancel whatever follows it.
  await saveConfig($, c => ({ ...c, commandName: null }))
  if (option !== stored && (await setCommandOption($, stored)) !== '') {
    await saveConfig($, c => ({ ...c, commandName: stored })) // not moved: the store still wins
    return undefined
  }
  return stored
}

type AgentFile = { name: string; text: string }

/** The user's agent files, sorted by name (a stable order for alias assignment). */
async function agentFiles($: EngineInterface): Promise<AgentFile[]> {
  const entries = await $.fs.list(AGENTS_DIR).catch(() => [])
  const names = entries.filter(f => f.kind !== 'dir' && f.name.endsWith('.md')).map(f => f.name.slice(0, -3)).sort()
  return Promise.all(names.map(async name => ({ name, text: String(await $.fs.read(`${AGENTS_DIR}/${name}.md`).catch(() => '')) })))
}

/** The fallback subagent model, for the 继承 labels. */
async function refreshFallbackModel($: EngineInterface): Promise<void> {
  const value = await $.env.get('CLAUDE_CODE_SUBAGENT_MODEL').catch(() => undefined)
  await update($, fallbackModel, () => value ?? '')
}

/** Offered (engine truth) first, then files, quick, built-ins, each with its file's model/effort; assigns missing aliases. */
async function loadRoster($: EngineInterface, cfg: SDispatchConfig): Promise<{ agents: SDispatchAgent[]; cfg: SDispatchConfig }> {
  const files = (await agentFiles($)).map(f => {
    const entry: SDispatchAgent = { name: f.name, description: frontmatterField(f.text, 'description') }
    const model = frontmatterField(f.text, 'model')
    const effort = frontmatterField(f.text, 'effort')
    if (model !== '') entry.model = model
    if (effort !== '') entry.effort = effort
    return entry
  })
  const byName = new Map(files.map(f => [f.name, f]))
  const seen = await read($, offered)
  const merged = mergeRoster(seen, files, [QUICK_ENTRY], BUILT_INS).map(a => {
    const file = byName.get(a.name)
    return file === undefined ? a : { ...a, ...(file.model === undefined ? {} : { model: file.model }), ...(file.effort === undefined ? {} : { effort: file.effort }) }
  })
  await update($, roster, () => merged)
  const order = mergeRoster(files, seen, [QUICK_ENTRY], BUILT_INS).map(a => a.name)
  const aliases = assignAliases(order, cfg.aliases)
  if (aliases === cfg.aliases) return { agents: merged, cfg }
  return { agents: merged, cfg: await saveConfig($, c => ({ ...c, aliases: { ...aliases, ...c.aliases } })) }
}

/** keyword → model → default, as the route mode allows. */
async function route($: EngineInterface, task: string, cfg: SDispatchConfig, agents: SDispatchAgent[]): Promise<Route> {
  const known = (name: string) => agents.some(a => a.name === name)
  if (cfg.routeMode === 'keyword' || cfg.routeMode === 'hybrid') {
    const hit = keywordRoute(task, cfg.rules)
    if (hit !== undefined && known(hit.agent)) return hit
  }
  if (cfg.routeMode === 'model' || cfg.routeMode === 'hybrid') {
    const visible = agents.filter(a => isVisible(cfg, a.name))
    const answer = await $.model
      // 256: room for the effort's thinking, which a 64 cap could eat and silently fall to 默认.
      .complete({ model: 'haiku', prompt: routePrompt(task, visible), effort: cfg.routeEffort, maxTokens: 256, timeoutMs: 20000 })
      .catch(() => undefined)
    const agent = answer?.isAnswered === true ? agentFromAnswer(answer.text, visible) : undefined
    if (agent !== undefined) return { agent, via: 'model' }
  }
  return { agent: cfg.defaultAgent, via: 'default' }
}

/** The agent type to spawn for one copy at `effort`: a registered clone, or the agent itself with a note. */
async function effortVariant($: EngineInterface, agent: string, effort: string | undefined, cfg: SDispatchConfig): Promise<{ type: string; note: string }> {
  if (effort === undefined) return { type: agent, note: '' }
  if (agent === QUICK) {
    return (await registerAgent($, quickSpec(cfg, effort))) ? { type: `${QUICK}-${effort}`, note: '' } : { type: agent, note: `quick-${effort} 注册失败，按原档派发` }
  }
  const text = /^[A-Za-z0-9_-]+$/.test(agent) ? String(await $.fs.read(`${AGENTS_DIR}/${agent}.md`).catch(() => '')) : ''
  const spec = text === '' ? undefined : cloneSpec(agent, text, effort)
  if (spec === undefined) return { type: agent, note: `${agent} 没有代理文件，额外档位无法生效，按原样派发` }
  return (await registerAgent($, spec)) ? { type: `s-dispatch:${spec.name}`, note: '' } : { type: agent, note: `${spec.name} 注册失败，按原档派发` }
}

/** Spawns `count` copies in the background and remembers the jobs; answers the lines shown to the person. */
async function dispatch($: EngineInterface, agent: string, task: string, count: number, via: Route, extra: string): Promise<string> {
  const cfg = await read($, config)
  const prompt = composePrompt(cfg.prompts[agent], task)
  const started: string[] = []
  const notes = extra === '' ? [] : [extra]
  let effortLost = false
  for (const effort of effortsFor(count, cfg.extraEffort[agent])) {
    const variant = await effortVariant($, agent, effort, cfg)
    if (variant.note !== '' && !notes.includes(variant.note)) notes.push(variant.note)
    let spawnedType = variant.type
    let result = await $.agent.spawn(spawnArgs(spawnedType, task, prompt))
    if (result.deny !== undefined && spawnedType !== agent) {
      notes.push(`${spawnedType} 被拒（${result.deny}），改派 ${agent}`)
      spawnedType = agent
      result = await $.agent.spawn(spawnArgs(agent, task, prompt))
    }
    if (result.deny !== undefined) {
      notes.push(`被拒：${result.deny}`)
      continue
    }
    const agentId = result.agentId
    if (agentId === undefined) continue
    if (effort !== undefined && spawnedType === agent) effortLost = true // the copy runs at the agent's own effort
    const label = effort === undefined || spawnedType === agent ? agent : `${agent}·${effort}`
    started.push(effort === undefined ? agentId : `${agentId} ${effort}`)
    await update($, jobs, all => ({ ...all, [agentId]: { agent: label, task } }))
  }
  const how = effortLost ? `${routeLabel(via)} · 额外档位未生效，回落原代理` : routeLabel(via)
  const head = started.length === 0 ? `未能派发 ${agent}（${how}）` : `已派发 ${agent}（${how}）`
  const ids = started.length === 0 ? [] : [`${started.length > 1 ? `×${started.length} ` : ''}${started.join(' · ')}`]
  return [head, ...ids, ...notes].join('\n')
}

/**
 * `/<cmd> set`: refresh what the pane draws from, then open it with the keys (Esc closes; toasts still show).
 * No rows/columns, as agent-monitor: the surface seats it (docked right in fullscreen from 110 columns, else inline).
 */
async function openSettings($: EngineInterface, cmd: string): Promise<string> {
  const text = String(await $.fs.read(SETTINGS_FILE).catch(() => ''))
  await update($, ttl, () => readJsonKey(text, TTL_KEY))
  await update($, settingsNote, () => '')
  await update($, expanded, () => '')
  await update($, level, () => 0 as Level)
  await update($, ring, () => '')
  await foldPopups($)
  const opened = await $.ui.open({ id: SETTINGS, title: `/${cmd} set`, focus: true, closeOnEscape: true })
  return opened.isPlaced ? `/${cmd} 设置已打开。` : `/${cmd} 设置面板未显示：${opened.reason}`
}

/** Says so in the pane, where the person is looking. */
async function saved($: EngineInterface, text = '已保存'): Promise<void> {
  await update($, settingsNote, () => text)
}

/**
 * Rename from the pane. The userConfig option is the source: setting it reloads the plugin, whose
 * register then answers the new name alone. Refused (no row, a deny): v5's live registration plus a
 * stored name, the old name left until a reload. Either way the old name points to the new one meanwhile.
 */
async function renameCommand($: EngineInterface, text: string): Promise<void> {
  const wanted = text.trim()
  if (wanted !== '' && !isValidCommandName(wanted)) {
    await update($, settingsNote, () => `命令名「${wanted}」不行：只用字母、数字、_、-，且不能是 set/setting/settings`)
    return
  }
  const old = await read($, commandName)
  const target = wanted === '' ? 's' : wanted
  if (target === old) return saved($, `命令名仍是 /${old}`)
  // Note said and store cleared before the write: the reload it triggers may cancel what follows.
  const before = (await read($, config)).commandName
  await saved($, renameNote(old, target, true))
  await saveConfig($, c => ({ ...c, commandName: null }))
  retired.set(old, target)
  const refused = await setCommandOption($, target)
  if (refused === '') return
  retired.delete(old)
  await saveConfig($, c => ({ ...c, commandName: before }))
  const got = await tryRegister($, target)
  if ('error' in got) {
    await update($, settingsNote, () => `/${target} 被拒（${got.error}），未保存`)
    return
  }
  await saveConfig($, c => ({ ...c, commandName: wanted === '' ? null : wanted }))
  if (got.name !== old) retired.set(old, got.name)
  await saved($, renameNote(old, got.name, false))
}

/** Writes only subagentPromptCacheTtl into settings.json, and only when it parses. */
async function saveTtl($: EngineInterface, text: string): Promise<void> {
  const value = validateTtl(text)
  if (value === undefined) {
    await update($, settingsNote, () => '只接受 5m 或 1h')
    return
  }
  let current: string
  try {
    current = String(await $.fs.read(SETTINGS_FILE))
  } catch (error) {
    await update($, settingsNote, () => `读不到 settings.json（${String(error)}），未写入`)
    return
  }
  const next = withJsonKey(current, TTL_KEY, value)
  if ('error' in next) {
    await update($, settingsNote, () => next.error)
    return
  }
  await $.fs.write(SETTINGS_FILE, next.text)
  await update($, ttl, () => value)
  await saved($)
}

// --- The /s set pane: tabs 通用 · 路由 · 代理 (hotkeys 1/2/3; an Input with the
// focus takes every printable key, so typing digits never switches tabs). Small
// enums are rows `label：value ▾` whose Enter drops a Select open under them, with
// a dim line explaining the chosen value; the 代理 tab is a list whose row opens
// that agent's detail view. Keyword rules are rows with 删除, plus ＋ 添加规则.
//
// Keyboard levels (state `level`, rules in view.ts nextLevel): 0 the tab bar,
// 1 a tab's content, 2 an agent's detail. Esc climbs one level: the pane keeps
// `closeOnEscape`, and the ui.close hook below refuses the person's close while
// the level is above 0 (a hook answering without `next` keeps the pane open).

/** Moves pane `requestId`'s ring to `key`; best effort, the element may not be drawn yet. */
function focusIn($: EngineInterface, requestId: string, key: string): void {
  void $.ui.focus({ requestId, key }).catch(() => {})
}

/**
 * Back from 任务 to the picker's 代理 filter, its text cleared for a retype. After Esc (`retake`)
 * the pane reopens with `focus` first, since Esc handed the keys back to the prompt.
 */
async function backToFilter($: EngineInterface, retake = false): Promise<void> {
  await update($, pickerRing, () => 'agent')
  await update($, query, () => '')
  if (!retake) return focusIn($, PICKER, 'agent')
  const cmd = await read($, commandName)
  void $.ui
    .open({ id: PICKER, title: `/${cmd}`, focus: true, closeOnEscape: true })
    .catch(() => undefined)
    .then(() => focusIn($, PICKER, 'agent'))
}

/** Moves the settings ring to `key`; best effort, the element may not be drawn yet. */
function focusKey($: EngineInterface, key: string): void {
  void $.ui.focus({ requestId: SETTINGS, key })
    .then(r => (r.deny === undefined ? update($, ring, () => key) : undefined))
    .catch(() => {})
}

async function setLevel($: EngineInterface, next: Level): Promise<void> {
  await update($, level, () => next)
}

/** Closes an open dropdown and drops a new-rule draft. */
async function foldPopups($: EngineInterface): Promise<void> {
  await update($, dropdown, () => '')
  await update($, draft, () => null)
}

/** The first content element of the active tab. */
async function firstOfTab($: EngineInterface): Promise<string | undefined> {
  return firstFieldKey(await read($, tab), (await read($, roster))[0]?.name)
}

/** Shows tab `id` (1/2/3, click or Enter alike) and lands the ring on its first item, level 1. */
async function switchTab($: EngineInterface, id: string): Promise<void> {
  await update($, tab, () => id)
  await update($, expanded, () => '')
  await update($, settingsNote, () => '')
  await foldPopups($)
  const first = await firstOfTab($)
  await setLevel($, first === undefined ? 0 : (nextLevel(0, { kind: 'tab' }) as Level))
  focusKey($, first ?? `tab:${id}`)
}

/** Opens one agent's detail form in the 代理 tab (level 2), a draft of its saved settings, the ring on its first field. */
async function openAgent($: EngineInterface, name: string): Promise<void> {
  const cfg = await read($, config)
  await update($, agentForm, () => formOf(cfg, name))
  await update($, expanded, () => name)
  await update($, settingsNote, () => '')
  await foldPopups($)
  await setLevel($, 2)
  focusKey($, `field:vis:${name}`)
}

/** What leaving the form without saving says: a note only when the draft differed. */
async function discardNote($: EngineInterface): Promise<string> {
  const form = await read($, agentForm)
  return form !== null && isFormChanged(await read($, config), form) ? '未保存的改动已丢弃' : ''
}

/** Back from the detail form to the list (level 1), the draft dropped, the ring on the agent's row. */
async function closeAgent($: EngineInterface, text = ''): Promise<void> {
  const name = await read($, expanded)
  await update($, expanded, () => '')
  await update($, agentForm, () => null)
  await update($, settingsNote, () => text)
  await foldPopups($)
  await setLevel($, 1)
  if (name !== '') focusKey($, `agent:${name}`)
}

/**
 * Esc in the settings pane: one level up, true when it moved (the close is then refused);
 * false at the tab bar, where Esc closes. The pane retakes the keys first, since Esc hands
 * them back to the prompt before the close is raised.
 */
async function escapeUp($: EngineInterface): Promise<boolean> {
  const open = await read($, dropdown)
  const isDrafting = (await read($, draft)) !== null
  const now = await read($, level)
  const up = nextLevel(now, { kind: 'escape', hasPopup: open !== '' || isDrafting })
  if (up === 'close') return false
  const name = await read($, expanded)
  // Esc out of the detail form discards its draft, as 取消 does.
  const leaving = now === 2 && up === 1 ? await discardNote($) : ''
  if (now === 2 && up === 1) await update($, agentForm, () => null)
  // A popup folds back onto its row (the level kept); else one level up.
  const target =
    open !== '' ? (open.startsWith('rule:') ? open : `field:${open}`) : isDrafting ? draftHome(await read($, draft)) : up === 1 && name !== '' ? `agent:${name}` : `tab:${activeTab(await read($, tab))}`
  await foldPopups($)
  if (up !== now) await update($, expanded, () => '')
  await update($, settingsNote, () => leaving)
  await setLevel($, up)
  const cmd = await read($, commandName)
  // Not awaited: the close this answers is still in flight. Reopening an open id only
  // retitles it; `focus` is granted while the prompt holds the keys over an empty composer.
  void $.ui
    .open({ id: SETTINGS, title: `/${cmd} set`, focus: true, closeOnEscape: true })
    .catch(() => undefined)
    .then(() => focusKey($, target))
  return true
}

async function settingsTree($: EngineInterface, e: RenderInput<'Pane', 'terminal' | 'desktop' | 'vscode'>): Promise<RenderElement> {
  const { Box, Text, Input, Button, Select } = $.ui.resolve(e)
  const cmd = await read($, commandName)
  const cfg = await read($, config)
  const agents = await read($, roster)
  const active = activeTab(await read($, tab))
  const line = await read($, settingsNote)
  const fallback = await read($, fallbackModel)
  const shown = await read($, expanded)
  const where = await read($, level)
  const open = await read($, dropdown)
  const rule = await read($, draft)
  const names = agents.map(a => a.name)
  const say = (text: string) => void update($, settingsNote, () => text)
  const save = (change: (c: SDispatchConfig) => SDispatchConfig, after?: (c: SDispatchConfig) => Promise<void>) =>
    void saveConfig($, change)
      .then(async c => {
        if (after !== undefined) await after(c)
        await saved($)
      })
      .catch(error => say(`保存失败：${String(error)}`))
  const reRegister = (c: SDispatchConfig) => registerAgents($, c).catch(() => {})

  /**
   * A collapsed dropdown row: `title：value ▾` (`field:<id>`), Enter drops a Select (`sel:<id>`) open under it;
   * a pick saves, folds it and returns the ring to the row. A dim line explains the chosen value.
   */
  const dropRow = (id: string, title: string, options: { value: string; label: string }[], current: string | undefined, pick: (v: string) => void, hint: string) => {
    const shownValue = options.find(o => o.value === current)?.label.split(' · ')[0] ?? (current === undefined || current === '' ? '未设置' : current)
    // Open, the Select stands in the row's place: its own header shows the value, so it is drawn once.
    return (
      <Box key={`row:${id}`} flexDirection="column">
        {open !== id && (
          <Button key={`field:${id}`} plain onPress={() => void update($, dropdown, () => id).then(() => focusKey($, `sel:${id}`))}>
            <Text bold>{`${title}：`}</Text>
            <Text color={ACCENT}>{`${shownValue} ▾`}</Text>
          </Button>
        )}
        {open === id && (
          <Select
            key={`sel:${id}`}
            label={`${title}：`}
            options={options}
            {...(options.some(o => o.value === current) ? { value: current! } : {})}
            onSelect={v => {
              pick(v)
              void update($, dropdown, () => '').then(() => focusKey($, `field:${id}`))
            }}
          />
        )}
        <Text dimColor>{`  ${hint}`}</Text>
      </Box>
    )
  }
  const enumRow = (id: string, field: ChipField, title: string, current: string | undefined, pick: (v: string) => void) =>
    dropRow(id, title, chipOptions(field, current).map(c => ({ value: c.value, label: optionLabel(field, c) })), current, pick, chipHint(field, current))

  const tabs = (
    <Box flexDirection="row" columnGap={2}>
      {TABS.map(([id, label, hotkey]) => (
        <Button
          key={`tab:${id}`}
          plain
          hotkey={hotkey}
          {...(id === active && where === 0 ? { autoFocus: true as const } : {})}
          onPress={() => void switchTab($, id)}
        >
          {id === active ? <Text color={ACCENT} bold>{`[${label}]`}</Text> : <Text dimColor>{` ${label} `}</Text>}
        </Button>
      ))}
    </Box>
  )

  const isQuick = cfg.defaultAgent === QUICK
  const ttlNow = await read($, ttl)
  const generalTab = (
    <Box flexDirection="column">
      {enumRow('ttl', 'ttl', '子代理缓存 TTL', ttlNow, v => void saveTtl($, v))}
      {dropRow(
        'defaultAgent',
        '默认代理',
        (names.includes(cfg.defaultAgent) ? agents : [{ name: cfg.defaultAgent, description: '' }, ...agents]).map(a => ({
          value: a.name,
          label: a.description === '' ? a.name : `${a.name} · ${shorten(a.description, 30)}`,
        })),
        cfg.defaultAgent,
        v => save(c => ({ ...c, defaultAgent: v })),
        '路由没命中时派给谁',
      )}
      {isQuick && enumRow('quickModel', 'quickModel', '兜底模型', cfg.quick.model, v => save(c => ({ ...c, quick: { ...c.quick, model: v } }), reRegister))}
      {isQuick && enumRow('quickEffort', 'quickEffort', '兜底档位', cfg.quick.effort, v => save(c => ({ ...c, quick: { ...c.quick, effort: v } }), reRegister))}
      {enumRow('maxCount', 'maxCount', '最多同时派遣', String(cfg.maxCount), v => save(c => ({ ...c, maxCount: Number(v) })))}
      <Input key="commandName" label="命令名" value={cmd} submitLabel="保存" onSubmit={value => void renameCommand($, value)} />
      <Text dimColor>  改名写入插件配置并重载插件，只留新名字。留空恢复 /s。</Text>
    </Box>
  )

  const draftAgents = agents.filter(a => isVisible(cfg, a.name)).map(a => a.name)
  const editDraft = (part: Partial<SDispatchRuleDraft>) => update($, draft, d => (d === null ? d : { ...d, ...part }))
  /** Opens the rule editor: a new rule, or rule `index` prefilled (its row folded first). */
  const startDraft = async (from?: number) => {
    const r = from === undefined ? undefined : cfg.rules[from]
    await update($, dropdown, () => '')
    await update($, draft, () => (r === undefined ? { keywords: '', agent: draftAgents[0] ?? '' } : { keywords: r.keywords.join('/'), agent: r.agent, index: from }))
    focusKey($, 'draftKeywords')
  }
  const closeDraft = async () => {
    const home = draftHome(await read($, draft))
    await update($, draft, () => null)
    focusKey($, home)
  }
  /** Validated as a typed rule (applyRuleDraft): an edit replaces its rule in place, a new one is appended. */
  const saveDraft = async () => {
    const d = await read($, draft)
    if (d === null) return
    const next = applyRuleDraft(cfg.rules, d, names)
    if ('error' in next) return say(next.error)
    save(c => {
      const applied = applyRuleDraft(c.rules, d, names)
      return 'error' in applied ? c : { ...c, rules: applied.rules }
    })
    await closeDraft()
  }
  const toggleRule = (i: number) =>
    void update($, dropdown, o => (o === `rule:${i}` ? '' : `rule:${i}`)).then(o => focusKey($, o === '' ? `rule:${i}` : `ruleEdit:${i}`))
  const foldRule = (i: number) => void update($, dropdown, () => '').then(() => focusKey($, `rule:${i}`))
  const deleteRule = (i: number) =>
    void update($, dropdown, () => '').then(() => {
      save(c => ({ ...c, rules: c.rules.filter((_, j) => j !== i) }))
      focusKey($, cfg.rules.length > 1 ? `rule:${Math.min(i, cfg.rules.length - 2)}` : 'ruleAdd')
    })
  /** The editor shared by ＋ 添加规则 and 编辑: 关键词 Input, 派发代理 Select, 保存 / 取消. */
  const ruleEditor = (d: SDispatchRuleDraft) => {
    const choices = d.agent === '' || draftAgents.includes(d.agent) ? draftAgents : [d.agent, ...draftAgents]
    return (
      <Box key="draft" flexDirection="column">
        <Input
          key="draftKeywords"
          label="关键词"
          value={d.keywords}
          placeholder="多个用 / 分隔"
          submitLabel="下一步"
          onInput={value => void editDraft({ keywords: value })}
          onSubmit={value => void editDraft({ keywords: value }).then(() => focusKey($, 'draftAgent'))}
        />
        {choices.length === 0 ? (
          <Text dimColor>  没有可见的代理（代理页签里打开）。</Text>
        ) : (
          <Select
            key="draftAgent"
            label="派发代理"
            options={choices.map(n => ({ value: n, label: n }))}
            {...(choices.includes(d.agent) ? { value: d.agent } : {})}
            onSelect={value => void editDraft({ agent: value }).then(() => focusKey($, 'draftSave'))}
          />
        )}
        <Box flexDirection="row" gap={2}>
          <Button key="draftSave" variant="primary" label="保存" onPress={() => void saveDraft()} />
          <Button key="draftCancel" label="取消" onPress={() => void closeDraft()} />
        </Box>
      </Box>
    )
  }

  const routeTab = (
    <Box flexDirection="column">
      {enumRow('routeMode', 'routeMode', '路由模式', cfg.routeMode, v => save(c => ({ ...c, routeMode: v as SDispatchConfig['routeMode'] })))}
      {(cfg.routeMode === 'model' || cfg.routeMode === 'hybrid') &&
        enumRow('routeEffort', 'routeEffort', '路由模型档位', cfg.routeEffort, v => save(c => ({ ...c, routeEffort: v as SDispatchConfig['routeEffort'] })))}
      <Text bold>关键词规则</Text>
      {/* One focusable row per rule; Enter unfolds 编辑 · 删除 · 取消 under it, 编辑 swaps the row for the editor. */}
      {cfg.rules.map((r, i) =>
        rule !== null && rule.index === i ? (
          ruleEditor(rule)
        ) : (
          <Box key={`ruleRow:${i}`} flexDirection="column">
            <Button key={`rule:${i}`} plain onPress={() => toggleRule(i)}>
              <Text>{`${r.keywords.join('/')} → `}</Text>
              <Text color={ACCENT}>{r.agent}</Text>
            </Button>
            {open === `rule:${i}` && (
              <Box flexDirection="row" gap={2}>
                <Button key={`ruleEdit:${i}`} label="编辑" onPress={() => void startDraft(i)} />
                <Button key={`ruleDel:${i}`} label="删除" onPress={() => deleteRule(i)} />
                <Button key={`ruleCancel:${i}`} label="取消" onPress={() => foldRule(i)} />
              </Box>
            )}
          </Box>
        ),
      )}
      {rule === null || rule.index !== undefined ? (
        <Button key="ruleAdd" plain onPress={() => void startDraft()}>
          ＋ 添加规则
        </Button>
      ) : (
        ruleEditor(rule)
      )}
      <Text dimColor>  按顺序匹配，第一条命中的规则生效。</Text>
    </Box>
  )

  const nameWidth = Math.max(0, ...names.map(cellWidth))
  const labels = new Map(agents.map(a => [a.name, defaultsParts(a, cfg, fallback, QUICK)]))
  const defaultsWidth = Math.max(0, ...[...labels.values()].map(p => cellWidth(p.label)))
  const aliasWidth = Math.max(1, ...names.map(n => cellWidth(cfg.aliases[n] ?? '')))
  const extraCell = (n: string) => (cfg.extraEffort[n] === undefined ? '—' : `+${cfg.extraEffort[n]}`)
  const extraWidth = Math.max(1, ...names.filter(isListed).map(n => cellWidth(extraCell(n))))
  const agentList = (
    <Box flexDirection="column">
      {agents.filter(a => isListed(a.name)).map(a => {
        const parts = labels.get(a.name)!
        const color = modelColor(parts.model, parts.inherited)
        const extra = cfg.extraEffort[a.name]
        return (
          <Button key={`agent:${a.name}`} plain onPress={() => void openAgent($, a.name)}>
            <Text color={ACCENT} bold>{padCells(a.name, nameWidth)}</Text>
            {color === undefined ? <Text dimColor>{`  ${padCells(parts.label, defaultsWidth)}`}</Text> : <Text color={color}>{`  ${padCells(parts.label, defaultsWidth)}`}</Text>}
            <Text dimColor>{`  ${padCells(cfg.aliases[a.name] ?? '-', aliasWidth)}  `}</Text>
            {isVisible(cfg, a.name) ? <Text color="green">✓</Text> : <Text dimColor>✗</Text>}
            {extra === undefined ? <Text dimColor>{`  ${padCells(extraCell(a.name), extraWidth)}`}</Text> : <Text color="yellow">{`  ${padCells(extraCell(a.name), extraWidth)}`}</Text>}
            {(cfg.prompts[a.name] ?? '') !== '' && <Text dimColor>  提示词</Text>}
          </Button>
        )
      })}
      <Text dimColor>  ✓ 在选择器里显示 · +档位 额外档位 · 提示词 有附加提示词 · 回车打开详情。缩写直接用：/{cmd} &lt;缩写&gt; &lt;任务&gt;</Text>
    </Box>
  )

  const agent = agents.find(a => a.name === shown)
  const form = await read($, agentForm)
  const editForm = (part: Partial<SDispatchAgentForm>) => update($, agentForm, f => (f === null ? f : { ...f, ...part }))
  /** 保存: the whole form validated and written at once (effort clones re-registered), then back to the list. */
  const saveForm = async () => {
    const f = await read($, agentForm)
    if (f === null) return
    const current = normalizeConfig(await $.store.get('config').catch(() => undefined))
    const next = applyAgentForm(current, f, names)
    if ('error' in next) return say(next.error)
    try {
      const written = await saveConfig($, () => next.config)
      await reRegister(written)
    } catch (error) {
      return say(`保存失败：${String(error)}`)
    }
    await closeAgent($, '已保存')
  }
  const cancelForm = async () => closeAgent($, await discardNote($))
  const titleParts = agent === undefined ? undefined : defaultsParts(agent, cfg, fallback, QUICK)
  const titleColor = titleParts === undefined ? undefined : modelColor(titleParts.model, titleParts.inherited)
  const agentDetail =
    agent === undefined || form === null || form.name !== agent.name ? null : (
      <Box flexDirection="column">
        {/* Title row in the list's colours: name · model·effort · 缩写 · 额外 (as saved). */}
        <Box flexDirection="row">
          <Text color={ACCENT} bold>{agent.name}</Text>
          {titleColor === undefined ? <Text dimColor>{`  ${titleParts!.label}`}</Text> : <Text color={titleColor}>{`  ${titleParts!.label}`}</Text>}
          <Text dimColor>{`  缩写 ${cfg.aliases[agent.name] ?? '-'}`}</Text>
          {cfg.extraEffort[agent.name] !== undefined && <Text color="yellow">{`  额外 ${cfg.extraEffort[agent.name]}`}</Text>}
        </Box>
        {agent.description !== '' && <Text dimColor>{agent.description}</Text>}
        {/* A form: every field edits the draft; nothing is written until 保存. */}
        {enumRow(`vis:${agent.name}`, 'visible', '显示在选择器', form.visible, v => void editForm({ visible: v === 'off' ? 'off' : 'on' }))}
        <Input
          key={`alias:${agent.name}`}
          label="缩写"
          value={form.alias}
          submitLabel="下一项"
          onInput={value => void editForm({ alias: value })}
          onSubmit={value => void editForm({ alias: value }).then(() => focusKey($, `field:extra:${agent.name}`))}
        />
        {enumRow(`extra:${agent.name}`, 'extra', '额外档位', form.extra, v => void editForm({ extra: v }))}
        <Input
          key={`prompt:${agent.name}`}
          label="附加提示词"
          value={form.prompt}
          placeholder="留空即不加；只在 /s 派发时拼到任务前"
          submitLabel="下一项"
          onInput={value => void editForm({ prompt: value })}
          onSubmit={value => void editForm({ prompt: value }).then(() => focusKey($, 'agentSave'))}
        />
        <Box flexDirection="row" gap={2}>
          <Button key="agentSave" variant="primary" label="保存" onPress={() => void saveForm()} />
          <Button key="agentCancel" label="取消" hotkey="b" onPress={() => void cancelForm()} />
        </Box>
      </Box>
    )

  const body = { general: generalTab, route: routeTab, agents: agentDetail ?? agentList }[active] ?? generalTab
  return (
    <Box flexDirection="column">
      <Text color={ACCENT} bold>
        {breadcrumb(active, agentDetail === null ? '' : shown)}
      </Text>
      {tabs}
      <Text dimColor>{levelHint(where)}</Text>
      <Text dimColor>{'─'.repeat(Math.max(10, Math.min(60, e.props.bodyColumns - 2)))}</Text>
      {body}
      {line !== '' && <Text color={/^已(保存|改名)/.test(line) ? 'green' : 'yellow'}>{line}</Text>}
      <Button key="close" label="关闭" role="dismiss" onPress={() => void $.ui.close({ id: SETTINGS })} />
    </Box>
  )
}

export const register: Register = (on, given) => {
  load.options = given
  candidates.add(commandNameOf(DEFAULT_CONFIG, given.commandName))
  candidates.add('s')

  // Pass-through on both: a failed registration never holds up or drops the session or a prompt.
  on('session.start', async ($, e, next) => {
    await ensureCommand($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await ensureCommand($)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Record what the engine offers the model; hide this plugin's effort clones from it.
  on('agent.offer', async ($, e, next) => {
    // This plugin's agents (quick, effort clones) are for /s alone; the main model never sees them.
    if (e.agent === QUICK || isClone(e.agent)) return { isOffered: false }
    const result = await next(e)
    const entry = { name: e.agent, description: e.description }
    const list = await read($, offered)
    if (withOffered(list, entry) !== list) await update($, offered, all => [...withOffered(all, entry)])
    return result
  }).catch(($, e, next) => next(e)) // never gate an offer: a failed record lets it through

  // No matcher: the name is configurable, so the hook checks it and passes on every command it did not register.
  on('command.run', async ($, e, next) => {
    if (!candidates.has(e.command)) return next(e)
    const renamed = retired.get(e.command)
    if (renamed !== undefined && answered.has(e.command)) return { text: `已改名为 /${renamed}，请用 /${renamed}` }
    if (!answered.has(e.command)) await ensureCommand($)
    if (!answered.has(e.command)) return next(e)
    const cmd = e.command
    await refreshFallbackModel($)
    const { agents, cfg } = await loadRoster($, await loadConfig($))
    const plan = planCommand(e.args, agents, cfg)
    if (plan.action === 'settings') return { text: await openSettings($, cmd) }
    if (plan.action === 'dispatch') return { text: await dispatch($, plan.agent, plan.task, plan.count, { agent: plan.agent, via: 'named' }, plan.note) }
    if (plan.action === 'route') {
      const chosen = await route($, plan.task, cfg, agents)
      return { text: await dispatch($, chosen.agent, plan.task, plan.count, chosen, plan.note) }
    }
    await update($, picked, () => plan.picked)
    // `/s u`: the 代理 field shows what was typed, the ring starts in 任务 (its autoFocus).
    await update($, query, () => (plan.picked === '' ? '' : (e.args.trim().split(/\s+/)[0] ?? '')))
    await update($, pickerRing, () => '')
    await update($, note, () => plan.note)
    await $.ui.open({ id: PICKER, title: `/${cmd}`, focus: true, closeOnEscape: true })
    return { text: plan.note === '' ? `/${cmd} 选择器已打开。` : `/${cmd}: ${plan.note}` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const agentId = e.agentId
    if (agentId === undefined) return result
    const job = (await read($, jobs))[agentId]
    if (job === undefined) return result
    await update($, jobs, all => Object.fromEntries(Object.entries(all).filter(([id]) => id !== agentId)))
    const settled = settleJob(job, { answer: e.answer, isAborted: e.isAborted, reason: e.reason })
    $.ui.toast(settled.toast)
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: settled.appendText }] } })
    return result
  })

  // The /s picker, a command palette: 代理 filters the rows live (filterAgents), Enter there or a row
  // press picks and moves to 任务, whose Enter dispatches. ▸ marks the pick, else the best match.
  on('ui.render', { component: 'Pane', requestId: PICKER }, async ($, e) => {
    const cmd = await read($, commandName)
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>/{cmd} 需要能输入的界面；请直接输入 /{cmd} &lt;agent&gt; &lt;task&gt;。</Text>
    }
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const cfg = await read($, config)
    const visible = (await read($, roster)).filter(a => isListed(a.name) && isVisible(cfg, a.name))
    const choice = await read($, picked)
    const typed = await read($, query)
    const line = await read($, note)
    // After Esc from 任务 the ring belongs on 代理, so the reopen's autoFocus must not pull it back.
    const backToAgent = (await read($, pickerRing)) === 'agent'
    const fallback = await read($, fallbackModel)
    const rows = pickerRows(filterAgents(visible, cfg.aliases, typed), cfg, fallback, QUICK, e.props.bodyColumns)
    const marked = choice === AUTO || rows.some(r => r.name === choice) ? choice : (topChoice(visible, cfg.aliases, typed) ?? '')
    const pick = (name: string) =>
      void update($, picked, () => name)
        .then(() => update($, pickerRing, () => ''))
        .then(() => focusIn($, PICKER, 'task'))
    const submit = async (text: string) => {
      const current = await read($, config)
      const all = await read($, roster)
      const chosen = await read($, picked)
      const agent = chosen !== '' ? chosen : (topChoice(all.filter(a => isListed(a.name) && isVisible(current, a.name)), current.aliases, await read($, query)) ?? '')
      const counted = parseCount(text, current.maxCount)
      if (agent === '' || counted.task === '') {
        await update($, note, () => (agent === '' ? '先选一个代理。' : '写一下任务。'))
        return
      }
      // 自动路由: the route rules pick, and the result line says why (keyword/model/default).
      const via: Route = agent === AUTO ? await route($, counted.task, current, all) : { agent, via: 'named' }
      const said = await dispatch($, via.agent, counted.task, counted.count, via, counted.note)
      await update($, note, () => '')
      await update($, picked, () => '')
      await update($, query, () => '')
      $.ui.toast(said)
      await $.ui.close({ id: PICKER })
    }
    /** The chosen agent before 任务: `[ ui · sonnet·low ]` (name accent, defaults in the model's color). */
    const chosenAgent = visible.find(a => a.name === choice)
    const parts = chosenAgent === undefined ? undefined : defaultsParts(chosenAgent, cfg, fallback, QUICK)
    const partsColor = parts === undefined ? undefined : modelColor(parts.model, parts.inherited)
    return (
      <Box flexDirection="column">
        {line !== '' && <Text color="yellow">{line}</Text>}
        <Input
          key="agent"
          label="代理"
          value={typed}
          placeholder="输入名字或缩写筛选，↓ 选列表"
          submitLabel="选定"
          {...(choice === '' || backToAgent ? { autoFocus: true as const } : {})}
          onInput={value => void update($, query, () => value).then(() => update($, picked, () => ''))}
          onSubmit={value => {
            const top = topChoice(visible, cfg.aliases, value)
            void update($, query, () => value).then(() => (top === undefined ? update($, note, () => '没有匹配的代理') : pick(top)))
          }}
        />
        {/* The first row is always 自动路由; then one plain Button per matching agent: name · model·effort · alias · description. */}
        <Button key={`pick:${AUTO}`} plain onPress={() => pick(AUTO)}>
          {marked === AUTO ? <Text color={ACCENT} bold>▸ </Text> : '  '}
          <Text color={ACCENT} bold>自动路由</Text>
          <Text dimColor>  按路由规则自动挑代理</Text>
        </Button>
        {visible.length === 0 && <Text dimColor>没有可见的代理（/{cmd} set → 代理）。</Text>}
        {visible.length > 0 && rows.length === 0 && <Text dimColor>没有匹配的代理</Text>}
        {rows.map(r => (
          <Button key={`pick:${r.name}`} plain onPress={() => pick(r.name)}>
            {r.name === marked ? <Text color={ACCENT} bold>▸ </Text> : '  '}
            <Text color={ACCENT} bold>{r.nameCell}</Text>
            {r.color === undefined ? <Text dimColor>{`  ${r.defaultsCell}`}</Text> : <Text color={r.color}>{`  ${r.defaultsCell}`}</Text>}
            <Text dimColor>{`  ${r.aliasCell}${r.description === '' ? '' : `  ${r.description}`}`}</Text>
          </Button>
        ))}
        <Box flexDirection="row" gap={1}>
          {/* Pressing the chip goes back to 代理, its text cleared for a retype. */}
          <Button key="chosen" plain onPress={() => void backToFilter($)}>
            {choice === '' ? (
              <Text dimColor>[ 未选 ]</Text>
            ) : choice === AUTO ? (
              <Text color={ACCENT} bold>[ 自动路由 ]</Text>
            ) : (
              <Text>
                <Text>[ </Text>
                <Text color={ACCENT} bold>{choice}</Text>
                {parts !== undefined && (partsColor === undefined ? <Text dimColor>{` · ${parts.label}`}</Text> : <Text color={partsColor}>{` · ${parts.label}`}</Text>)}
                <Text> ]</Text>
              </Text>
            )}
          </Button>
          <Input
            key="task"
            label="任务"
            placeholder="要做什么（末尾 x2 派两份）"
            submitLabel="派发"
            {...(choice !== '' && !backToAgent ? { autoFocus: true as const } : {})}
            onSubmit={value => void submit(value)}
          />
        </Box>
      </Box>
    )
  })

  // The picker's ring, so Esc in 任务 returns to 代理 instead of closing.
  on('ui.focus', { requestId: PICKER }, async ($, e, next) => {
    const result = await next(e)
    if (result.deny === undefined) await update($, pickerRing, () => e.element ?? '')
    return result
  })

  // Esc (the person's close) in 任务 goes back to the 代理 field; anywhere else it closes.
  on('ui.close', { id: PICKER }, async ($, e, next) => {
    if (e.origin.kind !== 'person' || (await read($, pickerRing)) !== 'task') return next(e)
    await backToFilter($, true)
    return { value: undefined }
  })

  // Every ring move in the settings pane: remember the key and let the level follow it, so a Tab
  // from the tab bar into the content (or back) is the level Esc climbs from.
  on('ui.focus', { requestId: SETTINGS }, async ($, e, next) => {
    // From the tab bar, an arrow or Tab onto another tab goes down into the content instead.
    const to = e.origin.kind === 'person' ? ringTarget(await read($, ring), e.element, await firstOfTab($)) : e.element
    const result = await next(to === e.element || to === undefined ? e : { ...e, element: to })
    if (result.deny !== undefined) return result
    if (to !== e.element) {
      await update($, ring, () => to ?? '')
      await update($, level, () => nextLevel(0, { kind: 'tab' }) as Level)
      return result
    }
    if (result.deny !== undefined) return result
    await update($, ring, () => e.element ?? '')
    const now = await read($, level)
    const moved = nextLevel(now, { kind: 'ring', key: e.element, hasDetail: (await read($, expanded)) !== '' })
    if (moved !== 'close' && moved !== now) await update($, level, () => moved)
    return result
  })

  // Esc (closeOnEscape raises the person's close): above the tab bar, climb one level and keep
  // the pane by answering without `next`. The 关闭 button (origin plugin) and an unload pass.
  on('ui.close', { id: SETTINGS }, async ($, e, next) => {
    if (e.origin.kind !== 'person') return next(e)
    if (!(await escapeUp($))) return next(e)
    return { value: undefined }
  })

  on('ui.render', { component: 'Pane', requestId: SETTINGS }, async ($, e) => {
    if (e.surface === 'mobile') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>/{await read($, commandName)} set 需要能输入的界面。</Text>
    }
    return settingsTree($, e)
  })
}

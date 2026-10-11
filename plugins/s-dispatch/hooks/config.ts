// Pure helpers for /s settings: defaults and normalisation, command names,
// visibility, aliases, keyword rules, the cache-TTL key, and effort clones of agent files.

import type { SDispatchAgentForm, SDispatchConfig, SDispatchRouteMode, SDispatchRule } from '../types'
import { RESERVED } from './logic'

export const DEFAULT_RULES: readonly SDispatchRule[] = [
  { keywords: ['页面', '原型', '草图', '界面'], agent: 'ui' },
  { keywords: ['调研', '查文档', 'research'], agent: 'researcher' },
  { keywords: ['审查', 'review'], agent: 'reviewer' },
  { keywords: ['修', '实现', 'fix'], agent: 'worker' },
]

export const DEFAULT_CONFIG: SDispatchConfig = {
  commandName: null,
  defaultAgent: 's-dispatch:quick',
  quick: { model: 'sonnet', effort: 'low' },
  routeMode: 'hybrid',
  routeEffort: 'low',
  rules: DEFAULT_RULES.map(r => ({ keywords: [...r.keywords], agent: r.agent })),
  visibleAgents: {},
  aliases: {},
  prompts: {},
  maxCount: 3,
  extraEffort: {},
}

/** Agents the picker shows until the person chooses otherwise. */
export const DEFAULT_VISIBLE: readonly string[] = ['ui', 'worker', 'worker-hard', 'researcher', 'reviewer', 'Explore', 'general-purpose']

export const ROUTE_MODES: readonly SDispatchRouteMode[] = ['keyword', 'model', 'hybrid', 'off']
/** The router model's effort choices. */
export const ROUTE_EFFORTS: readonly SDispatchConfig['routeEffort'][] = ['low', 'medium', 'high']
export const EFFORTS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max']
export const MODELS: readonly string[] = ['haiku', 'sonnet', 'opus', 'inherit']
/** The 额外档位 choices; 'none' clears the agent's entry. */
export const EXTRA_EFFORTS: readonly string[] = ['none', ...EFFORTS]

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const stringMap = (v: unknown): Record<string, string> =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).filter((p): p is [string, string] => typeof p[1] === 'string')) : {}

/** The stored value read leniently: every field that fits is kept, the rest defaulted. */
export function normalizeConfig(raw: unknown): SDispatchConfig {
  const d = DEFAULT_CONFIG
  if (!isRecord(raw)) return { ...d, rules: d.rules.map(r => ({ ...r, keywords: [...r.keywords] })) }
  const quick = isRecord(raw.quick) ? raw.quick : {}
  const rules = Array.isArray(raw.rules)
    ? raw.rules.filter(isRecord).flatMap(r =>
        typeof r.agent === 'string' && Array.isArray(r.keywords)
          ? [{ agent: r.agent, keywords: r.keywords.filter((k): k is string => typeof k === 'string') }]
          : [],
      )
    : d.rules
  const visible = isRecord(raw.visibleAgents)
    ? Object.fromEntries(Object.entries(raw.visibleAgents).filter((p): p is [string, boolean] => typeof p[1] === 'boolean'))
    : {}
  return {
    commandName: typeof raw.commandName === 'string' && isValidCommandName(raw.commandName) ? raw.commandName : null,
    defaultAgent: typeof raw.defaultAgent === 'string' && raw.defaultAgent !== '' ? raw.defaultAgent : d.defaultAgent,
    quick: {
      model: typeof quick.model === 'string' && quick.model !== '' ? quick.model : d.quick.model,
      effort: typeof quick.effort === 'string' && EFFORTS.includes(quick.effort) ? quick.effort : d.quick.effort,
    },
    routeMode: ROUTE_MODES.includes(raw.routeMode as SDispatchRouteMode) ? (raw.routeMode as SDispatchRouteMode) : d.routeMode,
    routeEffort: ROUTE_EFFORTS.find(e => e === raw.routeEffort) ?? d.routeEffort,
    rules,
    visibleAgents: visible,
    aliases: stringMap(raw.aliases),
    prompts: stringMap(raw.prompts),
    maxCount: typeof raw.maxCount === 'number' && raw.maxCount >= 1 ? Math.floor(raw.maxCount) : d.maxCount,
    // v2's global multiEffort is dropped; only known efforts survive here.
    extraEffort: Object.fromEntries(Object.entries(stringMap(raw.extraEffort)).filter(([, v]) => EFFORTS.includes(v))),
  }
}

/** A name the engine can register (letters, digits, `_`, `-`; up to 64), not a reserved word. */
export function isValidCommandName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(name) && !RESERVED.includes(name.toLowerCase())
}

/** The stored name when set, else the userConfig option, else 's'. */
export function commandNameOf(config: SDispatchConfig, option: unknown): string {
  if (config.commandName !== null) return config.commandName
  return typeof option === 'string' && isValidCommandName(option) ? option : 's'
}

/** Whether a /config row's provider is this plugin: `s-dispatch`, or as an inline load names it (`s-dispatch@…`, `s-dispatch_…`). */
export function isOwnProvider(plugin: string): boolean {
  return plugin === 's-dispatch' || plugin.startsWith('s-dispatch@') || plugin.startsWith('s-dispatch_')
}

/** A stored choice wins; else the default visible set. */
export function isVisible(config: SDispatchConfig, name: string): boolean {
  return config.visibleAgents[name] ?? DEFAULT_VISIBLE.includes(name)
}

/**
 * Aliases for names in order: keep what is assigned; else the name's first
 * letter (lowercase), then its 2nd, 3rd... letter, skipping non-letters and
 * letters already taken. No free letter: no alias. Same object when unchanged.
 */
export function assignAliases(names: readonly string[], aliases: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const next: Record<string, string> = { ...aliases }
  const taken = new Set(Object.values(next).map(a => a.toLowerCase()))
  let changed = false
  for (const name of names) {
    if (next[name] !== undefined) continue
    const letter = [...name.toLowerCase()].find(ch => /\p{L}/u.test(ch) && !taken.has(ch))
    if (letter === undefined) continue
    next[name] = letter
    taken.add(letter)
    changed = true
  }
  return changed ? next : aliases
}

/** Why `alias` cannot be `name`'s, or undefined when it can ('' clears it). */
export function aliasError(aliases: Readonly<Record<string, string>>, names: readonly string[], name: string, alias: string): string | undefined {
  const wanted = alias.trim().toLowerCase()
  if (wanted === '') return undefined
  if (!/^[\p{L}\p{N}_-]+$/u.test(wanted)) return `缩写「${alias}」只能用字母、数字、_ 和 -`
  if (RESERVED.includes(wanted)) return `「${alias}」是保留字`
  const owner = Object.entries(aliases).find(([n, a]) => n !== name && a.toLowerCase() === wanted)?.[0]
  if (owner !== undefined) return `「${alias}」已被 ${owner} 占用，不能设置`
  const named = names.find(n => n !== name && n.toLowerCase() === wanted)
  if (named !== undefined) return `「${alias}」是代理 ${named} 的名字`
  return undefined
}

export function formatRule(rule: SDispatchRule): string {
  return `${rule.keywords.join('/')} → ${rule.agent}`
}

/** `关键词1/关键词2 → agent` (also `->`); agent must be one of `names`. */
export function parseRule(line: string, names: readonly string[]): { rule: SDispatchRule } | { error: string } {
  const match = /^(.*?)\s*(?:→|->)\s*(\S+)\s*$/.exec(line.trim())
  if (match === null) return { error: '格式：关键词1/关键词2 → agent' }
  const keywords = (match[1] ?? '').split('/').map(k => k.trim()).filter(k => k !== '')
  if (keywords.length === 0) return { error: '至少要一个关键词' }
  const wanted = (match[2] ?? '').toLowerCase()
  const agent = names.find(n => n.toLowerCase() === wanted)
  if (agent === undefined) return { error: `没有代理叫「${match[2]}」` }
  return { rule: { keywords, agent } }
}

/**
 * The rules with `draft` applied: rule `draft.index` replaced in place, else the draft appended.
 * Validated as a typed rule (parseRule): empty keywords or an unknown agent is the error.
 */
export function applyRuleDraft(
  rules: readonly SDispatchRule[],
  draft: { keywords: string; agent: string; index?: number },
  names: readonly string[],
): { rules: SDispatchRule[] } | { error: string } {
  if (draft.agent === '') return { error: '先选一个派发代理' }
  const parsed = parseRule(`${draft.keywords} → ${draft.agent}`, names)
  if ('error' in parsed) return parsed
  const at = draft.index
  if (at === undefined || at < 0 || at >= rules.length) return { rules: [...rules, parsed.rule] }
  return { rules: rules.map((r, i) => (i === at ? parsed.rule : r)) }
}

/** `5m` or `1h`, else undefined. */
export function validateTtl(text: string): '5m' | '1h' | undefined {
  const t = text.trim()
  return t === '5m' || t === '1h' ? t : undefined
}

/** The value under `key` in a JSON object text, as a string; '' when unset or unreadable. */
export function readJsonKey(text: string, key: string): string {
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) && parsed[key] !== undefined ? String(parsed[key]) : ''
  } catch {
    return ''
  }
}

/** The JSON object text with only `key` set, 2-space indent and a trailing newline; error when not an object. */
export function withJsonKey(text: string, key: string, value: string): { text: string } | { error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: 'settings.json 不是合法 JSON，未写入' }
  }
  if (!isRecord(parsed)) return { error: 'settings.json 顶层不是对象，未写入' }
  return { text: `${JSON.stringify({ ...parsed, [key]: value }, null, 2)}\n` }
}

/** What `$.agent.register` takes, spelled loosely so this file needs no engine import. */
export type CloneSpec = {
  name: string
  description: string
  prompt: string
  effort: string
  model?: string
  tools?: string[]
  disallowedTools?: string[]
  permissionMode?: string
  skills?: string[]
  maxTurns?: number
}

/** Frontmatter keys a clone carries over; any other key of the file is dropped. */
export const CLONED_KEYS: readonly string[] = ['description', 'model', 'tools', 'disallowedTools', 'permissionMode', 'skills', 'maxTurns']

const unquote = (v: string): string => v.trim().replace(/^(["'])([\s\S]*)\1$/, '$2')
const listOf = (v: string): string[] =>
  v.trim().replace(/^\[|\]$/g, '').split(',').map(unquote).filter(s => s !== '')

/**
 * An agent file as an agent spec named `<name>-<effort>` with that effort:
 * single-line frontmatter fields (CLONED_KEYS) and the body as prompt.
 * Undefined for text with no frontmatter.
 */
export function cloneSpec(name: string, fileText: string, effort: string): CloneSpec | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(fileText)
  if (match === null) return undefined
  const fields: Record<string, string> = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(line)
    if (kv !== null) fields[kv[1]!] = kv[2] ?? ''
  }
  const spec: CloneSpec = {
    name: `${name}-${effort}`,
    description: unquote(fields.description ?? ''),
    prompt: (match[2] ?? '').trim(),
    effort,
  }
  if (fields.model) spec.model = unquote(fields.model)
  if (fields.tools) spec.tools = listOf(fields.tools)
  if (fields.disallowedTools) spec.disallowedTools = listOf(fields.disallowedTools)
  if (fields.permissionMode) spec.permissionMode = unquote(fields.permissionMode)
  if (fields.skills) spec.skills = listOf(fields.skills)
  if (fields.maxTurns && Number.isInteger(Number(fields.maxTurns))) spec.maxTurns = Number(fields.maxTurns)
  return spec
}

export const QUICK_PROMPT =
  'You are a general-purpose helper dispatched in the background. Do the task you are given end to end, ' +
  'using whatever tools it needs, then answer with the result in a few lines: what you did, what you found, anything left open.'

/** The default `quick` agent (or its `quick-<effort>` clone) from the settings. */
export function quickSpec(config: SDispatchConfig, effort?: string): CloneSpec {
  return {
    name: effort === undefined ? 'quick' : `quick-${effort}`,
    description: 'Quick general helper dispatched by /s',
    prompt: QUICK_PROMPT,
    model: config.quick.model,
    effort: effort ?? config.quick.effort,
  }
}

/** The 代理 detail form for `name`, filled from the saved settings. */
export function agentForm(config: SDispatchConfig, name: string): SDispatchAgentForm {
  return {
    name,
    visible: isVisible(config, name) ? 'on' : 'off',
    alias: config.aliases[name] ?? '',
    extra: config.extraEffort[name] ?? 'none',
    prompt: config.prompts[name] ?? '',
  }
}

/** Whether the form differs from what is saved. */
export function isFormChanged(config: SDispatchConfig, form: SDispatchAgentForm): boolean {
  const saved = agentForm(config, form.name)
  return (['visible', 'alias', 'extra', 'prompt'] as const).some(k => saved[k] !== form[k])
}

/**
 * The settings with the whole form written: only fields that changed are touched, the alias
 * checked first (aliasError: a taken alias, a reserved word, another agent's name).
 */
export function applyAgentForm(
  config: SDispatchConfig,
  form: SDispatchAgentForm,
  names: readonly string[],
): { config: SDispatchConfig } | { error: string } {
  const was = agentForm(config, form.name)
  const name = form.name
  let next = config
  if (form.alias !== was.alias) {
    const problem = aliasError(config.aliases, names, name, form.alias)
    if (problem !== undefined) return { error: problem }
    next = { ...next, aliases: { ...next.aliases, [name]: form.alias.trim().toLowerCase() } }
  }
  if (form.visible !== was.visible) next = { ...next, visibleAgents: { ...next.visibleAgents, [name]: form.visible === 'on' } }
  if (form.extra !== was.extra) {
    const rest = Object.fromEntries(Object.entries(next.extraEffort).filter(([n]) => n !== name))
    next = { ...next, extraEffort: form.extra === 'none' ? rest : { ...rest, [name]: form.extra } }
  }
  if (form.prompt !== was.prompt) {
    const rest = Object.fromEntries(Object.entries(next.prompts).filter(([n]) => n !== name))
    next = { ...next, prompts: form.prompt.trim() === '' ? rest : { ...rest, [name]: form.prompt.trim() } }
  }
  return { config: next }
}

// Pure helpers for /s: argument grammar, agent resolution, the main-mode hand-off text, routing,
// roster merge, spawn arguments, pasted-image paths and job settlement. No `$` here, so every rule is testable.

import type { SDispatchAgent, SDispatchConfig, SDispatchJob, SDispatchRule } from '../types'

/** Engine built-ins that may be dispatched before agent.offer ever fired. */
export const BUILT_INS: readonly SDispatchAgent[] = [
  { name: 'Explore', description: 'Fast read-only codebase search' },
  { name: 'Plan', description: 'Designs an implementation plan' },
  { name: 'general-purpose', description: 'General multi-step research and tasks' },
  { name: 'claude-code-guide', description: 'Answers questions about Claude Code itself' },
]

/** Agents never listed (代理 tab, /s picker); naming one directly still dispatches it. */
export const HIDDEN_AGENTS: readonly string[] = ['claude', 'claude-code-guide']

/** Whether `name` is listed in the 代理 tab and the picker rows. */
export function isListed(name: string): boolean {
  return !HIDDEN_AGENTS.includes(name)
}

/** First tokens that open the settings pane and never name an agent; `set` is the one shown. */
export const RESERVED: readonly string[] = ['set', 'setting', 'settings']

/** One of this plugin's own agents (quick, effort clones): hidden from the model, so only $.agent.spawn can start it. */
export function isOwnAgent(name: string): boolean {
  return name.startsWith('s-dispatch:')
}

/** An effort clone this plugin registers (`s-dispatch:worker-high`): hidden from model and picker. */
export function isClone(name: string): boolean {
  return /^s-dispatch:.+-(low|medium|high|xhigh|max)$/.test(name)
}

/** Exact agent name, else alias, both case-insensitive; undefined when neither. */
export function resolveExact(token: string, roster: readonly SDispatchAgent[], aliases: Readonly<Record<string, string>>): string | undefined {
  const wanted = token.toLowerCase()
  const byName = roster.find(a => a.name.toLowerCase() === wanted)
  if (byName !== undefined) return byName.name
  const aliased = Object.entries(aliases).find(([, alias]) => alias.toLowerCase() === wanted)?.[0]
  return aliased !== undefined && roster.some(a => a.name === aliased) ? aliased : undefined
}

export type Counted = { task: string; count: number; note: string }

/** Strips a trailing ` xN` / ` ×N` and clamps N into 1..max, saying so when it clamps. */
export function parseCount(text: string, max: number): Counted {
  const match = /^([\s\S]*?)\s*(?:^|\s)[x×](\d+)\s*$/i.exec(text.trim())
  if (match === null) return { task: text.trim(), count: 1, note: '' }
  const wanted = Number(match[2])
  const count = Math.min(Math.max(wanted, 1), max)
  const note = wanted > max ? `数量 ${wanted} 超过上限 ${max}，按 ${max} 个派发` : ''
  return { task: (match[1] ?? '').trim(), count, note }
}

export type Plan =
  | { action: 'pick'; picked: string; note: string }
  | { action: 'settings' }
  | { action: 'dispatch'; agent: string; task: string; count: number; note: string }
  | { action: 'route'; task: string; count: number; note: string }

/**
 * `/s` picker · `/s set` settings (setting/settings silently too) · `/s <name|alias> <task> [xN]` dispatch ·
 * `/s <task> [xN]` route (first token names no agent exactly).
 */
export function planCommand(args: string, roster: readonly SDispatchAgent[], config: SDispatchConfig): Plan {
  const trimmed = args.trim()
  if (trimmed === '') return { action: 'pick', picked: '', note: '' }
  const [, first = '', rest = ''] = /^(\S+)\s*([\s\S]*)$/.exec(trimmed) ?? []
  if (RESERVED.includes(first.toLowerCase()) && rest.trim() === '') return { action: 'settings' }
  const agent = RESERVED.includes(first.toLowerCase()) ? undefined : resolveExact(first, roster, config.aliases)
  if (agent !== undefined) {
    const counted = parseCount(rest, config.maxCount)
    if (counted.task === '') return { action: 'pick', picked: agent, note: counted.note }
    return { action: 'dispatch', agent, ...counted }
  }
  const counted = parseCount(trimmed, config.maxCount)
  if (counted.task === '') return { action: 'pick', picked: '', note: '没有任务内容，先选代理再写任务。' }
  return { action: 'route', ...counted }
}

/**
 * Main mode: the one-line hint asking the main session to dispatch the task to `agent` in the background.
 * `ahead`: hidden context recorded before the task's message (/s); else a visible line under the task
 * (picker). `prompt`, the agent's 附加提示词, is kept on one line.
 */
export function handOffHint(agent: string, count: number, prompt: string | undefined, ahead: boolean): string {
  const extra = (prompt ?? '').replace(/\s+/g, ' ').trim().replace(/[。.；;，,]+$/, '')
  const asks = `${count > 1 ? `，派 ${count} 份` : ''}${extra === '' ? '' : `，要求：${extra}`}`
  const how = '由你结合前面的对话编排说明后再派'
  return ahead
    ? `接下来这条消息是用户用 /s 交来的任务：请在后台派遣 ${agent} 子代理完成它${asks}；${how}，不要自己动手做。`
    : `请在后台派遣 ${agent} 子代理完成上面的任务${asks}；${how}。`
}

export type Route =
  | { agent: string; via: 'keyword'; keyword: string }
  | { agent: string; via: 'model' | 'default' | 'named' }

/** The first rule whose any keyword (case-insensitive) appears in the task. */
export function keywordRoute(task: string, rules: readonly SDispatchRule[]): Route | undefined {
  const haystack = task.toLowerCase()
  for (const rule of rules) {
    const keyword = rule.keywords.find(k => k !== '' && haystack.includes(k.toLowerCase()))
    if (keyword !== undefined) return { agent: rule.agent, via: 'keyword', keyword }
  }
  return undefined
}

/** The one-shot question the router model answers with an agent name. */
export function routePrompt(task: string, agents: readonly SDispatchAgent[]): string {
  const list = agents.map(a => `- ${a.name}: ${a.description || '(no description)'}`).join('\n')
  return [
    'Pick the one agent best suited to the task below.',
    'Answer with the agent name exactly as listed and nothing else.',
    '',
    'Agents:',
    list,
    '',
    'Task:',
    task,
  ].join('\n')
}

/** The router's answer validated against the roster: exact name, else the one name it mentions. */
export function agentFromAnswer(text: string, roster: readonly SDispatchAgent[]): string | undefined {
  const cleaned = text.trim().replace(/^[`"'*\s]+|[`"'*.\s]+$/g, '').toLowerCase()
  const exact = roster.find(a => a.name.toLowerCase() === cleaned)
  if (exact !== undefined) return exact.name
  const tokens = new Set(text.toLowerCase().split(/[^a-z0-9:_-]+/))
  const mentioned = roster.filter(a => tokens.has(a.name.toLowerCase()))
  return mentioned.length === 1 ? mentioned[0]!.name : undefined
}

export function routeLabel(route: Route): string {
  if (route.via === 'keyword') return `关键词「${route.keyword}」`
  return { model: '模型判断', default: '默认', named: '指定' }[route.via]
}

/**
 * Efforts per copy: undefined keeps the agent's own. With an extra effort and
 * two or more copies, copy 1 runs at it and the rest at the default; x1 stays default.
 */
export function effortsFor(count: number, extra: string | undefined): (string | undefined)[] {
  return Array.from({ length: count }, (_, i) => (extra !== undefined && count > 1 && i === 0 ? extra : undefined))
}

/** The per-agent extra prompt ahead of the task. */
export function composePrompt(extra: string | undefined, task: string): string {
  const head = (extra ?? '').trim()
  return head === '' ? task : `${head}\n\n任务：${task}`
}

const IMAGE = /\[Image #(\d+)\]/g

/** Every N of `[Image #N]` in a task, unique, in order of first appearance. */
export function placeholders(text: string): number[] {
  return [...new Set([...text.matchAll(IMAGE)].map(m => Number(m[1])))]
}

/** Where Claude Code keeps its per-user temp: $CLAUDE_CODE_TMPDIR (itself, or its claude-<uid> child), else /tmp/claude-<uid>; no uid, no claude-<uid> root. */
export function imageRoots(tmpDir: string | undefined, uid: string): string[] {
  const base = tmpDir?.replace(/\/+$/, '')
  const own = uid ? [`${base ?? '/tmp'}/claude-${uid}`] : []
  return base ? [...own, base] : own
}

/** The saved picture of [Image #n] in a session's images dir. */
export function imageFile(dir: string, n: number): string {
  return `${dir}/${n}.png`
}

/**
 * The task with each found `[Image #N]` spelled with its file plus one Read line; a missing one
 * stays as typed and is named in `note` ('' when none is missing).
 */
export function withImagePaths(task: string, found: ReadonlyMap<number, string | undefined>): { text: string; note: string } {
  const missing = [...found].filter(([, file]) => file === undefined).map(([n]) => `[Image #${n}]`)
  const text = task.replace(IMAGE, (whole, n: string) => {
    const file = found.get(Number(n))
    return file === undefined ? whole : `[Image #${n}: ${file}]`
  })
  const isAnyFound = missing.length < found.size
  return {
    text: isAnyFound ? `${text}\n\n用 Read 工具打开上面的图片路径查看图片。` : text,
    note: missing.length === 0 ? '' : `${missing.join(' ')} 没找到图片文件，子代理看不到${missing.length > 1 ? '这些图' : '这张图'}`,
  }
}

/** One single-line field of a markdown agent file's frontmatter, unquoted; '' when absent. */
export function frontmatterField(text: string, key: string): string {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const line = block?.[1]?.split(/\r?\n/).find(l => l.startsWith(`${key}:`))
  if (line === undefined) return ''
  return line.slice(key.length + 1).trim().replace(/^(["'])([\s\S]*)\1$/, '$2').trim()
}

export function frontmatterDescription(text: string): string {
  return frontmatterField(text, 'description')
}

/** An agent's default model and effort, the `model·effort` label, and whether the model is inherited (not its own). */
export function defaultsParts(
  agent: SDispatchAgent,
  config: SDispatchConfig,
  fallbackModel: string,
  quick: string,
): { model: string; effort: string; inherited: boolean; label: string } {
  const own = agent.name === quick ? config.quick.model : (agent.model ?? '')
  const inherited = own === '' || own === 'inherit'
  const model = agent.name === quick || own !== '' ? own : fallbackModel === '' ? '主模型' : fallbackModel
  const effort = agent.name === quick ? config.quick.effort : agent.effort !== undefined && agent.effort !== '' ? agent.effort : '继承'
  const shown = agent.name !== quick && own === '' ? `${model}(继承)` : model
  return { model, effort, inherited, label: `${shown}·${effort}` }
}

/** An agent's default `model·effort`: quick's from the settings; a missing model or effort reads 继承. */
export function defaultsLabel(agent: SDispatchAgent, config: SDispatchConfig, fallbackModel: string, quick: string): string {
  return defaultsParts(agent, config, fallbackModel, quick).label
}

/** Text cut to `max` characters, an ellipsis standing for the rest. */
export function shorten(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return [...one].length > max ? `${[...one].slice(0, max - 1).join('')}…` : one
}

/** Terminal cells a string takes: wide (CJK, fullwidth) characters count two. */
export function cellWidth(text: string): number {
  return [...text].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/.test(ch) ? 2 : 1), 0)
}

/** Text padded with spaces to `width` terminal cells. */
export const padCells = (text: string, width: number): string => text + ' '.repeat(Math.max(0, width - cellWidth(text)))

/** Merge rosters in priority order, first spelling of a name (case-insensitive) wins; clones left out. */
export function mergeRoster(...lists: readonly (readonly SDispatchAgent[])[]): SDispatchAgent[] {
  const seen = new Set<string>()
  const merged: SDispatchAgent[] = []
  for (const agent of lists.flat()) {
    const key = agent.name.toLowerCase()
    if (agent.name === '' || isClone(agent.name) || seen.has(key)) continue
    seen.add(key)
    merged.push(agent)
  }
  return merged
}

/** Upsert one offered agent; returns the same array when nothing changed. */
export function withOffered(list: readonly SDispatchAgent[], agent: SDispatchAgent): readonly SDispatchAgent[] {
  const at = list.findIndex(a => a.name === agent.name)
  if (at === -1) return [...list, agent]
  if (list[at]!.description === agent.description) return list
  return list.map((a, i) => (i === at ? agent : a))
}

export type SpawnSpec = { subagentType: string; prompt: string; description: string }

export function spawnArgs(agent: string, task: string, prompt: string = task): SpawnSpec {
  const oneLine = task.replace(/\s+/g, ' ').trim()
  const description = oneLine.length > 40 ? `${oneLine.slice(0, 39)}…` : oneLine
  return { subagentType: agent, prompt, description }
}

export type TurnEnd = { answer: string; isAborted: boolean; reason: string }
export type Settlement = { toast: string; appendText: string }

/**
 * What a finished job leaves: a toast for the person and a user-role row the
 * main model reads next turn. Whether the engine also delivers a
 * task-notification row for a plugin's background spawn is unverified; if it
 * does, drop the append in the turn.complete hook.
 */
export function settleJob(job: SDispatchJob, end: TurnEnd): Settlement {
  const tag = `[/s ${job.agent}]`
  if (end.isAborted) {
    return { toast: `${job.agent} 已中断`, appendText: `${tag} interrupted before answering. Task: ${job.task}` }
  }
  if (end.reason !== 'answer') {
    return { toast: `${job.agent} 失败 (${end.reason})`, appendText: `${tag} ended with ${end.reason}, no answer. Task: ${job.task}` }
  }
  if (end.answer.trim() === '') {
    return { toast: `${job.agent} 完成（无输出）`, appendText: `${tag} finished with no answer. Task: ${job.task}` }
  }
  return { toast: `${job.agent} 完成`, appendText: `${tag} result:\n${end.answer}` }
}

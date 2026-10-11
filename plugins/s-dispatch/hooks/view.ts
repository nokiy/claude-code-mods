// Pure drawing data for the /s picker and the /s set pane: colors, picker rows,
// option chips with their one-line explanations, tabs and the breadcrumb. No `$`.

import type { SDispatchAgent, SDispatchConfig } from '../types'
import { EFFORTS, EXTRA_EFFORTS, ROUTE_EFFORTS } from './config'
import { cellWidth, defaultsParts, padCells, shorten } from './logic'

/** The accent color: agent names, the active tab, the chosen chip. */
export const ACCENT = 'claude'

const MODEL_COLORS: Record<string, string> = { haiku: 'green', sonnet: 'blue', opus: 'magenta' }

/** A model's color; undefined (draw dim) for an inherited or unknown model. */
export function modelColor(model: string, inherited: boolean): string | undefined {
  return inherited ? undefined : MODEL_COLORS[model.toLowerCase()]
}

/** One picker row, cells padded so columns line up: name, model·effort, alias, description. */
export type PickerRow = {
  name: string
  nameCell: string
  defaults: string
  defaultsCell: string
  /** Undefined: draw `defaults` dim. */
  color: string | undefined
  aliasCell: string
  description: string
}

/**
 * The picker's live filter, case-insensitive: an exact alias first, then a name prefix, then a
 * name or description substring; roster order within each rank. An empty query keeps every agent.
 */
export function filterAgents<T extends SDispatchAgent>(agents: readonly T[], aliases: Record<string, string>, query: string): T[] {
  const q = query.trim().toLowerCase()
  if (q === '') return [...agents]
  const rank = (a: T): number => {
    const name = a.name.toLowerCase()
    if ((aliases[a.name] ?? '').toLowerCase() === q) return 0
    if (name.startsWith(q)) return 1
    return name.includes(q) || a.description.toLowerCase().includes(q) ? 2 : 3
  }
  return agents
    .map(a => ({ a, r: rank(a) }))
    .filter(x => x.r < 3)
    .sort((x, y) => x.r - y.r)
    .map(x => x.a)
}

/** The picker's 自动路由 pseudo-row: route the task by the rules. No agent name holds `*`. */
export const AUTO = '*auto'

/** What Enter in the 代理 filter picks: 自动路由 on an empty filter, else the best match (undefined: none). */
export function topChoice(agents: readonly SDispatchAgent[], aliases: Record<string, string>, query: string): string | undefined {
  return query.trim() === '' ? AUTO : filterAgents(agents, aliases, query)[0]?.name
}

/** Leading marker cells (`▸ `) and the two-space gaps between columns. */
const MARK = 2
const GAP = 2

/** Text cut to `max` terminal cells, an ellipsis standing for the rest. */
export function fitCells(text: string, max: number): string {
  if (cellWidth(text) <= max) return text
  if (max <= 1) return ''
  let out = ''
  for (const ch of text) {
    if (cellWidth(out + ch) > max - 1) break
    out += ch
  }
  return `${out}…`
}

/** Picker rows in roster order; the description is cut to what `columns` leaves (≤40 characters). */
export function pickerRows(
  agents: readonly SDispatchAgent[],
  config: SDispatchConfig,
  fallbackModel: string,
  quick: string,
  columns: number,
): PickerRow[] {
  const raw = agents.map(a => {
    const parts = defaultsParts(a, config, fallbackModel, quick)
    return { name: a.name, defaults: parts.label, color: modelColor(parts.model, parts.inherited), alias: config.aliases[a.name] ?? '', description: shorten(a.description, 40) }
  })
  const nameW = Math.max(0, ...raw.map(r => cellWidth(r.name)))
  const defW = Math.max(0, ...raw.map(r => cellWidth(r.defaults)))
  const aliasW = Math.max(1, ...raw.map(r => cellWidth(r.alias)))
  const room = columns - (MARK + nameW + GAP + defW + GAP + aliasW + GAP)
  return raw.map(r => ({
    name: r.name,
    nameCell: padCells(r.name, nameW),
    defaults: r.defaults,
    defaultsCell: padCells(r.defaults, defW),
    color: r.color,
    aliasCell: padCells(r.alias === '' ? '-' : r.alias, aliasW),
    description: room < 6 ? '' : fitCells(r.description, room),
  }))
}

export type Chip = { value: string; label: string }
export type ChipField = 'ttl' | 'quickModel' | 'quickEffort' | 'maxCount' | 'routeMode' | 'routeEffort' | 'extra' | 'visible'

const plain = (values: readonly string[], labels: Record<string, string> = {}): Chip[] => values.map(v => ({ value: v, label: labels[v] ?? v }))

export const ROUTE_LABELS: Record<string, string> = { keyword: '仅关键词', model: '仅小模型', hybrid: '混合', off: '关闭' }

const CHIPS: Record<ChipField, Chip[]> = {
  ttl: plain(['5m', '1h']),
  quickModel: plain(['haiku', 'sonnet', 'opus']),
  quickEffort: plain(EFFORTS),
  maxCount: plain(['1', '2', '3', '4', '5']),
  routeMode: plain(['keyword', 'model', 'hybrid', 'off'], ROUTE_LABELS),
  routeEffort: plain(ROUTE_EFFORTS),
  extra: plain(EXTRA_EFFORTS, { none: '无' }),
  visible: plain(['on', 'off'], { on: '显示', off: '隐藏' }),
}

/** The chips of a field; a current value outside them leads, so it still shows as chosen. */
export function chipOptions(field: ChipField, current: string | undefined): Chip[] {
  const chips = CHIPS[field]
  return current === undefined || current === '' || chips.some(c => c.value === current) ? chips : [{ value: current, label: current }, ...chips]
}

const EXPLAIN: Record<ChipField, Record<string, string>> = {
  ttl: { '5m': '便宜但易过期', '1h': '适合长任务' },
  quickModel: { haiku: '最快最省，适合简单活', sonnet: '均衡，多数任务够用', opus: '最强也最贵，适合难题', inherit: '跟随主会话的模型' },
  quickEffort: { low: '思考最少，最快最省', medium: '适中', high: '多想一些，更慢', xhigh: '深度思考，更慢更贵', max: '思考预算拉满，最慢最贵' },
  maxCount: {},
  routeEffort: { low: '最快·够用于挑代理', medium: '多想一些，稍慢', high: '更慢，难分辨时用' },
  routeMode: {
    keyword: '只按下面的规则匹配，不花钱',
    model: '让 Haiku 读任务和代理描述来挑，约 1–2 秒',
    hybrid: '先查关键词，没命中再问 Haiku',
    off: '一律派默认代理',
  },
  extra: { none: '每份都用代理默认档位' },
  visible: { on: '在 /s 选择器里显示', off: '不在选择器里显示（仍可用名字或缩写直接派）' },
}

/** A dropdown option's text: the label, then its short explanation when the field has one. */
export function optionLabel(field: ChipField, chip: Chip): string {
  const explain = EXPLAIN[field][chip.value]
  return explain === undefined ? chip.label : `${chip.label} · ${explain}`
}

/** One dim line explaining the chosen option of `field` (`current` '' or undefined: nothing chosen yet). */
export function chipHint(field: ChipField, current: string | undefined): string {
  const value = current ?? ''
  if (field === 'ttl') return `${value === '' ? '未设置：用引擎默认' : `${value}：${EXPLAIN.ttl[value] ?? '非标准值'}`} · 只有 5m / 1h 两档，写入 ~/.claude/settings.json`
  if (field === 'maxCount') return `末尾 xN 最多派 ${value} 份，超出按 ${value} 份派发`
  if (field === 'extra' && value !== 'none' && value !== '') return `${value}：x2 及以上时第 1 份用 ${value}，其余用默认；x1 用默认`
  const label = chipOptions(field, value).find(c => c.value === value)?.label ?? value
  return `${label}：${EXPLAIN[field][value] ?? '自定义值'}`
}

/** The settings tabs: id, label, hotkey. */
export const TABS: readonly (readonly [string, string, string])[] = [
  ['general', '通用', '1'],
  ['route', '路由', '2'],
  ['agents', '代理', '3'],
]

/** A known tab id; anything else (v3's `dispatch` kept in session state across a reload) is `general`. */
export function activeTab(raw: string): string {
  return TABS.some(t => t[0] === raw) ? raw : 'general'
}

/** Where the keyboard is in the settings pane: 0 the tab bar, 1 a tab's content, 2 an agent's detail. */
export type Level = 0 | 1 | 2

/** What moves the level: Esc, the detail's back button, a press on an agent row or a tab, or the ring landing on `key`. */
export type NavAction =
  /** `hasPopup`: an open dropdown or a new-rule draft, which Esc folds first, the level kept. */
  | { kind: 'escape'; hasPopup: boolean }
  | { kind: 'back' }
  | { kind: 'openAgent' }
  /** Choosing a tab (1/2/3, click, Enter) lands on its content. */
  | { kind: 'tab' }
  /** `key` undefined: one of the engine's own stops (the close mark). */
  | { kind: 'ring'; key: string | undefined; hasDetail: boolean }

/** The level after `action`; 'close' when Esc at the tab bar should close the pane. */
export function nextLevel(level: Level, action: NavAction): Level | 'close' {
  if (action.kind === 'escape') return action.hasPopup ? level : level === 0 ? 'close' : level === 2 ? 1 : 0
  if (action.kind === 'back') return 1
  if (action.kind === 'openAgent') return 2
  if (action.kind === 'tab') return 1
  // The engine's close mark counts as the tab bar, so Esc there closes, as the person means.
  if (action.key === undefined || action.key.startsWith('tab:')) return 0
  if (action.key === 'close') return level
  return action.hasDetail ? 2 : 1
}

/** The element a step down into tab `id` focuses: its first field, or the first agent row. */
export function firstFieldKey(id: string, firstAgent: string | undefined): string | undefined {
  const tab = activeTab(id)
  if (tab === 'agents') return firstAgent === undefined ? undefined : `agent:${firstAgent}`
  return tab === 'route' ? 'field:routeMode' : 'field:ttl'
}

/**
 * Where a person's ring move lands: from one tab onto another (an arrow, Tab) it goes down into the
 * content (`first`) instead; tabs are chosen by 1/2/3, click or Enter. Any other move stands.
 */
export function ringTarget(from: string, to: string | undefined, first: string | undefined): string | undefined {
  return first !== undefined && to !== undefined && from.startsWith('tab:') && to.startsWith('tab:') && to !== from ? first : to
}

/** The dim key hint under the tabs, per level. */
export function levelHint(level: Level): string {
  if (level === 0) return '1/2/3 选页签 · ↓/回车进入 · Esc 关闭'
  if (level === 1) return '↑↓/Tab 移动 · 回车展开/选择 · 1/2/3 切页签 · Esc 返回页签'
  return '↑↓/Tab 移动 · 回车展开/选择 · ↓到底 保存 · b/Esc 取消返回列表'
}

/** The pane note after a rename: reloaded through userConfig, or registered live with the old name left over. */
export function renameNote(old: string, name: string, isReloaded: boolean): string {
  return isReloaded ? `已改名为 /${name}，插件已重载，只保留这一个` : `已改名为 /${name}；旧名字 /${old} 要重载或下次会话才消失`
}

/** Where the ring returns when a rule editor folds: the edited rule's row, or ＋ 添加规则. */
export function draftHome(draft: { index?: number } | null): string {
  return draft?.index === undefined ? 'ruleAdd' : `rule:${draft.index}`
}

/** `设置 › <tab>`, then `› <agent>` while one is open in the 代理 tab. */
export function breadcrumb(tab: string, agent: string): string {
  const id = activeTab(tab)
  const label = TABS.find(t => t[0] === id)![1]
  return ['设置', label, ...(id === 'agents' && agent !== '' ? [agent] : [])].join(' › ')
}

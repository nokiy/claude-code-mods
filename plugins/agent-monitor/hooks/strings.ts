// UI strings of agent-monitor, English and Chinese; English unless the session's language says Chinese. Called by every drawing and text module.
// Column names (Tier, Edits, ...) and the table's other headers stay English in both languages. Pure; tested in strings.test.ts.
import type { PrState } from './prindex'

export type Lang = 'en' | 'zh'

type Kind = 'conflict' | 'stall' | 'tier' | 'denied' | 'failed'

const EN = {
  // tool activity: verb + short target (`Read logic.ts`)
  verb: { Read: 'Read', Edit: 'Edit', Write: 'Write', Grep: 'Search', Glob: 'Find', Bash: 'Run', WebFetch: 'Fetch', WebSearch: 'Web search', Skill: 'Skill', Agent: 'Dispatch', LSP: 'Code navigation' } as Record<string, string>,
  starting: 'starting',
  // an agent named in a sentence: type + quoted task
  quote: (s: string) => `"${s}"`,
  // alerts
  tag: { conflict: 'conflict', stall: 'stalled', tier: 'tier', denied: 'denied', failed: 'error' } as Record<Kind, string>,
  and: (a: string, b: string) => `${a} and ${b}`,
  conflictLine: (pair: string, path: string) => `${pair} edited ${path} at the same time`,
  stallTool: (who: string, idle: string, tool: string) => `${who} idle for ${idle} (${tool} not returned)`,
  stallSilent: (who: string, idle: string, last: string | undefined) => `${who} idle for ${idle}, no activity${last ? ` (last: ${last})` : ''}`,
  tierLine: (who: string, want: string, got: string) => `${who} described ${want} · ran ${got}`,
  // a running row's line 2 when the steps did not run the tier the description asked for
  wanted: (tier: string) => `≠ wanted ${tier}`,
  // one refusal reason of the alert timeline: its count and its text
  deniedLine: (who: string, n: number, reason: string) => `${who} refused ×${n}: ${reason}`,
  failedLine: (who: string, n: number, reason: string) => `${who} errored ×${n}: ${reason}`,
  // detail page
  sec: { prompt: 'Instruction', steps: 'Steps', files: 'Edited files', tools: 'Tools', skills: 'Skills', alerts: 'Alerts', result: 'Result' },
  inProgress: 'in progress',
  took: (d: string) => `took ${d}`,
  roundsN: (n: number) => `rounds ${n}`,
  longestStep: (d: string) => `longest step ${d}`,
  tokenRows: { hit: 'Input (cache hit)', miss: 'Input (cache miss)', out: 'Output', cost: 'Est. cost' },
  clashWith: (names: string[]) => `  clashes with ${names.join(', ')}`,
  // panel
  noAgents: ' No subagents yet this session',
  close: 'close',
  back: 'back',
  settings: 'settings',
  listHint: ' ↑↓ select · Enter detail · ',
  escClose: ' · Esc close',
  xClose: ' · x close',
  // settings page
  settingsTitle: ' Settings',
  settingsSub: '  Subagents panel options',
  unsaved: '  unsaved',
  save: 'Save',
  settingsHint: ' ↑↓ select · Enter change · w save (b goes back without saving)',
  gloss: {
    tier: 'model.effort column', cost: 'ctx% · tokens · $ column', time: 'elapsed time column',
    alerts: 'red ! on alerted rows (also on live rows)', alertsBlock: 'alert sentences block', autoBand: 'show live rows while agents run', toasts: 'pop-up notices',
    placement: 'default place: last = as before / right / top', stallMinutes: 'stall threshold (minutes)',
  } as Record<string, string>,
  // command, pane, toasts
  commandDescription: 'Subagent history',
  paneTitle: 'Subagents',
  notSaved: (why: string) => `Settings not saved: ${why}`,
  pricesBad: 'The prices setting is invalid; costs are estimated with the default prices',
  // PR mode: the group of agents on no PR, a group's agent count, the footer's mode keys
  otherGroup: 'Other',
  agentsN: (n: number) => (n === 1 ? '1 agent' : `${n} agents`),
  modeHint: ' · p/a PR/Agent',
  // PR mode, English in both languages: the mode switch, the group header's columns, a group's tokens, the PR state words
  modes: { pr: 'PR', agent: 'Agent' },
  prColumns: { title: 'Title', agents: 'agents', tokens: 'tokens', cost: 'cost', time: 'time', state: 'state' },
  tok: (n: string) => `${n} tok`,
  prState: { draft: 'Draft', ready: 'Ready', merged: 'Merged' } as Record<PrState, string>, // pr-hint's PR_STATE words
  // an alert timeline refusal with no reason text
  noReason: '(no reason)',
}

// The PR mode's words are the same in both languages.
const PR_WORDS = { modes: EN.modes, prColumns: EN.prColumns, tok: EN.tok, prState: EN.prState }

export type Strings = typeof EN

const ZH: Strings = {
  verb: { Read: '读取', Edit: '修改', Write: '写入', Grep: '搜索', Glob: '查找', Bash: '运行', WebFetch: '抓取', WebSearch: '搜索网页', Skill: '技能', Agent: '派发', LSP: '代码导航' },
  starting: '启动中',
  quote: s => `「${s}」`,
  tag: { conflict: '冲突', stall: '卡住', tier: '档位', denied: '拦截', failed: '出错' },
  and: (a, b) => `${a} 与 ${b}`,
  conflictLine: (pair, path) => `${pair} 同时修改 ${path}`,
  stallTool: (who, idle, tool) => `${who} 已 ${idle}（${tool} 未返回）`,
  stallSilent: (who, idle, last) => `${who} 已 ${idle} 无动作${last ? `（最后：${last}）` : ''}`,
  tierLine: (who, want, got) => `${who} 描述 ${want} · 实际 ${got}`,
  wanted: tier => `≠ 要求 ${tier}`,
  deniedLine: (who, n, reason) => `${who} 被拒 ×${n}：${reason}`,
  failedLine: (who, n, reason) => `${who} 出错 ×${n}：${reason}`,
  sec: { prompt: '指令', steps: '步骤', files: '改过的文件', tools: '工具', skills: '技能', alerts: '告警', result: '结果' },
  inProgress: '进行中',
  took: d => `用时 ${d}`,
  roundsN: n => `轮次 ${n}`,
  longestStep: d => `最长一步 ${d}`,
  tokenRows: { hit: '输入（缓存命中）', miss: '输入（缓存未命中）', out: '输出', cost: '估算花费' },
  clashWith: names => `  与 ${names.join('、')} 冲突`,
  noAgents: ' 本会话还没有子代理',
  close: '关闭',
  back: '返回',
  settings: '设置',
  listHint: ' ↑↓ 选择 · Enter 详情 · ',
  escClose: ' · Esc 关闭',
  xClose: ' · x 关闭',
  settingsTitle: ' 设置',
  settingsSub: '  Subagents 面板选项',
  unsaved: '  未保存',
  save: '保存',
  settingsHint: ' ↑↓ 选择 · Enter 切换 · w 保存（b 返回不保存）',
  gloss: {
    tier: '模型.档位列', cost: 'ctx% · 令牌 · $ 列', time: '用时列', alerts: '告警行末红色 !（含运行条）',
    alertsBlock: '告警说明区', autoBand: '运行时自动显示', toasts: '弹出提示', placement: '默认位置：last 沿用上次 / right / top', stallMinutes: '卡住阈值（分钟）',
  },
  commandDescription: '子代理历史',
  paneTitle: 'Subagents',
  notSaved: why => `设置未保存：${why}`,
  pricesBad: 'prices 设置无效，已按默认价格估算',
  otherGroup: '其他',
  agentsN: n => `${n} 个子代理`,
  modeHint: ' · p/a 切换 PR/Agent',
  ...PR_WORDS,
  noReason: '（无原因）',
}

export const strings = (lang: Lang): Strings => (lang === 'zh' ? ZH : EN)

/**
 * The UI language: the config option when set, else Claude Code's `language`
 * setting, else the locale; Chinese only when one of them says so.
 */
export function pickLang(option: unknown, setting: unknown, locale: string | undefined): Lang {
  if (option === 'en' || option === 'zh') return option
  const said = `${typeof setting === 'string' ? setting : ''} ${locale ?? ''}`.toLowerCase()
  return /chinese|中文|^zh|\szh/.test(said.trim()) || said.includes('zh_') || said.includes('zh-') ? 'zh' : 'en'
}

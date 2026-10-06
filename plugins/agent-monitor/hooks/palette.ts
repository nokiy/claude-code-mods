// Colors for agent-monitor (One Dark): the one place that says which color means what. Pure; tested in palette.test.ts.

export const PALETTE = {
  blue: '#61AFEF',
  purple: '#C678DD',
  cyan: '#56B6C2',
  green: '#98C379',
  amber: '#E5C07B',
  orange: '#D19A66',
  red: '#E06C75',
  fg: '#ABB2BF',
  gray: '#5C6370',
  selBg: '#2A2F3A', // the selected row's band: One Dark's bg lifted a notch
} as const

export type Style = { color: string; bold?: boolean }

const STATUS: Record<string, string> = { running: PALETTE.amber, done: PALETTE.green, failed: PALETTE.red, unknown: PALETTE.gray }
const TYPE: Record<string, string> = { worker: PALETTE.blue, 'worker-hard': PALETTE.purple, Explore: PALETTE.cyan, researcher: PALETTE.green, reviewer: PALETTE.amber, sketch: PALETTE.orange }
const MODEL: Record<string, string> = { opus: PALETTE.purple, sonnet: PALETTE.blue, haiku: PALETTE.cyan, fable: PALETTE.amber }

// Status glyph color; an unlisted status is gray.
export const statusColor = (status: string): string => STATUS[status] ?? PALETTE.gray

// Agent type, always bold; merger and every type not named here (general-purpose, Plan, ...) are fg.
export const typeStyle = (type: string): Style => ({ color: TYPE[type] ?? PALETTE.fg, bold: true })

// Model by full name (opus, sonnet, ...); unknown or `—` is gray.
export const modelColor = (model: string | undefined): string => MODEL[model ?? ''] ?? PALETTE.gray

// low gray, medium fg, high amber and bold; unknown or `—` is gray.
export function effortStyle(effort: string | undefined): Style {
  if (effort === 'high') return { color: PALETTE.amber, bold: true }
  if (effort === 'medium') return { color: PALETTE.fg }
  return { color: PALETTE.gray }
}

/** `denied`: a hook refused the call; `failed`: the tool ran and its result is an error. */
export type AlertKind = 'conflict' | 'stall' | 'tier' | 'denied' | 'failed'

// Alerts are red; an errored tool result is amber, a stall amber at its threshold and red at twice it.
export const alertColor = (kind: AlertKind, level?: 1 | 2): string => (kind === 'failed' || (kind === 'stall' && level !== 2) ? PALETTE.amber : PALETTE.red)

// Tokens by size: under 50k or unknown gray, 50k fg, 100k amber, 300k red.
export function tokenColor(n: number | undefined): string {
  if (n === undefined || n < 50_000) return PALETTE.gray
  if (n < 100_000) return PALETTE.fg
  if (n < 300_000) return PALETTE.amber
  return PALETTE.red
}

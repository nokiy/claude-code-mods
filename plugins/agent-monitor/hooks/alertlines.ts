// The alerts as shown: width-1 glyph flags, the row-end `!` mark, and the alert timeline (timestamped sentences with their causes, in the
// UI language) that the Alerts block and the detail page draw. Pure; tested in alertlines.test.ts.
import { idleText, shortPath } from './alerts'
import { agentRef, cellWidth, collapse, formatClock } from './logic'
import { PALETTE, alertColor } from './palette'
import type { AlertKind } from './palette'
import type { Strings } from './strings'
import type { View } from './views'

export type Seg = { text: string; color: string; bold?: boolean; italic?: boolean }

const ORDER: AlertKind[] = ['conflict', 'stall', 'tier', 'denied']

// `!` conflict, `~` stalled, `≠` tier mismatch, `×N` denied/errored: single-cell glyphs only, separated by one blank.
export function flagSegs(v: View): Seg[] {
  const flags: Seg[] = []
  if (v.clashes.length > 0) flags.push({ text: '!', color: alertColor('conflict') })
  if (v.stall) flags.push({ text: '~', color: alertColor('stall', v.stall.level) })
  if (v.tier) flags.push({ text: '≠', color: alertColor('tier') })
  if (v.denied > 0) flags.push({ text: `×${v.denied}`, color: alertColor('denied') })
  return flags.flatMap((f, i) => (i === 0 ? [f] : [{ text: ' ', color: PALETTE.fg }, f]))
}

// Whether the agent has any of the four alerts (conflict, stall, tier mismatch, refusals).
export const alerted = (v: View): boolean => v.clashes.length > 0 || v.stall !== undefined || v.tier !== undefined || v.denied > 0

// The row-end alert mark of the panel rows and the live band: one red `!` when the agent has an alert, nothing otherwise.
export const ALERT_MARK: Seg = { text: '!', color: PALETTE.red, bold: true }
export const alertMark = (v: View): Seg[] => (alerted(v) ? [ALERT_MARK] : [])

export const segsWidth =(segs: readonly Seg[]): number => segs.reduce((n, s) => n + cellWidth(s.text), 0)

// `at`: when the alert began (the conflict's overlap or main edit, the stall's last event, the spawn for a tier mismatch, a refusal
// reason's first sighting); undefined when unknown.
export type AlertLine = { kind: AlertKind; tag: string; label: string; color: string; body: string; ids: string[]; live: boolean; at?: number }

// `14:02:11` (local clock) of a timeline line, `--:--:--` when its time is unknown.
export const alertClock = (l: AlertLine): string => (l.at === undefined ? '--:--:--' : formatClock(l.at))

export const lineText = (l: AlertLine): string => `${alertClock(l)} ${l.tag} ${l.label}  ${l.body}`

const GLYPH: Record<AlertKind, string> = { conflict: '!', stall: '~', tier: '≠', denied: '×' }

// The alert timeline, one line per alert: conflicts (a pair and path once), stalls, tier mismatches, and one line per distinct refusal
// reason with its count; oldest first, those of unknown time last, ties in the kind order. An agent is named `type"task"` (agentRef);
// a conflict pair names the older agent first.
export function alertLines(views: readonly View[], cwd: string, t: Strings): AlertLine[] {
  const no = new Map(views.map((v, i) => [v.id, i + 1]))
  const who = (v: View) => agentRef(v.type, v.task, t)
  const out: AlertLine[] = []
  const line = (kind: AlertKind, at: number | undefined, body: string, ids: string[], live: boolean, level?: 1 | 2) => {
    out.push({ kind, tag: GLYPH[kind], label: t.tag[kind], color: alertColor(kind, level), body, ids, live, ...(at === undefined ? {} : { at }) })
  }
  const seen = new Set<string>()
  for (const v of views) {
    for (const c of v.clashes) {
      const key = `${[v.id, c.other].sort().join('|')}|${c.path}`
      if (seen.has(key)) continue
      seen.add(key)
      const other = views.find(x => x.id === c.other)
      const pair = other ? (no.get(other.id)! > no.get(v.id)! ? t.and(who(other), who(v)) : t.and(who(v), who(other))) : t.and(who(v), 'main')
      line('conflict', c.at, t.conflictLine(pair, shortPath(c.path, cwd)), other ? [v.id, other.id] : [v.id], v.status === 'running' || other?.status === 'running')
    }
  }
  for (const v of views) {
    if (v.stall) {
      const idle = idleText(v.stall.idleMs)
      const body = v.stall.tool ? t.stallTool(who(v), idle, v.stall.tool) : t.stallSilent(who(v), idle, v.activity ? collapse(v.activity) : undefined)
      line('stall', v.lastEventAt ?? v.startedAt, body, [v.id], true, v.stall.level)
    }
  }
  for (const v of views) if (v.tier) line('tier', v.startedAt, t.tierLine(who(v), v.tier.want, v.tier.got), [v.id], v.status === 'running')
  for (const v of views) {
    if (v.denied === 0) continue
    const live = v.status === 'running'
    if (v.reasons.length === 0) line('denied', undefined, t.deniedLine(who(v), v.denied, t.noReason), [v.id], live)
    for (const r of v.reasons) line('denied', r.at, t.deniedLine(who(v), r.n, r.text), [v.id], live)
  }
  const when = (l: AlertLine) => l.at ?? Infinity
  return out
    .map((l, i) => ({ l, i }))
    .sort((a, b) => when(a.l) - when(b.l) || ORDER.indexOf(a.l.kind) - ORDER.indexOf(b.l.kind) || a.i - b.i)
    .map(x => x.l)
}

// The newest `max` lines of the timeline; the earlier ones are a count for the `+N more` line.
export function capAlerts(lines: readonly AlertLine[], max = 4): { shown: AlertLine[]; hidden: number } {
  const hidden = Math.max(0, lines.length - max)
  return { shown: lines.slice(hidden), hidden }
}

// The toasts still owed: a conflict or stall of an agent still running, once per agent per kind (`told` holds the `warned:<agentId>:<kind>` keys already done).
export function dueToasts(lines: readonly AlertLine[], told: ReadonlySet<string>): { keys: string[]; text: string }[] {
  const live = lines.filter(l => l.live && (l.kind === 'conflict' || l.kind === 'stall'))
  return live.map(l => ({ keys: l.ids.map(id => `warned:${id}:${l.kind}`), text: lineText(l) })).filter(d => !d.keys.every(k => told.has(k)))
}

// The alerts as shown: width-1 glyph flags for a row's Alerts cell, and the sentences of the Alerts block (in the UI language). Pure; tested in alertlines.test.ts.
import { idleText, shortPath } from './alerts'
import { agentRef, cellWidth, collapse } from './logic'
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

export type AlertLine = { kind: AlertKind; tag: string; label: string; color: string; body: string; ids: string[]; live: boolean }

export const lineText = (l: AlertLine): string => `${l.tag} ${l.label}  ${l.body}`

const GLYPH: Record<AlertKind, string> = { conflict: '!', stall: '~', tier: '≠', denied: '×' }

// One line per alert: conflicts (a pair and path once), stalls, tier mismatches, denials; agents still running first, then the kind order,
// then newest first. An agent is named `type"task"` (agentRef); a conflict pair names the older agent first.
export function alertLines(views: readonly View[], cwd: string, t: Strings): AlertLine[] {
  const no = new Map(views.map((v, i) => [v.id, i + 1]))
  const who = (v: View) => agentRef(v.type, v.task, t)
  const out: AlertLine[] = []
  const line = (kind: AlertKind, body: string, ids: string[], live: boolean, level?: 1 | 2) => {
    out.push({ kind, tag: GLYPH[kind], label: t.tag[kind], color: alertColor(kind, level), body, ids, live })
  }
  const seen = new Set<string>()
  for (const v of views) {
    for (const c of v.clashes) {
      const key = `${[v.id, c.other].sort().join('|')}|${c.path}`
      if (seen.has(key)) continue
      seen.add(key)
      const other = views.find(x => x.id === c.other)
      const pair = other ? (no.get(other.id)! > no.get(v.id)! ? t.and(who(other), who(v)) : t.and(who(v), who(other))) : t.and(who(v), 'main')
      line('conflict', t.conflictLine(pair, shortPath(c.path, cwd)), other ? [v.id, other.id] : [v.id], v.status === 'running' || other?.status === 'running')
    }
  }
  for (const v of views) {
    if (v.stall) {
      const idle = idleText(v.stall.idleMs)
      line('stall', v.stall.tool ? t.stallTool(who(v), idle, v.stall.tool) : t.stallSilent(who(v), idle, v.activity ? collapse(v.activity) : undefined), [v.id], true, v.stall.level)
    }
  }
  for (const v of views) if (v.tier) line('tier', t.tierLine(who(v), v.tier.want, v.tier.got), [v.id], v.status === 'running')
  for (const v of views) {
    if (v.denied === 0) continue
    const top = v.reasons.reduce<typeof v.reasons[number] | undefined>((m, r) => (m && m.n >= r.n ? m : r), undefined)
    line('denied', t.deniedLine(who(v), v.denied, top?.text ?? '(no reason)', v.reasons.length), [v.id], v.status === 'running')
  }
  return out
    .map((l, i) => ({ l, i }))
    .sort((a, b) => Number(b.l.live) - Number(a.l.live) || ORDER.indexOf(a.l.kind) - ORDER.indexOf(b.l.kind) || a.i - b.i)
    .map(x => x.l)
}

// At most `max` lines; the rest is a count for the `+N more` line.
export function capAlerts(lines: readonly AlertLine[], max = 4): { shown: AlertLine[]; hidden: number } {
  return { shown: lines.slice(0, max), hidden: Math.max(0, lines.length - max) }
}

// The toasts still owed: a conflict or stall of an agent still running, once per agent per kind (`told` holds the `warned:<agentId>:<kind>` keys already done).
export function dueToasts(lines: readonly AlertLine[], told: ReadonlySet<string>): { keys: string[]; text: string }[] {
  const live = lines.filter(l => l.live && (l.kind === 'conflict' || l.kind === 'stall'))
  return live.map(l => ({ keys: l.ids.map(id => `warned:${id}:${l.kind}`), text: lineText(l) })).filter(d => !d.keys.every(k => told.has(k)))
}

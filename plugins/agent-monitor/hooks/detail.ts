// The detail page of one subagent (select a row, Enter), read as a timeline: lines of colored segments, one section per kind of data,
// a section with nothing to say left out. Pure; tested in detail.test.ts.
import { shortPath } from './alerts'
import { alertClock, alertLines, flagSegs } from './alertlines'
import { formatMoney, tokenSplit } from './cost'
import type { Seg } from './alertlines'
import { GLYPH } from './layout'
import { agentRef, cellWidth, effortLabel, firstLines, formatClock, formatDuration, formatTokens, padEnd, padStart, resolveTier } from './logic'
import { PALETTE, effortStyle, modelColor, statusColor, typeStyle } from './palette'
import type { Strings } from './strings'
import type { View } from './views'

export const PROMPT_LINES = 3
export const RECENT_SHOWN = 10
export const RESULT_SHOWN = 5

const gray = (text: string): Seg => ({ text, color: PALETTE.gray })
const fg = (text: string): Seg => ({ text, color: PALETTE.fg })
const head = (label: string, extra = ''): Seg[] => [{ text: ` ${label}`, color: PALETTE.fg, bold: true }, gray(extra)]
const body = (text: string, color: string = PALETTE.fg): Seg[] => [fg('   '), { text, color }]

// Who a clash is with: `worker "Fix login…"` (type and task snippet), or `main`.
function peerName(id: string, peers: readonly View[], t: Strings): string {
  if (id === 'main') return 'main'
  const i = peers.findIndex(p => p.id === id)
  return i < 0 ? id : agentRef(peers[i]!.type, peers[i]!.task, t)
}

// The end clock: the recorded finish, else start + elapsed; none while running.
const endOf = (v: View): number | undefined => (v.status === 'running' ? undefined : (v.finishedAt ?? (v.startedAt !== undefined && v.elapsedMs !== undefined ? v.startedAt + v.elapsedMs : undefined)))

// The Tokens section: cache-hit input, other input (fresh + cache writes), output, and the estimated cost, numbers right-aligned.
function tokenLines(v: View, t: Strings): Seg[][] {
  const s = tokenSplit(v.spent!)
  const rows: [string, string][] = [[t.tokenRows.hit, formatTokens(s.hit)], [t.tokenRows.miss, formatTokens(s.miss)], [t.tokenRows.out, formatTokens(s.out)], [t.tokenRows.cost, `≈ ${formatMoney(v.cost)}`]]
  const labelW = Math.max(...rows.map(([l]) => cellWidth(l)))
  const numW = Math.max(...rows.map(([, n]) => cellWidth(n)))
  return rows.map(([l, n]) => body(`${padEnd(l, labelW)}  ${padStart(n, numW)}`))
}

// A timeline: title, Instruction, Steps (status and times, then the latest actions, oldest first), Edited files, Alerts (this agent's
// lines of the alert timeline: time and cause), then Tokens, Tools, Skills, Result. `peers` are all the views (newest first), to name
// the other side of a conflict.
export function detailLines(v: View, cwd: string, t: Strings, peers: readonly View[] = []): Seg[][] {
  const tier = resolveTier(v.model, v.effort, v.desc)
  const eff = effortLabel(tier.effort)
  const red = v.tier ? PALETTE.red : undefined
  const ts = typeStyle(v.type)
  const es = effortStyle(tier.effort)
  const lines: Seg[][] = [[
    fg(' '), { text: v.type, color: ts.color, bold: true }, gray(' · '),
    { text: tier.model ?? '—', color: red ?? modelColor(tier.model) },
    ...(eff ? [{ text: `.${eff}`, color: red ?? es.color, bold: red ? undefined : es.bold }] : []),
    gray(' · '), fg(v.task || '—'),
  ]]

  const prompt = firstLines(v.prompt ?? '', PROMPT_LINES).split('\n').filter(Boolean)
  if (prompt.length > 0) lines.push(head(t.sec.prompt), ...prompt.map(l => body(l)))

  const flags = flagSegs(v)
  const end = endOf(v)
  const when = [v.startedAt === undefined ? undefined : `${formatClock(v.startedAt)} → ${end === undefined ? (v.status === 'running' ? t.inProgress : '—') : formatClock(end)}`, v.elapsedMs === undefined ? undefined : t.took(formatDuration(v.elapsedMs)), v.rounds === undefined ? undefined : t.roundsN(v.rounds), v.longestStepMs === undefined ? undefined : t.longestStep(formatDuration(v.longestStepMs))]
  lines.push(head(t.sec.steps), [fg('   '), { text: `${GLYPH[v.status]} ${v.status}`, color: statusColor(v.status) }, gray(when.filter(Boolean).map(w => `   ${w}`).join('')), ...(flags.length > 0 ? [fg('   '), ...flags] : [])])
  for (const step of v.recent.slice(-RECENT_SHOWN)) lines.push([gray('   → '), fg(step)])

  if (v.files.length > 0 || v.editCount > 0) {
    lines.push(head(t.sec.files, ` ${v.editCount}`))
    if (v.files.length === 0) lines.push([gray(`   ✎ ${v.editCount} files · paths unknown`)])
    for (const f of v.files) {
      const st = v.fileLines[f]
      const mine = v.clashes.filter(c => c.path === f)
      lines.push([
        fg('   '), { text: `✎ ${shortPath(f, cwd)}`, color: mine.length > 0 ? PALETTE.red : PALETTE.fg },
        ...(st ? [gray('  '), { text: `+${st.add}`, color: PALETTE.green }, gray(' '), { text: `−${st.del}`, color: PALETTE.red }] : []),
        ...(mine.length > 0 ? [{ text: t.clashWith(mine.map(c => peerName(c.other, peers, t))), color: PALETTE.red }] : []),
      ])
    }
  }

  // This agent's lines of the alert timeline, drawn over all the views (this one in its own place) so a conflict names the other side.
  const all = peers.some(p => p.id === v.id) ? peers.map(p => (p.id === v.id ? v : p)) : [v, ...peers]
  const alerts = alertLines(all, cwd, t).filter(l => l.ids.includes(v.id))
  if (alerts.length > 0) {
    lines.push(head(t.sec.alerts), ...alerts.map(l => [gray(`   ${alertClock(l)}`), { text: ` ${l.tag} ${l.label}`, color: l.color, bold: true }, fg(`  ${l.body}`)]))
  }

  if (v.spent) lines.push(head('Tokens'), ...tokenLines(v, t))
  const tools = Object.entries(v.toolCounts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  if (tools.length > 0) lines.push(head(t.sec.tools), body(tools.map(([k, c]) => `${k} ${c}`).join(' · ')))
  if (v.skills.length > 0) lines.push(head(t.sec.skills), body(v.skills.join(' · ')))

  const result = firstLines(v.result ?? '', RESULT_SHOWN).split('\n').filter(Boolean)
  if (result.length > 0) lines.push(head(t.sec.result), ...result.map(l => body(l)))
  return lines
}

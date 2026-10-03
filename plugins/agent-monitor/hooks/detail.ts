// The detail page of one subagent (select a row, Enter): lines of colored segments, one section per kind of data, a section with
// nothing to say left out. Pure; tested in detail.test.ts.
import { shortPath, stallText } from './alerts'
import { flagSegs } from './alertlines'
import { formatMoney, tokenSplit } from './cost'
import type { Seg } from './alertlines'
import { GLYPH } from './layout'
import { agentRef, cellWidth, effortLabel, firstLines, formatClock, formatDuration, formatTokens, padEnd, padStart, resolveTier } from './logic'
import { PALETTE, alertColor, effortStyle, modelColor, statusColor, typeStyle } from './palette'
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

// Title, Instruction, Timeline, Tokens, Edited files, Tools, Skills, Recent actions, Alerts, Result. `peers` are all the views
// (newest first), to name the other side of a conflict.
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
  lines.push(head(t.sec.timeline), [fg('   '), { text: `${GLYPH[v.status]} ${v.status}`, color: statusColor(v.status) }, gray(when.filter(Boolean).map(w => `   ${w}`).join('')), ...(flags.length > 0 ? [fg('   '), ...flags] : [])])

  if (v.spent) lines.push(head('Tokens'), ...tokenLines(v, t))

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

  const tools = Object.entries(v.toolCounts).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  if (tools.length > 0) lines.push(head(t.sec.tools), body(tools.map(([k, c]) => `${k} ${c}`).join(' · ')))
  if (v.skills.length > 0) lines.push(head(t.sec.skills), body(v.skills.join(' · ')))
  if (v.recent.length > 0) lines.push(head(t.sec.recent), body(v.recent.slice(-RECENT_SHOWN).join(' → ')))

  const alerts: Seg[][] = []
  if (v.stall) alerts.push(body(stallText(v.stall, t), alertColor('stall', v.stall.level)))
  if (v.tier) alerts.push(body(t.tierShort(v.tier.want, v.tier.got), PALETTE.red))
  if (v.denied > 0) {
    alerts.push([fg('   '), { text: t.deniedShort(v.denied), color: PALETTE.red }])
    for (const r of v.reasons) alerts.push([fg('     '), { text: `×${r.n} `, color: PALETTE.red }, fg(r.text)])
  }
  if (alerts.length > 0) lines.push(head(t.sec.alerts), ...alerts)

  const result = firstLines(v.result ?? '', RESULT_SHOWN).split('\n').filter(Boolean)
  if (result.length > 0) lines.push(head(t.sec.result), ...result.map(l => body(l)))
  return lines
}

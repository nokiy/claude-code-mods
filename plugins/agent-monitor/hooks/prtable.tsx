// [POS] Drawing of the /sub PR mode: the `[PR] [Agent]` switch (hotkeys p / a) and the grouped table body (one row per PR group, a toggle
// Button that opens or closes it, its agents under it drawn by the table's own row). Grouping is groups.ts's; colors come from palette.ts.
import type { EngineInterface } from 'claude-code'

import { formatMoney } from './cost'
import { groupByPr, isOpen } from './groups'
import type { Group } from './groups'
import { cellWidth, formatDuration, padEnd, padStart, tokensOrDash, truncate } from './logic'
import type { Acts, Mode, PageCtx } from './pages'
import { PALETTE } from './palette'
import type { Strings } from './strings'
import type { Board, View } from './views'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const { fg, gray, green, purple, selBg } = PALETTE
const GAP = '  '
const STATE: Record<string, { text: string; color: string }> = { OPEN: { text: 'Open', color: green }, MERGED: { text: 'Merged', color: purple } }

/** Cells of the switch as drawn in the header: `[ PR ] [ Agent ]` plus the gap before it. */
export const SWITCH_W = 2 + 6 + 1 + 9

// The header's segmented control: the active mode is the primary Button, the other drawn dim.
export function modeSwitch(ui: Ui, mode: Mode, acts: Acts) {
  const { Box, Text, Button } = ui
  const seg = (m: Mode, label: string, hotkey: string) => (
    <Button key={`mode:${m}`} hotkey={hotkey} variant={mode === m ? 'primary' : undefined} dimColor={mode === m ? undefined : true} onPress={() => acts.mode(m)}>{label}</Button>
  )
  return <Box flexDirection="row"><Text>{'  '}</Text>{seg('pr', 'PR', 'p')}<Text>{' '}</Text>{seg('agent', 'Agent', 'a')}</Box>
}

// A group's columns: count, tokens, cost, time, PR state; each padded to the widest of all groups.
const statCols = (g: Group, t: Strings) => [t.agentsN(g.views.length), `${tokensOrDash(g.tokens)} tok`, g.cost === undefined ? '' : `≈ ${formatMoney(g.cost)}`, formatDuration(g.ms)]

/**
 * The PR-mode body: per group a row (toggle Button keyed `group:<key>`, `▾` open / `▸` closed; Enter flips it) and, when open, its agents
 * through `agentRow(view, autoFocus)`. The ring starts on the element that last held it when drawn, else on the first group's toggle.
 */
export function prRows(ui: Ui, board: Board, cols: number, ctx: PageCtx, acts: Acts, agentRow: (v: View, auto: boolean) => unknown) {
  const { Box, Text, Button } = ui
  const groups = groupByPr(board.views, board.prs?.prs ?? [], board.prs?.branch)
  const open = (g: Group) => isOpen(g.key, groups, ctx.expanded)
  const drawn = groups.flatMap(g => [`group:${g.key}`, ...(open(g) ? g.views.map(v => `row:${v.id}`) : [])])
  const auto = ctx.focusKey && drawn.includes(ctx.focusKey) ? ctx.focusKey : drawn[0]
  const cells = groups.map(g => statCols(g, board.t))
  const widths = cells[0]?.map((_, i) => Math.max(...cells.map(c => cellWidth(c[i]!)))) ?? []
  const stateW = Math.max(0, ...groups.map(g => cellWidth(STATE[g.pr?.state ?? '']?.text ?? '')))
  const statsW = widths.reduce((n, w) => n + w + GAP.length, 0) + stateW
  return groups.map((g, gi) => {
    const key = `group:${g.key}`
    const sel = ctx.ringKey === key
    const other = g.pr === undefined
    const title = truncate(other ? board.t.otherGroup : `#${g.pr!.number} ${g.pr!.title}`, Math.max(4, cols - 3 - GAP.length - statsW))
    const stats = cells[gi]!.map((c, i) => (i === 0 ? padEnd(c, widths[i]!) : padStart(c, widths[i]!))).join(GAP)
    const state = STATE[g.pr?.state ?? '']
    return (
      <Box key={key} flexDirection="column">
        <Box flexDirection="row" backgroundColor={sel ? selBg : undefined} hover={{ backgroundColor: selBg }}>
          <Text>{' '}</Text>
          <Button key={key} plain autoFocus={auto === key ? true : undefined} onPress={() => acts.fold(g.key, !open(g))}>{open(g) ? '▾' : '▸'}</Button>
          <Text wrap="truncate-end">
            <Text color={other ? gray : fg} bold={other ? undefined : true} italic={other ? true : undefined}>{` ${padEnd(title, Math.max(0, cols - 3 - GAP.length - statsW))}`}</Text>
            <Text color={gray}>{`${GAP}${stats}${GAP}`}</Text>
            <Text color={state?.color ?? gray}>{padEnd(state?.text ?? '', stateW)}</Text>
          </Text>
        </Box>
        {open(g) && g.views.map(v => agentRow(v, auto === `row:${v.id}`))}
      </Box>
    )
  })
}

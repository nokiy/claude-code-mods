// [POS] Drawing of the /sub PR mode: the `p: PR  a: Agent` switch, the groups' `Title` column header (PR mode's only header) and the grouped table
// body (one row per PR group, a toggle Button that opens or closes it, its agents under it drawn by the table's own row). Grouping is
// groups.ts's; colors come from palette.ts, words from strings.ts.
import type { EngineInterface, RenderChildren } from 'claude-code'

import { formatMoney } from './cost'
import { groupByPr, isOpen } from './groups'
import type { Group } from './groups'
import { cellWidth, formatDuration, padEnd, padStart, tokensOrDash, truncate } from './logic'
import { elementKey } from './nav'
import type { Acts, Mode, PageCtx } from './pages'
import { PALETTE } from './palette'
import { prState } from './prindex'
import type { PrState } from './prindex'
import type { Strings } from './strings'
import type { Board, View } from './views'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const { fg, gray, selBg } = PALETTE
const GAP = '  '
// pr-hint's state chip colors (plugins/pr-hint/hooks/card.ts STATE_COLOR): building, waiting on acceptance, done.
const STATE_COLOR: Record<PrState, string> = { draft: 'yellow', ready: 'magenta', merged: 'green' }
const LEAD = 3 // a blank, the 1-cell toggle Button, the blank before the title

/** Cells of the switch as drawn in the header: `p: PR  a: Agent` plus the gap before it. */
export const SWITCH_W = 2 + 5 + 2 + 8

// The header's switch, its hotkeys in sight: plain Buttons draw `p: PR  a: Agent` (hotkey in the accent color, as the footer's
// `b: back`); the inactive mode is dim. Tab never reaches a hooks pane (it moves the focus between Buttons), so p / a are the keys.
export function modeSwitch(ui: Ui, mode: Mode, acts: Acts, t: Strings) {
  const { Box, Text, Button } = ui
  const seg = (m: Mode, label: string, hotkey: string) => (
    <Button key={elementKey('mode', m)} hotkey={hotkey} plain dimColor={mode === m ? undefined : true} onPress={() => acts.mode(m)}>{label}</Button>
  )
  return <Box flexDirection="row"><Text>{'  '}</Text>{seg('pr', t.modes.pr, 'p')}<Text>{'  '}</Text>{seg('agent', t.modes.agent, 'a')}</Box>
}

// A group's columns: count, tokens, cost, time; the header names them. Each padded to the widest of the header and all groups.
const statCols = (g: Group, t: Strings) => [t.agentsN(g.views.length), t.tok(tokensOrDash(g.tokens)), g.cost === undefined ? '' : `≈ ${formatMoney(g.cost)}`, formatDuration(g.ms)]
const headCols = (t: Strings) => [t.prColumns.agents, t.prColumns.tokens, t.prColumns.cost, t.prColumns.time]
const joinCols = (cells: readonly string[], widths: readonly number[]) => cells.map((c, i) => (i === 0 ? padEnd(c, widths[i]!) : padStart(c, widths[i]!))).join(GAP)

/**
 * The PR-mode body: the `Title` column header, then per group a row (toggle Button keyed `group:<key>`, `▾` open / `▸` closed; Enter
 * flips it) and, when open, its agents through `agentRow(view, autoFocus)`. The ring starts on the element that last held it when
 * drawn, else on the first group's toggle.
 */
export function prRows(ui: Ui, board: Board, cols: number, ctx: PageCtx, acts: Acts, agentRow: (v: View, auto: boolean) => RenderChildren) {
  const { Box, Text, Button } = ui
  const t = board.t
  const groups = groupByPr(board.views, board.prs?.prs ?? [], board.prs?.branch)
  const open = (g: Group) => isOpen(g.key, groups, ctx.expanded)
  const drawn = groups.flatMap(g => [elementKey('group', g.key), ...(open(g) ? g.views.map(v => elementKey('row', v.id)) : [])])
  const auto = ctx.focusKey && drawn.includes(ctx.focusKey) ? ctx.focusKey : drawn[0]
  const cells = groups.map(g => statCols(g, t))
  const head = headCols(t)
  const widths = head.map((h, i) => Math.max(cellWidth(h), ...cells.map(c => cellWidth(c[i]!))))
  const stateW = Math.max(cellWidth(t.prColumns.state), ...groups.map(g => cellWidth(g.pr ? t.prState[prState(g.pr)] : '')))
  const statsW = widths.reduce((n, w) => n + w + GAP.length, 0) + stateW
  const titleW = Math.max(0, cols - LEAD - GAP.length - statsW)
  const header = (
    <Text key="group-columns" color={gray} wrap="truncate-end">
      {`${' '.repeat(LEAD)}${padEnd(t.prColumns.title, titleW)}${GAP}${joinCols(head, widths)}${GAP}${padEnd(t.prColumns.state, stateW)}`}
    </Text>
  )
  const rows = groups.map((g, gi) => {
    const key = elementKey('group', g.key)
    const sel = ctx.ringKey === key
    const other = g.pr === undefined
    const title = truncate(other ? t.otherGroup : `#${g.pr!.number} ${g.pr!.title}`, Math.max(4, titleW))
    const state = g.pr ? prState(g.pr) : undefined
    return (
      <Box key={key} flexDirection="column">
        <Box flexDirection="row" backgroundColor={sel ? selBg : undefined} hover={{ backgroundColor: selBg }}>
          <Text>{' '}</Text>
          <Button key={key} plain autoFocus={auto === key ? true : undefined} onPress={() => acts.fold(g.key, !open(g))}>{open(g) ? '▾' : '▸'}</Button>
          <Text wrap="truncate-end">
            <Text color={other ? gray : fg} bold={other ? undefined : true} italic={other ? true : undefined}>{` ${padEnd(title, titleW)}`}</Text>
            <Text color={gray}>{`${GAP}${joinCols(cells[gi]!, widths)}${GAP}`}</Text>
            <Text color={state ? STATE_COLOR[state] : gray}>{padEnd(state ? t.prState[state] : '', stateW)}</Text>
          </Text>
        </Box>
        {open(g) && g.views.map(v => agentRow(v, auto === elementKey('row', v.id)))}
      </Box>
    )
  })
  return [header, ...rows]
}

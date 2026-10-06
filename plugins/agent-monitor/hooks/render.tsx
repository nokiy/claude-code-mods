// Drawing for agent-monitor: the live rows in the band above the prompt, the history table (a select Button per row, the ringed row banded) and the alerts block;
// `panel` picks the page (table, detail, settings) for a site (band or pane). Colors come from palette.ts.
import type { EngineInterface, RenderElement } from 'claude-code'

import { alertLines, capAlerts, flagSegs, segsWidth } from './alertlines'
import { capRows, cellWidth, collapse, fitRow, formatDuration, resolveTier, tierName, tokensOrDash } from './logic'
import type { Strings } from './strings'
import type { Board, View } from './views'
import { computeLayout, headerCells, headerSegs, isSelected, markLabel, rowParts, rowText, rule } from './layout'
import type { Cell } from './layout'
import { detailPage, footer, segText, settingsPage } from './pages'
import type { Acts, PageCtx } from './pages'
import { PALETTE, effortStyle, modelColor, statusColor, tokenColor, typeStyle } from './palette'
import { SWITCH_W, modeSwitch, prRows } from './prtable'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const { fg, gray, red, selBg } = PALETTE

// One band row per running agent, `+N more` when they do not all fit. `alerts`: end each row with its alert glyphs.
export function bandRows(ui: Ui, running: View[], cols: number, maxRows: number, alerts: boolean, t: Strings) {
  const { Box, Text } = ui
  const { shown, hidden } = capRows(running.length, maxRows)
  const rows = running.slice(0, shown).map(v => {
    const tier = tierName(v.model, v.effort, v.desc)
    const time = v.elapsedMs === undefined ? '—' : formatDuration(v.elapsedMs)
    const flags = alerts ? flagSegs(v) : []
    const stats = `${tokensOrDash(v.tokens)} tok · ${time}`
    const fixed = cellWidth(`◐ ${v.type} · ${tier} · `) + cellWidth(stats) + (flags.length > 0 ? 3 + segsWidth(flags) : 0)
    const fit = fitRow(cols, fixed, v.task, collapse(v.activity ?? t.starting))
    const ts = typeStyle(v.type)
    return (
      <Text key={v.id} wrap="truncate-end">
        <Text color={statusColor('running')}>◐ </Text>
        <Text color={ts.color} bold>{v.type}</Text>
        <Text color={gray}>{' · '}</Text>
        <Text color={v.tier ? red : modelColor(resolveTier(v.model, v.effort, v.desc).model)}>{tier}</Text>
        <Text color={gray}>{' · '}</Text>
        <Text color={fg}>{fit.task}</Text>
        <Text>{'   '}</Text>
        <Text color={gray} italic>{fit.activity}</Text>
        <Text>{'   '}</Text>
        <Text color={tokenColor(v.tokens)}>{tokensOrDash(v.tokens)}</Text>
        <Text color={gray}>{` tok · ${time}`}</Text>
        {flags.length > 0 && <Text>{'   '}</Text>}
        {segText(Text, flags)}
      </Text>
    )
  })
  return { rows, more: hidden > 0 ? <Text color={gray}>{`  +${hidden} more`}</Text> : null, Box }
}

const cell = (Text: Ui['Text'], c: Cell, i: number, header = false) => {
  const key = String(i)
  if (header) return <Text key={key} color={gray}>{c.text}</Text>
  switch (c.kind) {
    case 'status': return <Text key={key} color={statusColor(c.status ?? 'done')}>{c.text}</Text>
    case 'type': { const s = typeStyle(c.key ?? ''); return <Text key={key} color={s.color} bold>{c.text}</Text> }
    case 'model': return <Text key={key} color={c.bad ? red : modelColor(c.key)}>{c.text}</Text>
    case 'effort': { const s = effortStyle(c.key); return <Text key={key} color={c.bad ? red : s.color} bold={c.bad ? undefined : s.bold}>{c.text}</Text> }
    case 'task': return <Text key={key} color={c.status === 'failed' ? gray : fg}>{c.text}</Text>
    case 'tokens': return <Text key={key} color={tokenColor(c.n)}>{c.text}</Text>
    case 'alerts': return <Text key={key} color={c.color ?? fg}>{c.text}</Text>
    default: return <Text key={key} color={gray}>{c.text}</Text> // index, edits, rounds, time
  }
}

const CLOSE_W = 11 // two blanks and `[ close ]`

// The Alerts block: up to four sentences, `+N more` after them; nothing when there are none.
function alertsBlock(ui: Ui, board: Board) {
  const { Box, Text } = ui
  const { shown, hidden } = capAlerts(alertLines(board.views, board.cwd, board.t))
  if (shown.length === 0) return null
  return (
    <Box flexDirection="column">
      {shown.map((l, i) => (
        <Text key={String(i)} wrap="truncate-end">
          <Text color={l.color} bold>{` ${l.tag} ${l.label}`}</Text>
          <Text color={fg}>{`  ${l.body}`}</Text>
        </Text>
      ))}
      {hidden > 0 && <Text color={gray}>{`   +${hidden} more`}</Text>}
    </Box>
  )
}

// The table's footer: the hint (only with rows to pick), `s: settings`, how to close (the header's `[ close ]` is there only with rows).
function listFooter(ui: Ui, ctx: PageCtx, acts: Acts, rows: boolean, t: Strings) {
  const x = { hotkey: 'x', label: t.close, onPress: acts.close } as const
  const settings = { hotkey: 's', label: t.settings, onPress: acts.settings } as const
  return footer(ui, rows ? [t.listHint, settings, t.modeHint, ctx.esc ? t.escClose : t.xClose] : [' ', settings, ' · ', x, ctx.esc ? ' · Esc' : ''])
}

// The history table: header with `[ close ]` (hotkey x), alerts block, rule, column header, one row per agent led by a 1-cell select Button
// (`▸` while the ring is on it; Enter opens its detail; the Button of the row that held the focus, else the first, takes the ring). The row
// the ring is on (ctx.ringKey) is banded with selBg, any row on hover; running ones carry their activity line. Then rule, footer.
export function historyTable(ui: Ui, board: Board, cols: number, ctx: PageCtx, acts: Acts) {
  const { Box, Text, Button } = ui
  const { views, cfg, t } = board
  if (views.length === 0) {
    return (
      <Box flexDirection="column">
        <Text color={gray}>{t.noAgents}</Text>
        {listFooter(ui, ctx, acts, false, t)}
      </Box>
    )
  }

  const texts = views.map(rowText)
  const layout = computeLayout(cols, texts, cfg.columns)
  const held = views.findIndex(v => ctx.focusKey === `row:${v.id}`)
  const first = Math.max(0, held)
  const mode = ctx.mode ?? 'pr'
  const agentRow = (v: View, auto: boolean) => {
    const p = rowParts(layout, texts[views.indexOf(v)]!)
    const sel = isSelected(ctx.ringKey, v.id)
    return (
      <Box key={v.id} flexDirection="column">
        <Box flexDirection="row" backgroundColor={sel ? selBg : undefined} hover={{ backgroundColor: selBg }}>
          <Text>{p.lead}</Text>
          <Button key={`row:${v.id}`} plain autoFocus={auto ? true : undefined} onPress={() => acts.open(v.id)}>{markLabel(sel)}</Button>
          <Text wrap="truncate-end">{p.rest.map((c, j) => cell(Text, c, j))}</Text>
        </Box>
        {v.status === 'running' && <Text color={gray} italic wrap="truncate-end">{`       ↳ ${collapse(v.activity ?? t.starting)}`}</Text>}
      </Box>
    )
  }
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text wrap="truncate-end">
          {headerSegs(cols - CLOSE_W - SWITCH_W, views).map((s, i) => (
            <Text key={String(i)} bold={s.bold} color={s.color}>{s.text}</Text>
          ))}
        </Text>
        {modeSwitch(ui, mode, acts)}
        <Text>{'  '}</Text>
        <Button key="close" hotkey="x" onPress={acts.close}>{t.close}</Button>
      </Box>
      {cfg.alertsBlock && alertsBlock(ui, board)}
      <Text color={gray}>{rule(cols)}</Text>
      <Text wrap="truncate-end">{headerCells(layout).map((c, i) => cell(Text, c, i, true))}</Text>
      {mode === 'agent' ? views.map((v, i) => agentRow(v, i === first)) : prRows(ui, board, cols, ctx, acts, agentRow)}
      <Text color={gray}>{rule(cols)}</Text>
      {listFooter(ui, ctx, acts, true, t)}
    </Box>
  )
}

// What a site (band or pane) shows: the settings page, the detail page of the agent `ctx.page` names while it is still listed, else the table.
export function panel(ui: Ui, board: Board, ctx: PageCtx, cols: number, acts: Acts) {
  const { page } = ctx
  if (page.kind === 'settings') return settingsPage(ui, board.cfg, ctx.draft, cols, acts, ctx.esc, board.t)
  const index = page.kind === 'detail' ? board.views.findIndex(v => v.id === page.id) : -1
  return index >= 0 ? detailPage(ui, board, index, cols, acts, ctx.esc) : historyTable(ui, board, cols, ctx, acts)
}

// The tree of the band above the prompt, `rest` (the chain's own drawing) under it: the panel while it is open there,
// else one row per running agent. null when there is nothing to show.
export function bandTree(ui: Ui, board: Board, props: { bodyColumns: number; maxRows: number }, open: boolean, ctx: PageCtx, acts: Acts, rest: RenderElement) {
  const { Box } = ui
  const running = board.cfg.autoBand ? board.views.filter(v => v.status === 'running') : []
  if (!open && running.length === 0) return null
  const { rows, more } = bandRows(ui, open ? [] : running, props.bodyColumns, props.maxRows, board.cfg.columns.alerts, board.t)
  return (
    <Box flexDirection="column">
      {open ? panel(ui, board, ctx, props.bodyColumns, acts) : rows}
      {more}
      {rest}
    </Box>
  )
}

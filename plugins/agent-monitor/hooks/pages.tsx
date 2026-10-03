// Drawing for agent-monitor's two pages beside the table: the detail page of one agent and the settings page, plus the footers all pages share.
import type { EngineInterface } from 'claude-code'

import type { Seg } from './alertlines'
import type { Config } from './config'
import { detailLines } from './detail'
import { rule } from './layout'
import type { Page } from './nav'
import { PALETTE } from './palette'
import { ROWS, draftFromConfig, isDirty, rowLabel } from './settings'
import type { Draft, SettingKey } from './settings'
import type { Strings } from './strings'
import type { Board } from './views'

type Ui = ReturnType<EngineInterface['ui']['resolve']>

const { fg, gray, amber } = { fg: PALETTE.fg, gray: PALETTE.gray, amber: PALETTE.amber }

// What a button does; the hooks build these over `$`, so the drawing never sees the engine.
export type Acts = {
  open: (id: string) => void
  back: () => void
  settings: () => void
  close: () => void
  toggle: (key: SettingKey) => void
  save: () => void
}

// What a site draws from beside the board: the page, the settings draft, the last row that held the ring (to restore it), the element
// the ring is on now (`ringKey`, null off any element; drives the row highlight), whether Esc closes (the pane).
export type PageCtx = { page: Page; draft: Draft | null; focusKey: string | null; ringKey: string | null; esc: boolean }

export const segText = (Text: Ui['Text'], segs: readonly Seg[]) =>
  segs.map((s, i) => <Text key={String(i)} color={s.color} bold={s.bold} italic={s.italic}>{s.text}</Text>)

// A footer line: gray text and plain hotkey Buttons (the terminal draws `b: back`) in one row.
export type Part = string | { hotkey: string; label: string; onPress: () => void }
export function footer(ui: Ui, parts: readonly Part[]) {
  const { Box, Text, Button } = ui
  return (
    <Box flexDirection="row">
      {parts.filter(p => p !== '').map((p, i) => (typeof p === 'string'
        ? <Text key={String(i)} color={gray}>{p}</Text>
        : <Button key={`hk:${p.hotkey}`} hotkey={p.hotkey} plain onPress={p.onPress}>{p.label}</Button>))}
    </Box>
  )
}

// `b: back · x: close`, then ` · Esc` where Esc closes too.
const navFooter = (ui: Ui, acts: Acts, esc: boolean, t: Strings) =>
  footer(ui, [' ', { hotkey: 'b', label: t.back, onPress: acts.back }, ' · ', { hotkey: 'x', label: t.close, onPress: acts.close }, esc ? ' · Esc' : ''])

// The detail page of the agent at `index`: every section of detailLines, untruncated.
export function detailPage(ui: Ui, board: Board, index: number, cols: number, acts: Acts, esc: boolean) {
  const { Box, Text } = ui
  const [title = [], ...rest] = detailLines(board.views[index]!, board.cwd, board.t, board.views)
  return (
    <Box flexDirection="column">
      <Text>{segText(Text, title)}</Text>
      <Text color={gray}>{rule(cols)}</Text>
      {rest.map((l, i) => <Text key={String(i)}>{segText(Text, l)}</Text>)}
      <Text color={gray}>{rule(cols)}</Text>
      {navFooter(ui, acts, esc, board.t)}
    </Box>
  )
}

// The settings page: one Button per row (Enter changes the draft), `[ Save ]` writes it, `b` drops it.
export function settingsPage(ui: Ui, cfg: Config, draft: Draft | null, cols: number, acts: Acts, esc: boolean, t: Strings) {
  const { Box, Text, Button } = ui
  const d = draft ?? draftFromConfig(cfg)
  return (
    <Box flexDirection="column">
      <Box flexDirection="row">
        <Text bold color={fg}>{t.settingsTitle}</Text>
        <Text color={gray}>{t.settingsSub}</Text>
        {isDirty(d, cfg) && <Text color={amber}>{t.unsaved}</Text>}
        <Text>{'  '}</Text>
        <Button key="save" hotkey="w" variant="primary" onPress={acts.save}>{t.save}</Button>
      </Box>
      <Text color={gray}>{rule(cols)}</Text>
      {ROWS.map((r, i) => (
        <Button key={`set:${r.key}`} plain autoFocus={i === 0 ? true : undefined} onPress={() => acts.toggle(r.key)}>{rowLabel(r, d, t)}</Button>
      ))}
      <Text color={gray}>{rule(cols)}</Text>
      {navFooter(ui, acts, esc, t)}
      <Text color={gray}>{t.settingsHint}</Text>
    </Box>
  )
}

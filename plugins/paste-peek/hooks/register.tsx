import { atom, read, update } from 'claude-code'
import type { EngineInterface, ImageSource, Register } from 'claude-code'

import type { PixelMode, Shot, ZoomSite } from '../types'
import {
  DEFAULT_ASPECT, DIR, LOG, MEASURE_CELL, TINY_PNG,
  caption, fit, imageFile, imageRoots, keep, parkCursor, parseCellAspect, pick, placeholders, pngSize, probeLine, saysNoPixels, stripRows,
} from './logic'
import { pickLang, strings } from './strings'
import type { Strings } from './strings'

const PANE = 'paste-peek'
const POLL_MS = 300
const HISTORY = 10
const PROBE_TRIES = 3
const PNG_EDGE = 1600 // longest side sent as base64 when the terminal cannot read files

// Borrowed diff-panel actions: their chords (⌥↑ / ⌥↓, ctrl+↑ / ctrl+↓ by default) press
// these Buttons straight from the prompt while no diff panel is open to handle them.
// ⌥← / ⌥→ are taken in prompt.edit instead, and only while the draft holds two or more pictures.
const ZOOM_ACTION = 'app:diffFileListUp'
const RIGHT_ACTION = 'app:diffFileListDown'

const shots = atom({ plugin: 'paste-peek', key: 'shots' } as const, [])
const history = atom({ plugin: 'paste-peek', key: 'history' } as const, [])
const zoom = atom({ plugin: 'paste-peek', key: 'zoom' } as const, null)
const selected = atom({ plugin: 'paste-peek', key: 'selected' } as const, null)
const zoomOpen = atom({ plugin: 'paste-peek', key: 'zoomOpen' } as const, null)
const pixelMode = atom({ plugin: 'paste-peek', key: 'pixelMode' } as const, null)
const probeReason = atom({ plugin: 'paste-peek', key: 'probeReason' } as const, null)

// Module vars reset on reload; session.start sets them again.
let timer: { cancel: () => void } | undefined
let isDebug = false
let langOption: unknown = 'auto'
let t: Strings = strings('en')
let sessionDir = `${DIR}/unknown` // the probe sentinel and scaled fallback files of this session only
let isPolling = false
let probeTries = 0
let isProbing = false
const pngCache = new Map<string, string>()
let cellAspect = DEFAULT_ASPECT
let measuredAt: number | undefined
let lastBody = 0 // the band's width, for the pane's requested width

const probeFile = () => `${sessionDir}/probe.png`
const paneColumns = () => Math.max(40, Math.floor(lastBody * 0.6))

/** One line to the debug log, only when "Debug log" is on in /config. */
async function note($: EngineInterface, line: string) {
  if (!isDebug) return
  const at = new Date(await $.clock.now()).toTimeString().slice(0, 8)
  await $.process.run(['/bin/sh', '-c', 'mkdir -p "$1" && printf "%s\\n" "$2" >> "$3"', 'sh', DIR, `${at} ${line}`, LOG])
}

// ── the draft and Claude Code's saved pictures ───────────────────────

const imageDirs = new Map<string, string>() // session id -> its images dir
let uid: string | undefined

/**
 * <tmp root>/<project folder>/<session id>/images. The project folder encodes a cwd that may
 * have moved, so scan the root's folders for the session id; undefined until Claude Code made it.
 */
async function imagesDir($: EngineInterface): Promise<string | undefined> {
  const session = await $.session.id()
  const known = imageDirs.get(session)
  if (known) return known
  uid ??= (await $.process.run(['id', '-u'])).stdout.trim()
  for (const root of imageRoots(await $.env.get('CLAUDE_CODE_TMPDIR'), uid)) {
    for (const entry of await $.fs.list(root).catch(() => [])) {
      const dir = `${root}/${entry.name}/${session}/images`
      if (entry.kind === 'dir' && (await $.fs.exists(dir))) {
        imageDirs.set(session, dir)
        return dir
      }
    }
  }
}

/**
 * The picture of draft placeholder n, or undefined while its file is not there (or not yet a PNG
 * header): the next poll looks again. Over the read cap the size stays unknown (0), layout falls back.
 */
async function loadShot($: EngineInterface, n: number): Promise<Shot | undefined> {
  const dir = await imagesDir($)
  const file = dir && imageFile(dir, n)
  if (!file || !(await $.fs.exists(file))) return undefined
  const head = await $.fs.read(file, { as: 'bytes' }).then(r => r.base64, () => undefined)
  const size = head === undefined ? { width: 0, height: 0 } : pngSize(head)
  return size ? { n, file, ...size } : undefined
}

/**
 * One poll of this session's draft: each [Image #N] without a shot yet takes the file Claude Code
 * saved for it (none yet: looked for again next poll); a placeholder gone from the draft drops its shot.
 */
async function poll($: EngineInterface) {
  if (isPolling || (await read($, pixelMode)) === 'none') return
  isPolling = true
  try {
    const draft = (await $.prompt.read()).text
    const have = new Set((await read($, shots)).map(s => s.n))
    const wanted = [...new Set(placeholders(draft))].filter(n => !have.has(n))
    const got = (await Promise.all(wanted.map(n => loadShot($, n)))).filter(s => s !== undefined)
    for (const s of got) await note($, `pasted ${caption(s.n)} ${s.width}x${s.height}`)
    await update($, shots, list => keep([...list, ...got], draft))
  } finally {
    isPolling = false
  }
}

function ensureTimer($: EngineInterface) {
  timer ??= $.clock.every(POLL_MS, () => void poll($))
}

// ── pixels: probed once per session, real pictures only ──────────────

/** The PNG as base64, its longest side cut until it fits the 2 MiB Image cap. */
async function pngFor($: EngineInterface, file: string): Promise<string | null> {
  const hit = pngCache.get(file)
  if (hit) return hit
  for (let edge = PNG_EDGE; edge >= 200; edge = Math.floor(edge / 2)) {
    const small = `${sessionDir}/scaled-${edge}-${file.split('/').slice(-3).join('_')}`
    const scaled = await $.process.run(['sips', '-Z', String(edge), file, '--out', small])
    if (scaled.exitCode !== 0) return null
    const { base64 } = await $.fs.read(small, { as: 'bytes' })
    if (base64.length <= 2_700_000) {
      pngCache.set(file, base64)
      return base64
    }
  }
  return null
}

async function sourceFor($: EngineInterface, mode: PixelMode | null, file: string): Promise<ImageSource | null> {
  if (mode === 'file') return { file, format: 'png' }
  if (mode === 'png') {
    const png = await pngFor($, file)
    return png ? { png } : null
  }
  return null
}

/**
 * Ask the engine whether an Image draws pixels here: blit the mounted 1×1
 * sentinel, first as a file, then as bytes. A deny about drawing at all
 * settles 'none'; any other deny is retried on a later render.
 */
async function probePixels($: EngineInterface, requestId: string) {
  try {
    const byFile = await $.ui.blit({ requestId, key: 'probe', source: { file: probeFile(), format: 'png', generation: probeTries + 1 } })
    if (byFile.deny === undefined) return await settle($, 'file', 'file drawn')
    const byPng = await $.ui.blit({ requestId, key: 'probe', source: { png: TINY_PNG } })
    if (byPng.deny === undefined) return await settle($, 'png', `file denied (${byFile.deny}), png drawn`)
    const isSettled = saysNoPixels(byFile.deny) || saysNoPixels(byPng.deny ?? '') || ++probeTries >= PROBE_TRIES
    if (isSettled) return await settle($, 'none', `file (${byFile.deny}) / png (${byPng.deny})`)
    await note($, `pixel probe inconclusive, retry: ${byFile.deny}`)
  } finally {
    isProbing = false
  }
}

async function settle($: EngineInterface, mode: PixelMode, reason: string) {
  await update($, pixelMode, () => mode)
  await update($, probeReason, () => reason)
  await note($, `pixel probe -> ${mode} · ${reason}`)
}

/** While unprobed: true when a render should mount the sentinel; the probe is scheduled once per try. */
function wantsProbe($: EngineInterface, requestId: string, mode: PixelMode | null): boolean {
  if (mode !== null) return false
  if (!isProbing) {
    isProbing = true
    $.clock.after(500, () => void probePixels($, requestId))
  }
  return true
}

/**
 * Measure the terminal's cell shape again when the width changed (a font zoom changes both).
 * The cell measurement follows hedingerm/image-preview (MIT), which follows Grok Build.
 */
async function syncCellAspect($: EngineInterface, columns: number) {
  if (columns === measuredAt) return
  measuredAt = columns
  const r = await $.process.run(['python3', '-c', MEASURE_CELL], { timeoutMs: 5000 })
  const measured = parseCellAspect(r.stdout)
  if (measured === undefined || Math.abs(measured - cellAspect) < 0.01) return
  cellAspect = measured
  $.ui.invalidate('ui.render')
}

// ── keys: selection and 放大 ─────────────────────────────────────────

/** The image the keys act on: the selected one, else the newest. */
async function current($: EngineInterface): Promise<Shot | undefined> {
  const list = await read($, shots)
  const n = await read($, selected)
  return list.find(s => s.n === n) ?? list.at(-1)
}

/** ⌥← / ⌥→: move the selection by step (wrapping); an open 放大 follows it. */
async function selectBy($: EngineInterface, step: number) {
  const list = await read($, shots)
  if (list.length === 0) return
  const sel = await read($, selected)
  const at = Math.max(0, list.findIndex(s => s.n === sel))
  const next = list[(at + step + list.length) % list.length]
  if (!next) return
  await update($, selected, () => next.n)
  const site = await read($, zoomOpen)
  if (site !== null) await update($, zoom, () => next.n)
  if (site === 'right') await $.ui.open({ id: PANE, title: `Image #${next.n}`, columns: paneColumns() })
}

/** ⌥↑ (center) / ⌥↓ (right): show the selected image there, or close it when it is already there. */
async function toggleZoom($: EngineInterface, site: ZoomSite) {
  const open = await read($, zoomOpen)
  if (open === site) return closeZoom($)
  const s = await current($)
  if (!s) return
  await update($, zoom, () => s.n)
  await update($, zoomOpen, () => site)
  if (site === 'right') await $.ui.open({ id: PANE, title: `Image #${s.n}`, columns: paneColumns() })
  else if (open === 'right') await $.ui.close({ id: PANE })
}

async function closeZoom($: EngineInterface) {
  const open = await read($, zoomOpen)
  await update($, zoomOpen, () => null)
  if (open === 'right') await $.ui.close({ id: PANE })
}

export const register: Register = (on, options) => {
  isDebug = options.debug === true
  langOption = options.language

  on('session.start', async ($, e, next) => {
    const settings = await $.settings.read()
    t = strings(pickLang(langOption, settings.language, await $.env.get('LANG')))
    sessionDir = `${DIR}/${await $.session.id()}`
    await $.command.register({ name: 'peek', description: `Pasted-image preview: ${t.usage}` })
    // The sentinel the pixel probe blits, in this session's own temp dir.
    await $.process.run(['/bin/sh', '-c', 'mkdir -p "$1" && printf "%s" "$2" | base64 -D > "$3"', 'sh', sessionDir, TINY_PNG, probeFile()])
    const kind = (await $.env.get('CLAUDE_CODE_SESSION_KIND')) ?? 'foreground'
    await note($, `session start ${await $.session.id()} · ${kind} · ${(await $.env.get('TERM_PROGRAM')) ?? '?'}`)
    ensureTimer($)
    return next(e)
  })

  // The session's probe and scaled files are deleted when it ends; /clear keeps the session, so keeps them.
  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear') await $.process.run(['rm', '-rf', sessionDir])
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const sent = await read($, shots)
    if (sent.length > 0) {
      await note($, probeLine('submit', { placeholders: placeholders(e.text) }))
      await update($, history, list => [...list, ...sent].slice(-HISTORY))
    }
    await update($, shots, () => [])
    await update($, selected, () => null)
    if ((await read($, zoomOpen)) !== null) await closeZoom($)
    return next(e)
  })

  on('command.run', { command: 'peek' }, async ($, e) => {
    ensureTimer($)
    const verb = e.args.trim().split(/\s+/)[0] ?? ''
    if (verb === 'log') {
      if (!isDebug) return { text: t.debugOff }
      const r = await $.process.run(['tail', '-n', '30', LOG])
      return { text: r.stdout.trim() || LOG }
    }
    if (verb === 'why') {
      return { text: `pixel mode: ${(await read($, pixelMode)) ?? t.notProbed}\n${(await read($, probeReason)) ?? ''}`.trim() }
    }
    if (verb === 'clear') {
      await update($, shots, () => [])
      await update($, history, () => [])
      await update($, pixelMode, () => null)
      await update($, probeReason, () => null)
      probeTries = 0
      return { text: t.cleared }
    }
    if (verb !== '') return { text: `${t.unknown}: /peek ${verb}\n${t.usage}` }
    await update($, zoom, () => null)
    await $.ui.open({ id: PANE, title: 'paste-peek', focus: true, closeOnEscape: true })
    return { text: 'paste-peek' }
  })

  // ⌥← / ⌥→ switch pictures (two or more); with one, ⌥→ opens it on the right and ⌥← stays a word jump.
  on('prompt.edit', async ($, e, next) => {
    const k = e.key
    if (!k || placeholders(e.text).length === 0) return next(e)
    const count = (await read($, shots)).length
    if (count === 0) return next(e)
    const name = k.key.toLowerCase()
    const isLeft = k.meta === true && !k.ctrl && name.includes('left')
    const isRight = k.meta === true && !k.ctrl && name.includes('right')
    if ((isLeft || isRight) && count > 1) {
      await note($, `switch ${isLeft ? '⌥←' : '⌥→'} at ${e.cursor}/${e.text.length}`)
      await selectBy($, isLeft ? -1 : 1)
      return parkCursor(e.text, e.cursor)
    }
    if (isRight && count === 1) {
      await toggleZoom($, 'right')
      return { text: e.text, cursor: e.cursor }
    }
    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && (await read($, zoomOpen)) === 'right') await update($, zoomOpen, () => null)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    ensureTimer($)
    if (e.props.hasSurvey || e.surface !== 'terminal') return next(e)
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    const mode = await read($, pixelMode)
    const below = await next(e)
    // Unprobed: mount only the 1×1 sentinel the probe blits (alt is a blank).
    if (wantsProbe($, e.requestId, mode)) {
      return (
        <Box flexDirection="column">
          <Image key="probe" source={{ file: probeFile(), format: 'png' }} columns={1} rows={1} alt=" " />
          {below}
        </Box>
      )
    }
    if (mode === 'none') return below

    const list = await read($, shots)
    const sel = await current($)
    if (list.length === 0 || !sel) return below
    const body = Math.max(20, e.props.bodyColumns)
    lastBody = body
    void syncCellAspect($, body)
    const site = await read($, zoomOpen)
    const isCenter = site === 'center'

    const picture = async (s: Shot, maxCols: number, maxRows: number, key: string) => {
      const { columns, rows } = fit(s.width, s.height, maxCols, maxRows, cellAspect)
      const source = await sourceFor($, mode, s.file)
      return source ? <Image key={key} source={source} columns={columns} rows={rows} alt={caption(s.n)} /> : <Text dimColor>{caption(s.n)}</Text>
    }
    // One line of keys; they are Buttons so the borrowed chords press them from the prompt.
    const keys = (
      <Box gap={2} justifyContent={isCenter ? 'center' : 'flex-start'}>
        <Button key="zoom" label={isCenter ? t.zoomClose : t.zoom} hotkey="z" action={ZOOM_ACTION} plain autoFocus onPress={() => void toggleZoom($, 'center')} />
        <Button key="right" label={site === 'right' ? t.sideClose : t.side} hotkey="r" action={RIGHT_ACTION} plain onPress={() => void toggleZoom($, 'right')} />
        {list.length > 1 && <Text color="suggestion">{t.switch}</Text>}
      </Box>
    )

    if (isCenter) {
      // The selected image alone, as large as the band allows (the band is capped near half the screen), centered.
      const room = Math.max(3, e.props.maxRows - 2)
      return (
        <Box flexDirection="column">
          <Box justifyContent="center">{await picture(sel, body - 2, room, `big${sel.n}`)}</Box>
          <Box justifyContent="center" gap={2}>
            <Text>{caption(sel.n)}</Text>
            {keys}
          </Box>
          {below}
        </Box>
      )
    }

    // Small thumbnails side by side; selection changes only the caption's color, so nothing moves.
    const thumbCols = Math.max(8, Math.min(24, Math.floor((body - 2 * list.length) / list.length)))
    const strip = await Promise.all(list.map(async s => (
      <Box flexDirection="column">
        {await picture(s, thumbCols, stripRows(e.props.maxRows), `t${s.n}`)}
        <Text color={s.n === sel.n ? 'suggestion' : undefined} bold={s.n === sel.n} dimColor={s.n !== sel.n} wrap="truncate">
          {caption(s.n)}
        </Text>
      </Box>
    )))
    return (
      <Box flexDirection="column">
        <Box gap={2}>{strip}</Box>
        {keys}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text, Image } = $.ui.resolve(e)
    const mode = await read($, pixelMode)
    const past = await read($, history)
    const s = pick(await read($, zoom), await read($, shots), past)
    const width = Math.max(20, e.props.bodyColumns) - 2
    const room = Math.max(6, (e.viewport?.rows ?? 30) - 6)
    const box = s ? fit(s.width, s.height, width, room, cellAspect) : { columns: 0, rows: 0 }
    const source = s ? await sourceFor($, mode, s.file) : null

    return (
      <Box flexDirection="column">
        {mode === 'none' ? (
          <Text dimColor>{t.noPixels}</Text>
        ) : source && s ? (
          <Image key={`pane${s.n}`} source={source} columns={box.columns} rows={box.rows} alt={caption(s.n)} />
        ) : (
          <Text dimColor>{t.noImage}</Text>
        )}
        {s && (
          <Text>
            {caption(s.n)}  <Text color="suggestion" bold>{t.paneKeys}</Text>
          </Text>
        )}
        {past.length > 0 && <Text dimColor wrap="truncate">{t.sent}: {past.map(x => `#${x.n}`).join(' ')}</Text>}
      </Box>
    )
  })
}

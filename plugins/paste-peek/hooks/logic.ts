// Pure helpers: placeholder parsing, Claude Code's image paths, PNG size, sizing, captions.
import type { Shot } from '../types'

/** Parent of each session's temp dir; the debug log (off by default) lives here too. */
export const DIR = '/tmp/paste-peek'
export const LOG = `${DIR}/debug.log`

/** A 1×1 transparent PNG, base64: the sentinel the pixel probe blits. */
export const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

/** Every N of `[Image #N]` in a draft, in order. */
export function placeholders(text: string): number[] {
  return [...text.matchAll(/\[Image #(\d+)\]/g)].map(m => Number(m[1]))
}

/** Shots whose placeholder is still in the draft. */
export function keep(shots: readonly Shot[], draft: string): Shot[] {
  const live = new Set(placeholders(draft))
  return shots.filter(s => live.has(s.n))
}

/** Find shot n among the draft and the history; else the newest. */
export function pick(n: number | null, shots: readonly Shot[], history: readonly Shot[]): Shot | undefined {
  return [...history, ...shots].find(s => s.n === n) ?? shots.at(-1) ?? history.at(-1)
}

/**
 * The box after a consumed ⌥←/⌥→. A cursor at the very end makes the next ⌥→ a no-op the
 * editor never reports, so park it before one trailing space: then ⌥→ always moves, and so arrives.
 */
export function parkCursor(text: string, cursor: number): { text: string; cursor: number } {
  if (cursor < text.length) return { text, cursor }
  return { text: `${text} `, cursor: text.length }
}

/** Cell height over width assumed until the terminal's is measured. */
export const DEFAULT_ASPECT = 2

/** Rows for a picture `columns` wide: rows = columns * h / w / aspect, clamped to [1, maxRows]. */
export function fitRows(width: number, height: number, columns: number, maxRows: number, aspect = DEFAULT_ASPECT): number {
  if (width <= 0 || height <= 0) return Math.min(maxRows, Math.max(1, Math.round(columns / 4)))
  return Math.min(maxRows, Math.max(1, Math.round((columns * height) / width / aspect)))
}

/** Columns that keep the aspect when rows is the binding limit. */
export function fitColumns(width: number, height: number, rows: number, maxColumns: number, aspect = DEFAULT_ASPECT): number {
  if (width <= 0 || height <= 0) return maxColumns
  return Math.min(maxColumns, Math.max(1, Math.round((rows * aspect * width) / height)))
}

/** The largest box of at most maxColumns × maxRows cells (each ≤ 255) that keeps the picture's shape. */
export function fit(width: number, height: number, maxColumns: number, maxRows: number, aspect = DEFAULT_ASPECT): { columns: number; rows: number } {
  const cols = Math.min(255, maxColumns)
  const rows = fitRows(width, height, cols, Math.min(255, maxRows), aspect)
  return { columns: fitColumns(width, height, rows, cols, aspect), rows }
}

/** Cell height over width from TIOCGWINSZ's "rows cols xpixel ypixel"; undefined when bogus (tmux, ssh). */
export function parseCellAspect(stdout: string): number | undefined {
  const [rows = 0, columns = 0, width = 0, height = 0] = stdout.trim().split(/\s+/).map(Number)
  if (!rows || !columns || !width || !height) return undefined
  const aspect = height / rows / (width / columns)
  return aspect >= 1.25 && aspect <= 3.4 ? aspect : undefined
}

/**
 * python3: walk up to Claude Code's process and ask its tty for the window's
 * pixel size (TIOCGWINSZ). After hedingerm/image-preview (MIT), which follows Grok Build.
 */
export const MEASURE_CELL = `
import fcntl, os, struct, subprocess, termios
pid = os.getppid()
while pid > 1:
    tty, ppid = (subprocess.run(['ps', '-o', 'tty=,ppid=', '-p', str(pid)], capture_output=True, text=True).stdout.split() + ['?', '0'])[:2]
    if tty not in ('?', '??'):
        fd = os.open('/dev/' + tty, os.O_RDONLY | os.O_NOCTTY)
        print(*struct.unpack('HHHH', fcntl.ioctl(fd, termios.TIOCGWINSZ, bytes(8))))
        break
    pid = int(ppid)
`

/** A blit deny that is about drawing pixels at all (alt text, no graphics), not about the element. */
export function saysNoPixels(deny: string): boolean {
  return /\balt\b|graphic|pixel|kitty|placeholder|cannot draw|can't draw/i.test(deny)
}

/** The only caption anywhere: the placeholder as the prompt shows it. */
export function caption(n: number): string {
  return `[Image #${n}]`
}

/** One log line, inputs cut so the log stays readable. */
export function probeLine(kind: string, fields: Record<string, unknown>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}=${JSON.stringify(v)?.slice(0, 120)}`)
    .join(' ')
  return `${kind} ${body}`
}

/** Rows the thumbnails take at most; small, so zoom is visibly larger. */
export const THUMB_ROWS = 6

/** Picture rows for the strip: the band's maxRows minus the caption row and the keys row, in [1, THUMB_ROWS]. */
export function stripRows(maxRows: number): number {
  return Math.min(THUMB_ROWS, Math.max(1, maxRows - 2))
}

/** Width and height from a PNG's first bytes (signature, then the IHDR chunk); null when it is not a PNG. */
export function pngSize(base64: string): { width: number; height: number } | null {
  if (base64.length < 32) return null // fewer than 24 bytes: still being written
  const b = (Uint8Array as unknown as { fromBase64: (s: string) => Uint8Array }).fromBase64(base64.slice(0, 32)) // 24 bytes; the engine has it, the lib typings not yet
  const isPng = [0x89, 0x50, 0x4e, 0x47].every((v, i) => b[i] === v) && String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!) === 'IHDR'
  if (!isPng) return null
  const view = new DataView(b.buffer, b.byteOffset)
  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Where Claude Code keeps its per-user temp: $CLAUDE_CODE_TMPDIR (itself, or its claude-<uid> child), else /tmp/claude-<uid>. */
export function imageRoots(tmpDir: string | undefined, uid: string): string[] {
  const base = tmpDir?.replace(/\/+$/, '')
  return base ? [`${base}/claude-${uid}`, base] : [`/tmp/claude-${uid}`]
}

/** The saved picture of [Image #n] in a session's images dir. */
export function imageFile(dir: string, n: number): string {
  return `${dir}/${n}.png`
}

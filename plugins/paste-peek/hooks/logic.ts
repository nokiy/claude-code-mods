// Pure helpers: placeholder parsing, sizing, formatting, clipboard script.
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

/** N newly present in `after` that were not in `before`. */
export function added(before: string, after: string): number[] {
  const had = new Set(placeholders(before))
  return placeholders(after).filter(n => !had.has(n))
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

export function kb(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function info(s: Shot): string {
  return `[Image #${s.n}] ${s.width}×${s.height} · ${kb(s.bytes)}`
}

/** One log line, inputs cut so the log stays readable. */
export function probeLine(kind: string, fields: Record<string, unknown>): string {
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}=${JSON.stringify(v)?.slice(0, 120)}`)
    .join(' ')
  return `${kind} ${body}`
}

/**
 * JXA: argv = [lastChangeCount | 'none', pngPath]. Answers {count} when the
 * pasteboard is unchanged or holds no image; else writes a PNG and answers its size.
 */
export const CLIP_JXA = `ObjC.import("AppKit");
function run(argv) {
  var last = Number(argv[0]), path = argv[1];
  var p = $.NSPasteboard.generalPasteboard;
  var count = Number(p.changeCount);
  if (count === last) return JSON.stringify({ count: count });
  var data = p.dataForType("public.png");
  if (data.isNil()) data = p.dataForType("public.tiff");
  if (data.isNil()) return JSON.stringify({ count: count });
  var rep = $.NSBitmapImageRep.imageRepWithData(data);
  var png = rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $());
  png.writeToFileAtomically(path, true);
  return JSON.stringify({ count: count, file: path, width: Number(rep.pixelsWide), height: Number(rep.pixelsHigh), bytes: Number(png.length) });
}`

export type ClipAnswer = { count: number; file?: string; width?: number; height?: number; bytes?: number }

export function parseClip(stdout: string): ClipAnswer | null {
  try {
    const v = JSON.parse(stdout.trim()) as ClipAnswer
    return typeof v.count === 'number' ? v : null
  } catch {
    return null
  }
}

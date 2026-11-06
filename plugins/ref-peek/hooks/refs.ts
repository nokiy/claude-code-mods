// Finds the PR / Ticket / Spec numbers in a block of markdown, writes the annotated block and tells where a link of it stands. Pure text, no model.

/** One mention: where it stands and how it is written. */
export type RefToken = { start: number; end: number; text: string; number: number };

/** What a mention links to and the note after its first occurrence; null leaves it as written. */
export type Lookup = (token: RefToken) => { href: string; gloss: string } | null;

/** A block as written for the engine, and the links in it. */
export type Annotated = { text: string; hrefs: string[] };

/**
 * Where a link stands. The block parts after the unit holding it (a paragraph, a list item, a whole table): `through` and `tail`, `gap` blank rows
 * between them. `rowsBelow` is how far the link's row is above the unit's last row, the only part a drawing has to take from an estimate.
 * `row` estimates the link's row in the whole block.
 */
export type Anchor = { through: string; tail: string; gap: number; rowsBelow: number; column: number; row: number };

const FENCE = /^[ \t>]*(`{3,}|~{3,})/;
const INDENTED = /^(?: {4}| {0,3}\t)/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/;
// Inline code, links with their targets, reference links, bare URLs: nothing inside them is a mention.
const SKIPPED = [
  /(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g,
  /!?\[[^\]\n]*\]\([^)\n]*\)/g,
  /!?\[[^\]\n]*\]\[[^\]\n]*\]/g,
  /(?:https?:\/\/|www\.)[^\s）」]+/g,
];
// The guards are ASCII on purpose: Chinese has no spaces, so `见#12的` is a mention while `C#`, `foo#12`, `foo_#12` and `&#39;` are not.
const REF = /(?<![A-Za-z0-9_#/&.-])(?:(?:PR|Ticket|Spec|Issue) )?#(?<number>[1-9]\d{0,6})(?![A-Za-z0-9_]|\.\d)/g;
// An emphasis span on one line: `*` opens anywhere but before a space. `_` is left alone: beside Chinese it reads as part of a name.
const EMPHASIS = /(?<![\\*])(\*{1,3})(?=[^\s*])[^\n]*?(?<=[^\s*])\1(?!\*)/g;
// An explanation already there, after optional spaces. The marks around a known number are gone by the time this is asked.
const EXPLAINED = /^ *[（(：:—–]/;
const SPACE_AFTER_NOTE = /^ [^|\s]/;

function closesFence(open: string, mark: string, rest: string): boolean {
  return mark[0] === open[0] && mark.length >= open.length && rest.trim() === '';
}

type OpenFence = { mark: string; start: number };

// The fence open after the line at `at`; a line that closes one adds its range.
function stepFence(open: OpenFence | null, line: string, at: number, ranges: Array<[number, number]>): OpenFence | null {
  const m = FENCE.exec(line);
  const mark = m?.[1];
  if (!m || mark === undefined) return open;
  const rest = line.slice(m[0].length);
  if (open === null) return mark.startsWith('`') && rest.includes('`') ? null : { mark, start: at };
  if (!closesFence(open.mark, mark, rest)) return open;
  ranges.push([open.start, at + line.length]);
  return null;
}

function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: OpenFence | null = null;
  let at = 0;
  for (const line of text.split('\n')) {
    open = stepFence(open, line, at, ranges);
    at += line.length + 1;
  }
  if (open !== null) ranges.push([open.start, text.length]);
  return ranges;
}

type IndentState = { afterBlank: boolean; isCode: boolean; inList: boolean };

// One line on: an indented line opens code after a blank line and goes on with it, unless a list is open; an unindented line after a blank one ends the list.
function stepIndent(state: IndentState, line: string): IndentState {
  if (line.trim() === '') return { ...state, afterBlank: true };
  const isCode = INDENTED.test(line) && !state.inList && (state.afterBlank || state.isCode);
  const staysInList = state.inList && (!state.afterBlank || /^\s/.test(line));
  return { afterBlank: false, isCode, inList: !isCode && (LIST_ITEM.test(line) || staysInList) };
}

function indentedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let state: IndentState = { afterBlank: true, isCode: false, inList: false };
  let at = 0;
  for (const line of text.split('\n')) {
    state = stepIndent(state, line);
    if (state.isCode) ranges.push([at, at + line.length]);
    at += line.length + 1;
  }
  return ranges;
}

// NUL, not a space: code at the edge of an emphasis span must not read as whitespace beside its marks.
function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + '\0'.repeat(end - start) + text.slice(end);
}

// The block with everything that holds no mention blanked out, every offset unchanged.
function masked(text: string): string {
  let out = text;
  for (const [start, end] of fencedRanges(text)) out = blank(out, start, end);
  for (const [start, end] of indentedRanges(out)) out = blank(out, start, end);
  for (const pattern of SKIPPED) {
    for (const m of out.matchAll(pattern)) out = blank(out, m.index, m.index + m[0].length);
  }
  return out;
}

export function findRefs(text: string): RefToken[] {
  return [...masked(text).matchAll(REF)].map(m => ({
    start: m.index,
    end: m.index + m[0].length,
    text: m[0],
    number: Number(m.groups?.number),
  }));
}

// The block without the emphasis marks around known mentions, inner spans too: after a link's `)` or a note's `）`, a closing mark
// followed by Chinese no longer closes anything and would show as written. The link is styled already.
function withoutEmphasis(text: string, lookup: Lookup): string {
  const known = findRefs(text).filter(token => lookup(token) !== null);
  let out = '';
  let at = 0;
  for (const m of masked(text).matchAll(EMPHASIS)) {
    const end = m.index + m[0].length;
    if (!known.some(token => m.index <= token.start && token.end <= end)) continue;
    const width = (m[1] ?? '').length;
    out += text.slice(at, m.index) + text.slice(m.index + width, end - width);
    at = end;
  }
  return at === 0 ? text : withoutEmphasis(out + text.slice(at), lookup);
}

/** The block with each known mention linked and the first mention of each ref explained, plus the links written. */
export function annotate(block: string, lookup: Lookup): Annotated {
  const text = withoutEmphasis(block, lookup);
  const hrefs = new Set<string>();
  let out = '';
  let at = 0;
  for (const token of findRefs(text)) {
    const hit = lookup(token);
    if (hit === null) continue;
    const isFirst = !hrefs.has(hit.href);
    hrefs.add(hit.href);
    const skipsNote = !isFirst || hit.gloss === '' || EXPLAINED.test(text.slice(token.end));
    out += `${text.slice(at, token.start)}[${token.text}](${hit.href})${skipsNote ? '' : `（${hit.gloss}）`}`;
    // The note's own bracket does the spacing, so a space after it goes (a table cell keeps its padding).
    at = token.end + (!skipsNote && SPACE_AFTER_NOTE.test(text.slice(token.end, token.end + 2)) ? 1 : 0);
  }
  return { text: out + text.slice(at), hrefs: [...hrefs] };
}

// The marks a drawn line no longer has: a link's target and the emphasis and code marks.
const LINK = /\[([^\]\n]*)\]\([^)\n]*\)/g;
const INLINE_MARKS = /\*{1,3}|`+|~~/g;
const LIST_MARKER = /^\s*(?:[-*+]|\d{1,9}[.)])\s+/;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;

const drawn = (line: string) => line.replace(LINK, '$1').replace(INLINE_MARKS, '');

/** The cells a string takes in the terminal. */
export function cellsOf(text: string): number {
  let cells = 0;
  for (const char of text) cells += WIDE.test(char) ? 2 : 1;
  return cells;
}

type Pen = { row: number; column: number };
type Spot = { row: number; rowsBelow: number; column: number };

// A word longer than a row runs on from where the pen stands, unless starting on a fresh row costs one row less.
function startOfLong(pen: Pen, cells: number, width: number): Pen {
  const fromHere = 1 + Math.floor((cells - (width - pen.column) - 1) / width);
  const fromNext = Math.floor((cells - 1) / width);
  return fromNext < fromHere ? { row: pen.row + 1, column: 0 } : pen;
}

function writeChars(pen: Pen, chars: string, width: number): Pen {
  let { row, column } = pen;
  for (const char of chars) {
    const cells = cellsOf(char);
    if (column + cells > width) [row, column] = [row + 1, 0];
    column += cells;
  }
  return { row, column };
}

function writeWord(pen: Pen, word: string, width: number): Pen {
  const cells = cellsOf(word);
  if (cells > width) return writeChars(startOfLong(pen, cells, width), word, width);
  const start = pen.column > 0 && pen.column + cells > width ? { row: pen.row + 1, column: 0 } : pen;
  return { row: start.row, column: start.column + cells };
}

/** Where the pen stands after `text`, wrapped as the terminal wraps a line: at spaces, a word wider than the row broken by the cell. */
export function wrapped(text: string, width: number): Pen {
  let pen: Pen = { row: 0, column: 0 };
  text.split(' ').forEach((word, i) => {
    const spaced = i > 0 && pen.column > 0 ? { ...pen, column: pen.column + 1 } : pen;
    pen = writeWord(spaced, word, width);
  });
  return pen;
}

// The row and column `at` opens on. The word it stands in is laid out whole, since a word moves to the next row as one.
function penAt(line: string, at: number, width: number): Pen {
  const wordEnd = line.indexOf(' ', at);
  const whole = line.slice(0, wordEnd < 0 ? line.length : wordEnd);
  const end = wrapped(whole, width);
  const cells = end.row * width + end.column - cellsOf(whole.slice(at));
  return { row: Math.floor(cells / width), column: cells % width };
}

// A list item wraps beside its marker, not under it.
function markerOf(line: string): string {
  return LIST_MARKER.exec(line)?.[0] ?? '';
}

function rowsOf(line: string, width: number): number {
  const marker = markerOf(line);
  return wrapped(drawn(line.slice(marker.length)), width - cellsOf(marker)).row + 1;
}

const sumRows = (lines: string[], width: number) => lines.reduce((rows, line) => rows + rowsOf(line, width), 0);

// The offset just past the unit holding `at`: its table or paragraph, or its own item in a list.
function unitEnd(text: string, at: number): number {
  let end = at;
  for (const [i, line] of text.slice(at).split('\n').entries()) {
    if (i > 0 && (line.trim() === '' || LIST_ITEM.test(line))) break;
    end += line.length + 1;
  }
  return Math.min(end - 1, text.length);
}

const cellsIn = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => drawn(cell).trim());

// Each column's cells: what its widest cell asks for, all of them shrunk alike when the table is wider than the block. A column's frame takes three.
function columnWidths(rows: string[][], width: number): number[] {
  const count = Math.max(...rows.map(row => row.length));
  const ideal = Array.from({ length: count }, (_, i) => Math.max(1, ...rows.map(row => cellsOf(row[i] ?? ''))));
  const room = width - 3 * count - 1;
  const total = ideal.reduce((sum, cells) => sum + cells, 0);
  return total <= room ? ideal : ideal.map(cells => Math.max(1, Math.floor(cells * room / total)));
}

const rowHeight = (row: string[], widths: number[]) => Math.max(...row.map((cell, i) => wrapped(cell, widths[i] ?? 1).row + 1));

// A table: the rows under the one holding the link, each under a rule of its own, then the bottom edge. Its column: the frames and the columns before it.
function spotInTable(unit: string, lineIndex: number, at: number, width: number): Spot {
  const lines = unit.split('\n');
  const rows = lines.filter(line => !TABLE_RULE.test(line)).map(cellsIn);
  const widths = columnWidths(rows, width);
  const held = lines.slice(0, lineIndex + 1).filter(line => !TABLE_RULE.test(line)).length - 1;
  const after = rows.slice(held + 1).reduce((sum, row) => sum + rowHeight(row, widths) + 1, 0);
  const cellIndex = (lines[lineIndex] ?? '').slice(0, at).replace(/^\s*\|/, '').split('|').length - 1;
  const column = widths.slice(0, cellIndex).reduce((sum, cells) => sum + cells + 3, 2);
  return { row: held * 2, rowsBelow: rowHeight(rows[held] ?? [], widths) + after, column };
}

// A line of a paragraph or list: the rows left in the line, then those of the unit's lines under it.
function spotInLines(unit: string, lineIndex: number, at: number, width: number): Spot {
  const lines = unit.split('\n');
  const line = lines[lineIndex] ?? '';
  const marker = markerOf(line);
  const inner = width - cellsOf(marker);
  const pen = penAt(drawn(line.slice(marker.length)), drawn(line.slice(marker.length, at)).length, inner);
  // A `---` right under a paragraph underlines it and takes no row of its own.
  const under = lines.slice(lineIndex + 1).filter(l => !TABLE_RULE.test(l));
  const rowsBelow = rowsOf(line, width) - 1 - pen.row + sumRows(under, width);
  return { row: sumRows(lines.slice(0, lineIndex), width) + pen.row, rowsBelow, column: pen.column + cellsOf(marker) };
}

// Where the list item holding `at` opens; `paragraph` outside a list.
function itemStart(text: string, paragraph: number, at: number): number {
  let start = paragraph;
  let lineAt = paragraph;
  for (const line of text.slice(paragraph, at).split('\n')) {
    if (LIST_ITEM.test(line)) start = lineAt;
    lineAt += line.length + 1;
  }
  return start;
}

const isTable = (unit: string) => unit.includes('|') && unit.split('\n').some(line => line.includes('-') && TABLE_RULE.test(line));

/** Where the link to `href` stands in `text` drawn `width` cells wide; null when it is not there. */
export function anchorOf(text: string, href: string, width: number): Anchor | null {
  const close = text.indexOf(`](${href})`);
  if (close < 0) return null;
  const at = text.lastIndexOf('[', close);
  const end = unitEnd(text, at);
  const blank = text.lastIndexOf('\n\n', at);
  const paragraph = blank < 0 ? 0 : blank + 2;
  const start = isTable(text.slice(paragraph, end)) ? paragraph : itemStart(text, paragraph, at);
  const unit = text.slice(start, end);
  const before = text.slice(start, at).split('\n');
  const place = isTable(unit) ? spotInTable : spotInLines;
  const spot = place(unit, before.length - 1, (before[before.length - 1] ?? '').length, width);
  const rest = text.slice(end);
  const tail = rest.replace(/^\s*\n/, '');
  const gap = /^\n\s*\n/.test(rest) ? 1 : 0;
  return { through: text.slice(0, end), tail, gap, ...spot, row: sumRows(text.slice(0, start).split('\n').slice(0, -1), width) + spot.row };
}

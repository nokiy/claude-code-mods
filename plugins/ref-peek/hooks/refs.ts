// Finds the PR / Ticket / Spec numbers in a block of markdown and writes the annotated block. Pure text, no model.

/** One mention: where it stands and how it is written. */
export type RefToken = { start: number; end: number; text: string; number: number };

/** What a mention links to and the note after its first occurrence; null leaves it as written. */
export type Lookup = (token: RefToken) => { href: string; gloss: string } | null;

/** A block as written for the engine, and the links in it. */
export type Annotated = { text: string; hrefs: string[] };

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
// The guards are ASCII on purpose: Chinese has no spaces, so `见#12的` is a mention while `C#`, `foo#12` and `&#39;` are not.
// `_` is left out of them: it is an emphasis mark in `__PR #52__`.
const REF = /(?<![A-Za-z0-9#/&.-])(?:(?:PR|Ticket|Spec|Issue) )?#(?<number>[1-9]\d{0,6})(?![A-Za-z0-9]|\.\d)/g;
// An emphasis span on one line: `*` opens anywhere but before a space, `_` also needs no word around it.
const EMPHASIS = /(?<![\\*])(\*{1,3})(?=[^\s*])[^\n]*?(?<=[^\s*])\1(?!\*)|(?<![\\\w])(_{1,3})(?=[^\s_])[^\n]*?(?<=[^\s_])\2(?!\w)/g;
// An explanation already there; a closing `**` may stand between the number and it.
const EXPLAINED = /^[*_]* *[（(：:—–-]/;
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
    const width = (m[1] ?? m[2] ?? '').length;
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

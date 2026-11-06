// Finds the PR / Ticket / Spec numbers in a block of markdown and writes the annotated block. Pure text, no model.

/** One mention: where it stands, how it is written, and the repository it names itself (`o/r#N`). */
export type RefToken = { start: number; end: number; text: string; number: number; repo: string | null };

/** What a mention links to and the note after its first occurrence; null leaves it as written. */
export type Lookup = (token: RefToken) => { href: string; gloss: string } | null;

const FENCE = /^[ \t>]*(`{3,}|~{3,})/;
// Inline code, links with their targets, reference links, bare URLs: nothing inside them is a mention.
const SKIPPED = [
  /(?<!`)(`+)(?!`)[^\n]*?(?<!`)\1(?!`)/g,
  /!?\[[^\]\n]*\]\([^)\n]*\)/g,
  /!?\[[^\]\n]*\]\[[^\]\n]*\]/g,
  /(?:https?:\/\/|www\.)[^\s）」]+/g,
];
// The guards are ASCII on purpose: Chinese has no spaces, so `见#12的` is a mention while `C#`, `foo#12` and `&#39;` are not.
const REF = /(?<![\w#/&.-])(?:(?<repo>\w[\w.-]*\/\w[\w.-]*)#|(?:(?:PR|Ticket|Spec|Issue) )?#)(?<number>[1-9]\d{0,6})(?!\w|\.\d)/g;
// An explanation already there; a closing `**` may stand between the number and it.
const EXPLAINED = /^[*_]* ?[（(]/;
const SPACE_AFTER_NOTE = /^ [^|\s]/;

function closesFence(open: string, mark: string, rest: string): boolean {
  return mark[0] === open[0] && mark.length >= open.length && rest.trim() === '';
}

function fencedRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let open: string | null = null;
  let start = 0;
  let at = 0;
  for (const line of text.split('\n')) {
    const m = FENCE.exec(line);
    const mark = m?.[1];
    if (m && mark !== undefined) {
      const rest = line.slice(m[0].length);
      if (open === null && !(mark.startsWith('`') && rest.includes('`'))) {
        open = mark;
        start = at;
      } else if (open !== null && closesFence(open, mark, rest)) {
        ranges.push([start, at + line.length]);
        open = null;
      }
    }
    at += line.length + 1;
  }
  if (open !== null) ranges.push([start, text.length]);
  return ranges;
}

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + ' '.repeat(end - start) + text.slice(end);
}

// The block with everything that holds no mention blanked out, every offset unchanged.
function masked(text: string): string {
  let out = text;
  for (const [start, end] of fencedRanges(text)) out = blank(out, start, end);
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
    repo: m.groups?.repo ?? null,
  }));
}

/** The block with each known mention linked and the first mention of each ref explained, plus the links written. */
export function annotate(text: string, lookup: Lookup): { text: string; hrefs: string[] } {
  const hrefs = new Set<string>();
  let out = '';
  let at = 0;
  for (const token of findRefs(text)) {
    const hit = lookup(token);
    if (hit === null) continue;
    const isFirst = !hrefs.has(hit.href);
    hrefs.add(hit.href);
    const hasNote = !isFirst || hit.gloss === '' || EXPLAINED.test(text.slice(token.end, token.end + 4));
    out += `${text.slice(at, token.start)}[${token.text}](${hit.href})${hasNote ? '' : `（${hit.gloss}）`}`;
    // The note's own bracket does the spacing, so a space after it goes (a table cell keeps its padding).
    at = token.end + (!hasNote && SPACE_AFTER_NOTE.test(text.slice(token.end, token.end + 2)) ? 1 : 0);
  }
  return { text: out + text.slice(at), hrefs: [...hrefs] };
}

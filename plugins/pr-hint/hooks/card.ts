// Pure text for the AbovePrompt detail card (full hierarchy, no row cap) and the hint row's spans and layout.
import type { PrData, PrTicket, TicketStatus } from '../types';
import { relTime, shortTitle, sortTickets, summarize, truncate, width, wrapCells } from './parse';
import type { Strings } from './strings';

/** One coloured run inside a line. */
export type CardPart = { text: string; color?: string; bold?: boolean; dim?: boolean };
/** `text` is the whole line; `parts` are its coloured runs (they concatenate to `text`). */
export type CardLine = { text: string; parts: CardPart[] };

export const STATUS_COLOR: Record<TicketStatus, string> = {
  todo: 'gray',
  doing: 'yellow',
  merged: 'blueBright',
  done: 'green',
};

const line = (parts: CardPart[]): CardLine => ({ text: parts.map(p => p.text).join(''), parts });

// `● #9 merged ✓0/7 <short title>`, then the branch (dim) and, when ahead, `N commits behind`.
const ticketLine = (t: PrTicket, s: Strings): CardLine => {
  const p = t.progress;
  const prog = p ? `✓${p.done}/${p.total}${p.maxRounds > 0 ? ` R${p.maxRounds}` : ''}` : s.noTable;
  const color = STATUS_COLOR[t.status];
  return line([
    { text: '●', color },
    { text: ` #${t.number} ` },
    { text: s.status[t.status], color },
    { text: ` ${prog} ${shortTitle(t.title, 30)}` },
    ...(t.branch ? [{ text: ` · ${t.branch}`, dim: true }] : []),
    ...(t.ahead > 0 ? [{ text: ` · ${s.behind(t.ahead)}`, color: 'yellow' }] : []),
  ]);
};

/**
 * The card, top to bottom, `inner` cells wide: the PR title (wrapped to at most
 * 3 rows), the Spec with its integration branch, the CI and merged/accepted summary,
 * then one line per ticket. `footer` follows the link.
 */
export function cardLines(pr: PrData, nowMs: number, inner: number, s: Strings): { lines: CardLine[]; footer: string } {
  const prefix = `PR #${pr.number}`;
  const title = wrapCells(`${prefix} ${pr.title}`, inner, 3).map((text, i) =>
    i === 0 && text.startsWith(prefix)
      ? line([{ text: prefix, color: 'cyan', bold: true }, { text: text.slice(prefix.length) }])
      : line([{ text }]),
  );

  let meta: CardLine;
  if (pr.spec) {
    const tail = ` · ${s.integration} ${pr.base} ← ${pr.head}`;
    const head = `Spec #${pr.spec.number} `;
    const room = Math.max(8, inner - width(head) - width(tail));
    meta = line([{ text: `${head}${shortTitle(pr.spec.title, room)}${tail}`, color: 'magenta' }]);
  } else {
    meta = line([{ text: `${s.integration} ${pr.base} ← ${pr.head} · ${pr.isDraft ? `${pr.state} (draft)` : pr.state}` }]);
  }

  const { ci } = pr;
  const ciText =
    ci.total === 0 ? s.noCi : `CI ✓${ci.ok}/${ci.total}${ci.fail > 0 ? ` ✗${ci.fail}` : ''}${ci.pending > 0 ? ` …${ci.pending}` : ''}`;
  const ciColor = ci.total === 0 ? undefined : ci.fail > 0 ? 'red' : ci.pending > 0 ? 'yellow' : 'green';
  const sum = summarize(pr.tickets);
  const summary = line([
    { text: ciText, color: ciColor },
    ...(pr.tickets.length === 0
      ? [{ text: ` · ${s.noTickets}` }]
      : [
          { text: ` · ${s.merged} ` },
          { text: `${sum.merged}/${sum.total}`, color: STATUS_COLOR.merged, bold: true },
          { text: ` · ${s.accepted} ` },
          { text: `${sum.done}/${sum.total}`, color: STATUS_COLOR.done, bold: true },
        ]),
  ]);

  return {
    lines: [...title, meta, summary, ...sortTickets(pr.tickets).map(t => ticketLine(t, s))],
    footer: s.updated(relTime(pr.updatedAt, nowMs, s)),
  };
}

/**
 * What fits on the hint row after the hint text: `available` is the row's width
 * less the hint, the ` · ` separator and a safety margin. The title takes all
 * that is left after `PR #N ` and the summary, cut with `…`. When under 8 cells
 * would remain for the title, the summary goes first, then the title shrinks.
 */
export function hintLayout(pr: PrData, available: number, s: Strings): { title: string; hasSummary: boolean } {
  const head = width(`PR #${pr.number} `);
  const sum = summarize(pr.tickets);
  const summary = pr.tickets.length === 0 ? 0 : width(` · ${s.merged} ${sum.merged}/${sum.total} · ${s.accepted} ${sum.done}/${sum.total}`);
  if (summary > 0 && available - head - summary >= 8) {
    return { title: truncate(pr.title, available - head - summary), hasSummary: true };
  }
  return { title: truncate(pr.title, Math.max(8, available - head)), hasSummary: false };
}

const MODES: ReadonlyArray<readonly [string, string]> = [
  ['bypass permissions on', 'red'],
  ['accept edits on', 'magenta'],
  ['plan mode on', 'cyan'],
  ['auto mode on', 'yellow'],
];

/**
 * Splits the engine's hint string into runs: a leading `▸▸ ` / `⏵⏵ ` glyph and
 * a known mode phrase take the mode colour as the engine draws it; the rest is dim.
 */
export function hintSpans(hint: string): CardPart[] {
  const m = /^((?:▸▸|⏵⏵)\s*)?(.*)$/s.exec(hint);
  const glyph = m?.[1] ?? '';
  const body = m?.[2] ?? hint;
  for (const [phrase, color] of MODES) {
    if (body.startsWith(phrase)) {
      const rest = body.slice(phrase.length);
      return [{ text: glyph + phrase, color }, ...(rest ? [{ text: rest, dim: true }] : [])];
    }
  }
  return [{ text: hint, dim: true }];
}

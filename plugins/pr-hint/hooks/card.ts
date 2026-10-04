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

// A ticket title's lead before the first ` · `, split into the shared part and its ordinal:
// `深色模式 ② · 编辑器配色` → base `深色模式`, ordinal `②`, rest `编辑器配色`.
const LEAD = /^(.+?)\s*([①-⑳]|\d+[a-z]?)?\s*·\s*(.+)$/u;

// A leading `[mod] ` tag on a ticket title (the tracker's scope prefix) is noise on the card.
const TAG = /^\s*\[[^\]]*\]\s*/;

/**
 * Drops a leading `[mod]` tag; then, when every ticket (two or more) shares the same lead (the
 * Spec's subject), drops that too and keeps the ordinal and what this ticket does: `② 编辑器配色`.
 */
export function ticketSubjects(tickets: readonly PrTicket[]): Map<number, string> {
  const parsed = tickets.map(t => {
    const title = t.title.replace(TAG, '');
    return { n: t.number, title, m: LEAD.exec(title) };
  });
  const bases = new Set(parsed.map(p => p.m?.[1]?.trim() ?? null));
  const shared = tickets.length >= 2 && bases.size === 1 && !bases.has(null);
  return new Map(parsed.map(p => [p.n, shared && p.m ? `${p.m[2] ? `${p.m[2]} ` : ''}${p.m[3]}` : p.title]));
}

// `● #9 merged <subject>`, then the branch (dim) and, when ahead, `N commits behind`.
// The status alone says where a ticket stands (accepted turns the dot green); no per-row counts.
// The title takes the width the rest of the line leaves inside `inner`.
const ticketLine = (t: PrTicket, subject: string, s: Strings, inner: number): CardLine => {
  const color = STATUS_COLOR[t.status];
  const head = ` #${t.number} ${s.status[t.status]} `;
  const branch = t.branch ? ` · ${t.branch}` : '';
  const behind = t.ahead > 0 ? ` · ${s.behind(t.ahead)}` : '';
  const room = Math.max(12, inner - 1 - width(head) - width(branch) - width(behind));
  return line([
    { text: '●', color },
    { text: ` #${t.number} ` },
    { text: s.status[t.status], color },
    { text: ` ${shortTitle(subject, room)}` },
    ...(branch ? [{ text: branch, dim: true }] : []),
    ...(behind ? [{ text: behind, color: 'yellow' }] : []),
  ]);
};

const ciText = (ci: PrData['ci'], s: Strings): string =>
  ci.total === 0 ? s.noCi : `CI ✓${ci.ok}/${ci.total}${ci.fail > 0 ? ` ✗${ci.fail}` : ''}${ci.pending > 0 ? ` ↻${ci.pending}` : ''}`;

/**
 * The toast after a manual refresh: what changed between `prev` and `next` (title, state, CI,
 * merged and accepted counts, number of tickets), "up to date" when nothing did, or that the PR is gone.
 */
export function refreshText(prev: PrData | null, next: PrData | null, s: Strings): string {
  if (next === null) return s.gone;
  if (prev === null) return s.upToDate(next.number);
  const a = summarize(prev.tickets);
  const b = summarize(next.tickets);
  const state = (p: PrData) => (p.isDraft ? `${p.state} (draft)` : p.state);
  const parts = [
    prev.title !== next.title ? `“${next.title}”` : '',
    state(prev) !== state(next) ? `${state(prev)} → ${state(next)}` : '',
    ciText(prev.ci, s) !== ciText(next.ci, s) ? ciText(next.ci, s) : '',
    a.merged !== b.merged || a.total !== b.total ? `${s.merged} ${a.merged}/${a.total} → ${b.merged}/${b.total}` : '',
    a.done !== b.done || a.total !== b.total ? `${s.accepted} ${a.done}/${a.total} → ${b.done}/${b.total}` : '',
    prev.tickets.length !== next.tickets.length ? `${s.tickets} ${prev.tickets.length} → ${next.tickets.length}` : '',
  ].filter(Boolean);
  return parts.length === 0 ? s.upToDate(next.number) : s.changed(next.number, parts.join(' · '));
}

/**
 * The card, top to bottom, `inner` cells wide: the PR title (wrapped to at most
 * 3 rows), the Spec with its integration branch, the CI and merged/accepted summary,
 * then one line per ticket. `footer` follows the link.
 */
export function cardLines(pr: PrData, nowMs: number, inner: number, s: Strings, titleInner = inner): { lines: CardLine[]; footer: string } {
  const prefix = `PR #${pr.number}`;
  const title = wrapCells(`${prefix} ${pr.title}`, titleInner, 3).map((text, i) =>
    i === 0 && text.startsWith(prefix)
      ? line([{ text: prefix, color: 'cyan', bold: true }, { text: text.slice(prefix.length) }])
      : line([{ text }]),
  );

  const subjects = ticketSubjects(pr.tickets);
  const branches = `${s.integration} ${pr.base} ← ${pr.head}`;
  // Row 2: the Spec, else the lone ticket, else (several tickets) just the branches; no tickets keeps the state.
  const only = pr.tickets.length === 1 ? pr.tickets[0] : undefined;
  const lead = pr.spec
    ? { head: `Spec #${pr.spec.number} `, title: pr.spec.title }
    : only
      ? { head: `${s.ticket} #${only.number} · `, title: subjects.get(only.number) ?? only.title }
      : null;
  let meta: CardLine;
  if (lead) {
    const tail = ` · ${branches}`;
    const room = Math.max(8, inner - width(lead.head) - width(tail));
    meta = line([{ text: `${lead.head}${shortTitle(lead.title, room)}${tail}`, color: 'magenta' }]);
  } else if (pr.tickets.length >= 2) {
    meta = line([{ text: branches, color: 'magenta' }]);
  } else {
    meta = line([{ text: `${s.integration} ${pr.base} ← ${pr.head} · ${pr.isDraft ? `${pr.state} (draft)` : pr.state}` }]);
  }

  const { ci } = pr;
  const ciColor = ci.total === 0 ? undefined : ci.fail > 0 ? 'red' : ci.pending > 0 ? 'yellow' : 'green';
  const sum = summarize(pr.tickets);
  const summary = line([
    { text: ciText(ci, s), color: ciColor },
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
    lines: [...title, meta, summary, ...sortTickets(pr.tickets).map(t => ticketLine(t, subjects.get(t.number) ?? t.title, s, inner))],
    footer: s.fetched(relTime(new Date(pr.fetchedAt).toISOString(), nowMs, s)),
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
 * The engine's hint without its `· ← N agent(s)` pill. The engine shows that pill only while the
 * prompt is empty, so keeping it makes the row grow and shrink as you type.
 */
export function withoutAgents(hint: string): string {
  return hint.replace(/\s*·\s*←\s*\d+\s+agents?\b/g, '').trimEnd();
}

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

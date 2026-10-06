// Pure text for the AbovePrompt detail card (two header lines, then every ticket, no row cap) and the hint row's spans and layout.
import type { PrData, PrStat, PrTicket, TicketStatus } from '../types';
import { prState, relTime, shortTitle, sortTickets, truncate, width } from './parse';
import type { PrState } from './parse';
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

/** The PR state chip: building, waiting on the owner's acceptance, done. */
export const STATE_COLOR: Record<PrState, string> = {
  draft: 'yellow',
  ready: 'magenta',
  merged: 'green',
};

/** The chip's text and colour for one PR. */
export const stateChip = (pr: PrData, s: Strings): { text: string; color: string } => {
  const state = prState(pr);
  return { text: s.prState[state], color: STATE_COLOR[state] };
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
 * The toast after a manual refresh: what changed between `prev` and `next` (title, PR state, CI,
 * number of tickets), "up to date" when nothing did, or that the PR is gone.
 */
export function refreshText(prev: PrData | null, next: PrData | null, s: Strings): string {
  if (next === null) return s.gone;
  if (prev === null) return s.upToDate(next.number);
  const was = stateChip(prev, s).text;
  const now = stateChip(next, s).text;
  const parts = [
    prev.title !== next.title ? `“${next.title}”` : '',
    was !== now ? `${was} → ${now}` : '',
    ciText(prev.ci, s) !== ciText(next.ci, s) ? ciText(next.ci, s) : '',
    prev.tickets.length !== next.tickets.length ? `${s.tickets} ${prev.tickets.length} → ${next.tickets.length}` : '',
  ].filter(Boolean);
  return parts.length === 0 ? s.upToDate(next.number) : s.changed(next.number, parts.join(' · '));
}

// The bar is BAR cells; only when the title would get under 8 cells does it shrink, never below MIN_BAR.
const BAR = 20;
const MIN_BAR = 10;

// Header line 1, at most `room` cells when it fits: `PR #n` · title (cut with …) · bar · `Tickets d/n` · `Spec #n`.
// d counts merged and done tickets; the bar fills d/n of its cells, and the tail follows it directly.
const headLine = (pr: PrData, s: Strings, room: number): CardLine => {
  const prefix = `PR #${pr.number}`;
  const n = pr.tickets.length;
  const d = pr.tickets.filter(t => t.status === 'merged' || t.status === 'done').length;
  const tail = ` ${s.ticketCount(d, n)}${pr.spec ? ` · Spec #${pr.spec.number}` : ''}`;
  const fixed = width(prefix) + 2 + width(tail);
  const cells = Math.min(BAR, Math.max(MIN_BAR, room - fixed - 8));
  const title = truncate(pr.title, Math.max(8, room - fixed - cells));
  const filled = n === 0 ? 0 : Math.round((cells * d) / n);
  return line([
    { text: prefix, color: 'cyan', bold: true },
    { text: ` ${title} ` },
    ...(filled > 0 ? [{ text: '█'.repeat(filled), color: 'green' }] : []),
    ...(filled < cells ? [{ text: '░'.repeat(cells - filled), dim: true }] : []),
    { text: tail },
  ]);
};

// agent-monitor's figures, written the way its own panel writes them: `86.2k`, `12m34s`, `$1.25`. Copies of agent-monitor's
// formatTokens / formatDuration / formatMoney (its logic.ts and cost.ts): change both together (docs/adr/0001-cross-mod-state.md).
const tokenText = (n: number) => (n < 1000 ? String(n) : n < 1_000_000 ? `${(n / 1000).toFixed(1)}k` : `${(n / 1_000_000).toFixed(1)}M`);
const timeText = (ms: number) => {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  return sec < 60 ? `${sec}s` : m < 60 ? `${m}m${String(sec % 60).padStart(2, '0')}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
};
const moneyText = (usd: number) => (usd > 0 && usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`);

/**
 * Header line 2's runs: `◐ N running`, N the tickets in progress; then, with agent-monitor's `stats` for this PR,
 * ` · ≈$ · tokens · time (subagents only)` (no `≈$` when no price is known) and ` · blocked ×N` when hooks refused any.
 */
export const statusParts = (pr: PrData, s: Strings, stats?: PrStat): CardPart[] => [
  { text: '◐', color: STATUS_COLOR.doing },
  { text: ` ${pr.tickets.filter(t => t.status === 'doing').length} ${s.status.doing}` },
  ...(stats ? [
    { text: ` · ${stats.cost === undefined ? '' : `≈${moneyText(stats.cost)} · `}${s.tokens(tokenText(stats.tokens))} · ${timeText(stats.ms)}` },
    { text: ` ${s.agentsOnly}`, dim: true },
    ...(stats.refusals > 0 ? [{ text: ` · ${s.refused(stats.refusals)}`, color: 'red' }] : []),
  ] : []),
];

/**
 * The card, top to bottom: two header lines (line 1 stays within `titleInner`, the width the refresh button
 * leaves; line 2 is `statusParts`), then one line per ticket, `inner` cells wide. `footer` follows the link.
 * `extra.stats` is this PR's subagent totals read from agent-monitor (undefined when absent: line 2 stays `◐ N running`).
 */
export function cardLines(
  pr: PrData, nowMs: number, inner: number, s: Strings, titleInner = inner, extra: { stats?: PrStat } = {},
): { lines: CardLine[]; footer: string } {
  const subjects = ticketSubjects(pr.tickets);
  return {
    lines: [
      headLine(pr, s, titleInner),
      line(statusParts(pr, s, extra.stats)),
      ...sortTickets(pr.tickets).map(t => ticketLine(t, subjects.get(t.number) ?? t.title, s, inner)),
    ],
    footer: s.fetched(relTime(pr.fetchedAt, nowMs, s)),
  };
}

/**
 * What fits on the hint row after the hint text: `available` is the row's width
 * less the hint, the ` · ` separator and a safety margin. The title takes all
 * that is left after `PR #N ` and the state chip, cut with `…`. When under 8 cells
 * would remain for the title, the chip goes first, then the title shrinks.
 */
export function hintLayout(pr: PrData, available: number, s: Strings): { title: string; hasSummary: boolean } {
  const head = width(`PR #${pr.number} `);
  const summary = width(` · ${stateChip(pr, s).text}`);
  if (available - head - summary >= 8) {
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

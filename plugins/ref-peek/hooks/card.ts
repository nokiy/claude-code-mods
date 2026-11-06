// What the note and the bubble say for a ref, and where the bubble stands; the tree around it is register.tsx's.
import type { Facts, Related } from './cache';
import { RELATED_MAX } from './cache';
import { cellsOf, wrapped } from './refs';
import type { Anchor } from './refs';
import { plainTitle } from './summary';
import type { Summary } from './summary';
import { t } from './strings';
import type { PeekRef } from '../types';

/** A row of the bubble that switches it to `ref`. */
export type RelatedRow = { ref: PeekRef; label: string };

export type CardView = { head: string; repo: string; sentence: string; changes: string[]; related: RelatedRow[]; more: string | null };

const STATE_LABELS: Record<string, string> = {
  'pr:draft': t.prDraft,
  'pr:open': t.prOpen,
  'pr:merged': t.prMerged,
  'pr:closed': t.prClosed,
  'issue:open': t.issueOpen,
  'issue:closed': t.issueClosed,
};

function statusOf(facts: Facts): string {
  if (facts.isMerged) return 'merged';
  return facts.isDraft && facts.state === 'open' ? 'draft' : facts.state;
}

export function stateLabel(facts: Facts): string {
  return STATE_LABELS[`${facts.isPr ? 'pr' : 'issue'}:${statusOf(facts)}`] ?? '';
}

function kindLabel(facts: Facts): string {
  if (facts.isPr) return 'PR';
  return facts.isSpec ? 'Spec' : 'Ticket';
}

/** The note after a mention: the summary, the original title until there is one. */
export function glossOf(facts: Facts, summary: Summary | null): string {
  return summary?.summary ?? plainTitle(facts.title);
}

function relatedRow(item: Related, isPr: boolean): RelatedRow {
  return { ref: { repo: item.repo, number: item.number }, label: `${isPr ? t.linked : t.closedBy} ${item.kind} #${item.number} ${plainTitle(item.title)}` };
}

/** `isPending`: no summary yet and one still to come; without it, a missing summary is a failed generation. */
export function cardView(ref: PeekRef, facts: Facts, summary: Summary | null, isPending: boolean): CardView {
  const related = (facts.related ?? []).slice(0, RELATED_MAX).map(item => relatedRow(item, facts.isPr));
  const hidden = (facts.relatedCount ?? 0) - related.length;
  return {
    head: `${kindLabel(facts)} #${ref.number} ${summary?.title ?? plainTitle(facts.title)} · ${stateLabel(facts)}`,
    repo: ref.repo,
    sentence: summary?.summary ?? (isPending ? t.pending : t.noSummary),
    changes: summary?.changes ?? [],
    related,
    more: hidden > 0 ? t.more(hidden) : null,
  };
}

/** A ref nothing is known of yet: reached from a related row, it fills in once fetched. `isPending` false: it could not be read. */
export function bareView(ref: PeekRef, isPending: boolean): CardView {
  return { head: `#${ref.number}`, repo: ref.repo, sentence: isPending ? t.pending : t.noSummary, changes: [], related: [], more: null };
}

/** `text` cut with an ellipsis to fit `cells`. */
export function fit(text: string, cells: number): string {
  if (cellsOf(text) <= cells) return text;
  let out = '';
  for (const char of text) {
    if (cellsOf(`${out}${char}…`) > cells) break;
    out += char;
  }
  return `${out}…`;
}

/** The widest a bubble gets, its frame included. */
const BUBBLE_COLUMNS = 76;
/** The cells a frame and its padding take across, and the rows the frame takes. */
const FRAME_COLUMNS = 4;
const FRAME_ROWS = 2;
const CLOSE_COLUMNS = 7;

export type Placement = { side: 'above' | 'below'; left: number; width: number; inner: number; offset: number };

const rowsIn = (text: string, width: number) => wrapped(text, width).row + 1;

/** The rows a bubble of `width` cells takes. */
export function bubbleRows(view: CardView, width: number): number {
  const inner = width - FRAME_COLUMNS;
  const changes = view.changes.reduce((rows, line) => rows + rowsIn(`· ${line}`, inner), view.changes.length > 0 ? 1 : 0);
  const related = view.related.length + (view.more === null ? 0 : 1);
  return FRAME_ROWS + rowsIn(view.head, inner - CLOSE_COLUMNS) + 1 + rowsIn(view.sentence, inner) + changes + related;
}

/** What a transcript block knows of the screen: its cells across, and which of its rows are shown (null: none, absent: not said). */
export type BlockScreen = { columns: number; onScreen?: { first: number; last: number; of: number } | null };

/**
 * The bubble goes above the link's row. Later messages paint over what leaves the block, so it goes below only when the rows shown above
 * cannot hold it and the block's own rows under the link's unit hold more. Clamped to fit the block.
 */
export function placeBubble(anchor: Anchor, view: CardView, screen: BlockScreen): Placement {
  const width = Math.min(BUBBLE_COLUMNS, screen.columns);
  const left = Math.max(0, Math.min(anchor.column, screen.columns - width));
  const shown = screen.onScreen;
  const inner = width - FRAME_COLUMNS;
  const above = shown == null || shown.first === 0 ? Infinity : anchor.row + 1 - shown.first;
  const below = shown == null || anchor.tail === '' ? 0 : shown.last - anchor.row - 2;
  const isAbove = above >= bubbleRows(view, width) || above >= below;
  return { side: isAbove ? 'above' : 'below', left, width, inner, offset: isAbove ? anchor.rowsBelow + 1 : -anchor.rowsBelow - anchor.gap };
}

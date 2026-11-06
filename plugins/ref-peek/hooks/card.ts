// What the note and the card say for a ref; the tree around it is register.tsx's.
import type { Facts } from './cache';
import { plainTitle } from './summary';
import type { Summary } from './summary';
import { t } from './strings';
import type { PeekRef } from '../types';

export type CardView = { head: string; repo: string; sentence: string; changes: string[] };

export function stateLabel(facts: Facts): string {
  const isOpen = facts.state === 'open';
  if (!facts.isPr) return isOpen ? t.issueOpen : t.issueClosed;
  if (facts.isMerged) return t.prMerged;
  if (!isOpen) return t.prClosed;
  return facts.isDraft ? t.prDraft : t.prOpen;
}

function kindLabel(facts: Facts): string {
  if (facts.isPr) return 'PR';
  return facts.isSpec ? 'Spec' : 'Ticket';
}

/** The note after a mention: the summary, the original title until there is one. */
export function glossOf(facts: Facts, summary: Summary | null): string {
  return summary?.summary ?? plainTitle(facts.title);
}

/** `isPending`: no summary yet and one still to come; without it, a missing summary is a failed generation. */
export function cardView(ref: PeekRef, facts: Facts, summary: Summary | null, isPending: boolean): CardView {
  return {
    head: `${kindLabel(facts)} #${ref.number} ${summary?.title ?? plainTitle(facts.title)} · ${stateLabel(facts)}`,
    repo: ref.repo,
    sentence: summary?.summary ?? (isPending ? t.pending : t.noSummary),
    changes: summary?.changes ?? [],
  };
}

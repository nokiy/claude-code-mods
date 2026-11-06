// What the note and the card say for a ref; the tree around it is register.tsx's.
import type { Facts } from './cache';
import { plainTitle } from './summary';
import type { Summary } from './summary';
import { t } from './strings';
import type { PeekRef } from '../types';

export type CardView = { head: string; repo: string; sentence: string; changes: string[] };

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

/** `isPending`: no summary yet and one still to come; without it, a missing summary is a failed generation. */
export function cardView(ref: PeekRef, facts: Facts, summary: Summary | null, isPending: boolean): CardView {
  return {
    head: `${kindLabel(facts)} #${ref.number} ${summary?.title ?? plainTitle(facts.title)} · ${stateLabel(facts)}`,
    repo: ref.repo,
    sentence: summary?.summary ?? (isPending ? t.pending : t.noSummary),
    changes: summary?.changes ?? [],
  };
}

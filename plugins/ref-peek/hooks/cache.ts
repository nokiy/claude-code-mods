// The cached entry of one ref and the decisions around it: what a gh answer does to it, and when it is due for work.
import { BODY_CAP } from './summary';
import type { Summary } from './summary';
import type { PeekRef } from '../types';

/** What `gh api repos/<o>/<r>/issues/<n>` said, reduced to what ref-peek uses. */
export type Facts = {
  title: string;
  /** Kept for the summary only; dropped once that exists. */
  body: string;
  state: string;
  isPr: boolean;
  isDraft: boolean;
  isMerged: boolean;
  isSpec: boolean;
  updatedAt: string;
};

/** `facts` null: nothing there (404) or nothing known yet; the ref is drawn as written either way. */
export type Entry = { checkedAt: number; facts: Facts | null; summary: Summary | null };

/** What a gh call came to. */
export type FetchAnswer = Facts | 'missing' | 'failed';

/** gh is asked about one ref at most this often. */
export const RECHECK_MS = 10 * 60 * 1000;
/** A generation that failed is tried once more per session. */
const SUMMARY_TRIES = 2;

export const cacheKey = (ref: PeekRef) => `${ref.repo}#${ref.number}`;

type IssueJson = {
  title?: unknown; body?: unknown; state?: unknown; draft?: unknown; updated_at?: unknown;
  labels?: Array<{ name?: unknown }>; pull_request?: { merged_at?: unknown };
};

function readJson(text: string): IssueJson | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value as IssueJson : null;
  } catch {
    return null;
  }
}

/** One answer of the issues endpoint; a PR is told by its `pull_request` key. null when it is not such an answer. */
export function parseIssue(text: string): Facts | null {
  const raw = readJson(text);
  if (raw === null || typeof raw.title !== 'string' || typeof raw.state !== 'string' || typeof raw.updated_at !== 'string') return null;
  return {
    title: raw.title,
    body: typeof raw.body === 'string' ? raw.body.slice(0, BODY_CAP) : '',
    state: raw.state,
    isPr: raw.pull_request !== undefined,
    isDraft: raw.draft === true,
    isMerged: Boolean(raw.pull_request?.merged_at),
    isSpec: Array.isArray(raw.labels) && raw.labels.some(l => l.name === 'spec'),
    updatedAt: raw.updated_at,
  };
}

export function needsCheck(entry: Entry | undefined, now: number): boolean {
  return entry === undefined || now - entry.checkedAt >= RECHECK_MS;
}

export function needsSummary(entry: Entry | undefined, failures: number): boolean {
  return entry?.facts !== null && entry?.facts !== undefined && entry.summary === null && failures < SUMMARY_TRIES;
}

export function isDue(entry: Entry | undefined, now: number, failures: number): boolean {
  return needsCheck(entry, now) || needsSummary(entry, failures);
}

/** The entry with its summary; the body has served its purpose. */
export function withSummary(entry: Entry, summary: Summary): Entry {
  return { ...entry, facts: entry.facts && { ...entry.facts, body: '' }, summary };
}

/** The entry after a check. The summary stays only for the same `updated_at`; a failed check keeps what was known. */
export function applyFetch(entry: Entry | undefined, answer: FetchAnswer, now: number): Entry {
  if (answer === 'missing') return { checkedAt: now, facts: null, summary: null };
  if (answer === 'failed') return { checkedAt: now, facts: entry?.facts ?? null, summary: entry?.summary ?? null };
  const fresh = { checkedAt: now, facts: answer, summary: null };
  const kept = entry?.facts?.updatedAt === answer.updatedAt ? entry?.summary : null;
  return kept ? withSummary(fresh, kept) : fresh;
}

const isFacts = (v: Partial<Facts> | null) => v === null || (typeof v.title === 'string' && typeof v.updatedAt === 'string');
const isSummary = (v: Partial<Summary> | null) => v === null || (typeof v.summary === 'string' && Array.isArray(v.changes));

/** A stored value as an entry; another shape (an older build's) reads as absent. */
export function asEntry(value: unknown): Entry | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { checkedAt, facts, summary } = value as Partial<Entry>;
  if (typeof checkedAt !== 'number' || facts === undefined || summary === undefined) return undefined;
  return isFacts(facts) && isSummary(summary) ? { checkedAt, facts, summary } : undefined;
}

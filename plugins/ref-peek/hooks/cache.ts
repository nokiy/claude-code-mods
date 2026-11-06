// The cached entry of one ref and the decisions around it: what a gh answer does to it, and when it is due for work.
import type { Summary } from './summary';
import type { PeekRef } from '../types';

/** A ticket a PR closes, or a PR that closes a ticket. */
export type Related = { repo: string; number: number; kind: 'PR' | 'Ticket' | 'Spec'; title: string };

/** What the GraphQL answer said, reduced to what ref-peek uses. */
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
  /** The first of the related items, and how many there are in all. Absent on an entry cached before relations were read. */
  related?: Related[];
  relatedCount?: number;
};

/** `facts` null: nothing there (404) or nothing known yet; the ref is drawn as written either way. */
export type Entry = { checkedAt: number; facts: Facts | null; summary: Summary | null };

/** What a gh call came to. */
export type FetchAnswer = Facts | 'missing' | 'failed';

/** How much of a body is kept for the prompt. */
const BODY_CAP = 4000;
/** gh is asked about one ref at most this often. */
export const RECHECK_MS = 10 * 60 * 1000;
/** A generation that failed is tried once more per session. */
const SUMMARY_TRIES = 2;

export const cacheKey = (ref: PeekRef) => `${ref.repo}#${ref.number}`;

/** How many related items one answer carries. */
export const RELATED_MAX = 4;

const LABELS = 'labels(first: 20) { nodes { name } }';
const QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $number) {
      __typename
      ... on PullRequest {
        title body state isDraft updatedAt ${LABELS}
        closingIssuesReferences(first: ${RELATED_MAX}) { totalCount nodes { number title ${LABELS} repository { nameWithOwner } } }
      }
      ... on Issue {
        title body state updatedAt ${LABELS}
        closedByPullRequestsReferences(first: ${RELATED_MAX}, includeClosedPrs: true) { totalCount nodes { number title repository { nameWithOwner } } }
      }
    }
  }
}`;

/** The `gh` command that asks about one ref and what relates to it. */
export function issueCommand(ref: PeekRef): string[] {
  const [owner = '', name = ''] = ref.repo.split('/');
  return ['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${ref.number}`];
}

type Labels = { nodes?: Array<{ name?: unknown }> };
type RelatedNode = { number?: unknown; title?: unknown; labels?: Labels; repository?: { nameWithOwner?: unknown } };
type Connection = { totalCount?: unknown; nodes?: RelatedNode[] };
type IssueNode = {
  __typename?: unknown; title?: unknown; body?: unknown; state?: unknown; isDraft?: unknown; updatedAt?: unknown; labels?: Labels;
  closingIssuesReferences?: Connection; closedByPullRequestsReferences?: Connection;
};
type Answer = { data?: { repository?: { issueOrPullRequest?: IssueNode | null } | null }; errors?: Array<{ type?: unknown }> };

function readJson(text: string): Answer | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? value as Answer : null;
  } catch {
    return null;
  }
}

const isSpecLabelled = (labels: Labels | undefined) => labels?.nodes?.some(l => l.name === 'spec') === true;

function relatedOf(node: RelatedNode, kind: Related['kind']): Related | null {
  const repo = node.repository?.nameWithOwner;
  if (typeof node.number !== 'number' || typeof node.title !== 'string' || typeof repo !== 'string') return null;
  return { repo, number: node.number, kind, title: node.title };
}

function relatedNodes(connection: Connection | undefined, isPr: boolean): Related[] {
  const kindOf = (node: RelatedNode) => (isPr ? (isSpecLabelled(node.labels) ? 'Spec' : 'Ticket') : 'PR');
  return (connection?.nodes ?? []).flatMap(node => relatedOf(node, kindOf(node)) ?? []);
}

/** One answer of `issueCommand`, whatever gh's exit code: it fails on a number nothing has, and says why here. */
export function parseIssue(text: string): FetchAnswer {
  const raw = readJson(text);
  if (raw?.errors?.some(e => e.type === 'NOT_FOUND') === true) return 'missing';
  const node = raw?.data?.repository?.issueOrPullRequest;
  if (node == null || typeof node.title !== 'string' || typeof node.state !== 'string' || typeof node.updatedAt !== 'string') return 'failed';
  const isPr = node.__typename === 'PullRequest';
  const connection = isPr ? node.closingIssuesReferences : node.closedByPullRequestsReferences;
  const related = relatedNodes(connection, isPr);
  return {
    title: node.title,
    body: typeof node.body === 'string' ? node.body.slice(0, BODY_CAP) : '',
    state: node.state === 'MERGED' ? 'closed' : node.state.toLowerCase(),
    isPr,
    isDraft: node.isDraft === true,
    isMerged: node.state === 'MERGED',
    isSpec: isSpecLabelled(node.labels),
    updatedAt: node.updatedAt,
    related,
    relatedCount: typeof connection?.totalCount === 'number' ? connection.totalCount : related.length,
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

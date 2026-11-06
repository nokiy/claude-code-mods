// Cache decisions: what an answer from gh does to an entry, and when a ref is due for work.
import { expect, test } from 'claude-code/testing';
import { RECHECK_MS, applyFetch, isDue, issueCommand, needsCheck, needsSummary, parseIssue, withSummary } from '../hooks/cache';
import type { Entry, Facts } from '../hooks/cache';

// Field shapes as the GraphQL query answers them.
const LABELS = { nodes: [] };
const PR_NODE = { __typename: 'PullRequest', title: 'feat(ref-peek): 编号带说明', body: '正文', state: 'OPEN', isDraft: true, updatedAt: '2026-11-06T03:37:24Z', labels: LABELS };
const ISSUE_NODE = { __typename: 'Issue', title: '[ref-peek] 编号', body: null, state: 'OPEN', updatedAt: '2026-11-06T03:35:28Z', labels: { nodes: [{ name: 'spec' }] } };
const answer = (node: object | null) => JSON.stringify({ data: { repository: { issueOrPullRequest: node } } });
const REPOSITORY = { nameWithOwner: 'o/r' };

const FACTS: Facts = { title: 't', body: 'b', state: 'open', isPr: false, isDraft: false, isMerged: false, isSpec: false, updatedAt: 'u1' };
const SUMMARY = { title: '短', summary: '一句话', changes: [] };
const entry = (over: Partial<Entry> = {}): Entry => ({ checkedAt: 0, facts: FACTS, summary: SUMMARY, ...over });

test('a PR is told by its type, and a merge by its state', () => {
  expect(parseIssue(answer(PR_NODE))).toMatchObject({ isPr: true, isDraft: true, isMerged: false, state: 'open', updatedAt: '2026-11-06T03:37:24Z' });
  expect(parseIssue(answer({ ...PR_NODE, isDraft: false, state: 'MERGED' }))).toMatchObject({ isMerged: true, state: 'closed' });
  expect(parseIssue(answer({ ...PR_NODE, isDraft: false, state: 'CLOSED' }))).toMatchObject({ isMerged: false, state: 'closed' });
});

test('an issue reads as an issue, a null body as empty and a spec by its label', () => {
  expect(parseIssue(answer(ISSUE_NODE))).toMatchObject({ isPr: false, isDraft: false, isMerged: false, isSpec: true, body: '' });
});

test('a number GitHub does not know is missing, whatever else the answer holds', () => {
  expect(parseIssue(JSON.stringify({ data: { repository: { issueOrPullRequest: null } }, errors: [{ type: 'NOT_FOUND' }] }))).toBe('missing');
});

test('an answer that says nothing is a failure', () => {
  for (const text of ['', 'nope', '[]', '{"title":"x"}', answer(null), answer({ title: 'x' })]) expect(parseIssue(text)).toBe('failed');
  expect(parseIssue(JSON.stringify({ errors: [{ type: 'RATE_LIMITED' }] }))).toBe('failed');
});

test('a body is kept cut to what the prompt uses', () => {
  const facts = parseIssue(answer({ ...ISSUE_NODE, body: 'x'.repeat(9000) })) as Facts;
  expect(facts.body.length).toBe(4000);
});

test('a PR lists the tickets it closes, a spec by its label', () => {
  const closing = { totalCount: 6, nodes: [
    { number: 59, title: '票', labels: LABELS, repository: REPOSITORY },
    { number: 7, title: '规格', labels: { nodes: [{ name: 'spec' }] }, repository: { nameWithOwner: 'a/b' } },
  ] };
  expect(parseIssue(answer({ ...PR_NODE, closingIssuesReferences: closing }))).toMatchObject({
    related: [{ repo: 'o/r', number: 59, kind: 'Ticket', title: '票' }, { repo: 'a/b', number: 7, kind: 'Spec', title: '规格' }],
    relatedCount: 6,
  });
});

test('a ticket lists the PRs that close it', () => {
  const closedBy = { totalCount: 1, nodes: [{ number: 60, title: 'PR', repository: REPOSITORY }] };
  expect(parseIssue(answer({ ...ISSUE_NODE, closedByPullRequestsReferences: closedBy }))).toMatchObject({
    related: [{ repo: 'o/r', number: 60, kind: 'PR', title: 'PR' }],
    relatedCount: 1,
  });
});

test('nothing related reads as an empty list, a malformed related item as absent', () => {
  expect(parseIssue(answer(PR_NODE))).toMatchObject({ related: [], relatedCount: 0 });
  const broken = { totalCount: 1, nodes: [{ number: 'x', title: 1 }] };
  expect(parseIssue(answer({ ...PR_NODE, closingIssuesReferences: broken }))).toMatchObject({ related: [] });
});

test('the command asks by owner, name and number', () => {
  const argv = issueCommand({ repo: 'o/r', number: 52 });
  expect(argv.slice(0, 3)).toEqual(['gh', 'api', 'graphql']);
  expect(argv).toContain('owner=o');
  expect(argv).toContain('name=r');
  expect(argv).toContain('number=52');
});

test('nothing cached is due, a fresh check is not, ten minutes later it is', () => {
  expect(needsCheck(undefined, 0)).toBe(true);
  expect(needsCheck(entry({ checkedAt: 1000 }), 1000 + RECHECK_MS - 1)).toBe(false);
  expect(needsCheck(entry({ checkedAt: 1000 }), 1000 + RECHECK_MS)).toBe(true);
});

test('the same updated_at keeps the summary', () => {
  expect(applyFetch(entry(), FACTS, 5)).toEqual({ checkedAt: 5, facts: { ...FACTS, body: '' }, summary: SUMMARY });
});

test('a changed updated_at drops the summary so it is generated again', () => {
  const facts = { ...FACTS, updatedAt: 'u2' };
  expect(applyFetch(entry(), facts, 5)).toEqual({ checkedAt: 5, facts, summary: null });
});

test('404 is cached as nothing there', () => {
  expect(applyFetch(entry(), 'missing', 5)).toEqual({ checkedAt: 5, facts: null, summary: null });
});

test('a failed check keeps what was known and still waits its ten minutes', () => {
  expect(applyFetch(entry(), 'failed', 5)).toEqual({ checkedAt: 5, facts: FACTS, summary: SUMMARY });
  expect(applyFetch(undefined, 'failed', 5)).toEqual({ checkedAt: 5, facts: null, summary: null });
});

test('a summary is due once, then once more after a failure, then not this session', () => {
  const bare = entry({ summary: null });
  expect(needsSummary(bare, 0)).toBe(true);
  expect(needsSummary(bare, 1)).toBe(true);
  expect(needsSummary(bare, 2)).toBe(false);
  expect(needsSummary(entry(), 0)).toBe(false);
  expect(needsSummary(entry({ facts: null, summary: null }), 0)).toBe(false);
  expect(needsSummary(undefined, 0)).toBe(false);
});

test('isDue covers both kinds of work', () => {
  expect(isDue(undefined, 0, 0)).toBe(true);
  expect(isDue(entry({ checkedAt: 0, summary: null }), 1, 0)).toBe(true);
  expect(isDue(entry({ checkedAt: 0 }), 1, 0)).toBe(false);
});

test('a check carries the relations it read, and a failed one keeps the last known', () => {
  const related = [{ repo: 'o/r', number: 59, kind: 'Ticket' as const, title: '票' }];
  const facts = { ...FACTS, related, relatedCount: 1 };
  expect(applyFetch(entry(), facts, 5).facts?.related).toEqual(related);
  expect(applyFetch(entry({ facts }), 'failed', 5).facts?.related).toEqual(related);
});

test('a finished summary lets the body go', () => {
  expect(withSummary(entry({ summary: null }), SUMMARY)).toEqual({ checkedAt: 0, facts: { ...FACTS, body: '' }, summary: SUMMARY });
});

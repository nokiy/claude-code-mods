// Cache decisions: what an answer from gh does to an entry, and when a ref is due for work.
import { expect, test } from 'claude-code/testing';
import { RECHECK_MS, applyFetch, asEntry, isDue, needsCheck, needsSummary, parseIssue, withSummary } from '../hooks/cache';
import type { Entry, Facts } from '../hooks/cache';

// Field shapes as `gh api repos/<o>/<r>/issues/<n>` answers them.
const PR_JSON = { number: 60, title: 'feat(ref-peek): 编号带说明', body: '正文', state: 'open', draft: true, updated_at: '2026-11-06T03:37:24Z', labels: [], pull_request: { merged_at: null } };
const ISSUE_JSON = { number: 59, title: '[ref-peek] 编号', body: null, state: 'open', draft: null, updated_at: '2026-11-06T03:35:28Z', labels: [{ name: 'spec' }] };
const FACTS: Facts = { title: 't', body: 'b', state: 'open', isPr: false, isDraft: false, isMerged: false, isSpec: false, updatedAt: 'u1' };
const SUMMARY = { title: '短', summary: '一句话', changes: [] };
const entry = (over: Partial<Entry> = {}): Entry => ({ checkedAt: 0, facts: FACTS, summary: SUMMARY, ...over });

test('a PR is told by its pull_request key', () => {
  expect(parseIssue(JSON.stringify(PR_JSON))).toMatchObject({ isPr: true, isDraft: true, isMerged: false, updatedAt: '2026-11-06T03:37:24Z' });
  expect(parseIssue(JSON.stringify({ ...PR_JSON, draft: false, state: 'closed', pull_request: { merged_at: '2026-11-06T04:00:00Z' } }))).toMatchObject({ isMerged: true, state: 'closed' });
});

test('an issue reads as an issue, a null body as empty and a spec by its label', () => {
  expect(parseIssue(JSON.stringify(ISSUE_JSON))).toMatchObject({ isPr: false, isDraft: false, isMerged: false, isSpec: true, body: '' });
});

test('an answer that is not an issue is no answer', () => {
  for (const text of ['', 'nope', '[]', '{"title":"x"}']) expect(parseIssue(text)).toBeNull();
});

test('a body is kept cut to what the prompt uses', () => {
  expect(parseIssue(JSON.stringify({ ...ISSUE_JSON, body: 'x'.repeat(9000) }))?.body.length).toBe(4000);
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

test('a finished summary lets the body go', () => {
  expect(withSummary(entry({ summary: null }), SUMMARY)).toEqual({ checkedAt: 0, facts: { ...FACTS, body: '' }, summary: SUMMARY });
});

test('a stored value of another shape reads as absent', () => {
  expect(asEntry(entry())).toEqual(entry());
  expect(asEntry(entry({ facts: null, summary: null }))).toEqual(entry({ facts: null, summary: null }));
  for (const value of [undefined, null, 'x', {}, { checkedAt: 'x', facts: null, summary: null }, { checkedAt: 1, facts: {}, summary: null }]) {
    expect(asEntry(value)).toBeUndefined();
  }
});

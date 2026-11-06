// What the bubble and the note say for an entry and where the bubble stands; the drawing itself is covered in peek.test.ts.
import { expect, test } from 'claude-code/testing';
import type { Entry, Facts } from '../hooks/cache';
import { bareView, bubbleRows, cardView, fit, glossOf, placeBubble, stateLabel } from '../hooks/card';
import type { Anchor } from '../hooks/refs';

const FACTS: Facts = { title: '[x] 原标题', body: '', state: 'open', isPr: true, isDraft: false, isMerged: false, isSpec: false, updatedAt: 'u' };
const pr = (over: Partial<Facts>) => ({ ...FACTS, ...over });
const issue = (over: Partial<Facts>) => pr({ isPr: false, ...over });
const ENTRY: Entry = { checkedAt: 0, facts: FACTS, summary: { title: '积分兑换', summary: '用户能兑换商品', changes: ['新增按钮'] } };

test('every state reads as the ticket body names it', () => {
  expect(stateLabel(pr({ isDraft: true }))).toBe('开发中');
  expect(stateLabel(pr({}))).toBe('待验收');
  expect(stateLabel(pr({ state: 'closed', isMerged: true }))).toBe('已合并');
  expect(stateLabel(pr({ state: 'closed' }))).toBe('已关闭');
  expect(stateLabel(issue({}))).toBe('进行中');
  expect(stateLabel(issue({ state: 'closed' }))).toBe('已完成');
});

test('the note is the summary once there is one, the original title until then', () => {
  expect(glossOf(ENTRY.facts!, ENTRY.summary)).toBe('用户能兑换商品');
  expect(glossOf(FACTS, null)).toBe('原标题');
});

test('a card with a summary', () => {
  expect(cardView({ repo: 'o/r', number: 52 }, FACTS, ENTRY.summary, false)).toEqual({
    head: 'PR #52 积分兑换 · 待验收',
    repo: 'o/r',
    sentence: '用户能兑换商品',
    changes: ['新增按钮'],
    related: [],
    more: null,
  });
});

test('a card whose generation failed keeps the original title and says so', () => {
  expect(cardView({ repo: 'o/r', number: 52 }, FACTS, null, false)).toEqual({
    head: 'PR #52 原标题 · 待验收',
    repo: 'o/r',
    sentence: '暂无说明',
    changes: [],
    related: [],
    more: null,
  });
});

test('a card still waiting for its summary says that instead', () => {
  expect(cardView({ repo: 'o/r', number: 52 }, FACTS, null, true).sentence).toBe('生成中…');
});

test('an issue is a Ticket, or a Spec by its label', () => {
  expect(cardView({ repo: 'o/r', number: 7 }, issue({}), null, false).head).toBe('Ticket #7 原标题 · 进行中');
  expect(cardView({ repo: 'o/r', number: 7 }, issue({ isSpec: true }), null, false).head).toBe('Spec #7 原标题 · 进行中');
});

const related = (number: number, kind: 'PR' | 'Ticket' | 'Spec' = 'Ticket') => ({ repo: 'o/r', number, kind, title: `[x] 第 ${number} 号。` });

test('a PR\'s rows read 关联, a ticket\'s 所属, each with its kind, number and a plain title', () => {
  const prRows = cardView({ repo: 'o/r', number: 60 }, pr({ related: [related(59), related(7, 'Spec')], relatedCount: 2 }), null, false);
  expect(prRows.related).toEqual([
    { ref: { repo: 'o/r', number: 59 }, label: '关联 Ticket #59 第 59 号' },
    { ref: { repo: 'o/r', number: 7 }, label: '关联 Spec #7 第 7 号' },
  ]);
  const ticketRows = cardView({ repo: 'o/r', number: 59 }, issue({ related: [related(60, 'PR')], relatedCount: 1 }), null, false);
  expect(ticketRows.related[0]?.label).toBe('所属 PR #60 第 60 号');
});

test('four rows at most, the rest counted', () => {
  const items = [1, 2, 3, 4].map(n => related(n));
  const view = cardView({ repo: 'o/r', number: 60 }, pr({ related: items, relatedCount: 7 }), null, false);
  expect(view.related.length).toBe(4);
  expect(view.more).toBe('还有 3 个');
  expect(cardView({ repo: 'o/r', number: 60 }, pr({ related: items, relatedCount: 4 }), null, false).more).toBeNull();
});

test('an entry cached before relations were read has no rows', () => {
  const view = cardView({ repo: 'o/r', number: 60 }, FACTS, null, false);
  expect([view.related, view.more]).toEqual([[], null]);
});

test('a ref nothing is known of shows its number and what it is waiting for', () => {
  expect(bareView({ repo: 'o/r', number: 9 }, true)).toMatchObject({ head: '#9', repo: 'o/r', sentence: '生成中…' });
  expect(bareView({ repo: 'o/r', number: 9 }, false).sentence).toBe('暂无说明');
});

test('a label is cut by cells, Chinese counting two', () => {
  expect(fit('短', 10)).toBe('短');
  expect(fit('一二三四五六', 7)).toBe('一二三…');
  expect(fit('abcdefgh', 5)).toBe('abcd…');
});

const VIEW = cardView({ repo: 'o/r', number: 52 }, FACTS, ENTRY.summary, false);
const anchor = (over: Partial<Anchor>): Anchor => ({ through: 'x', tail: 'y', gap: 1, rowsBelow: 0, column: 10, row: 30, ...over });

test('a bubble counts its frame, head, repo, sentence, changes and rows', () => {
  expect(bubbleRows(VIEW, 76)).toBe(2 + 1 + 1 + 1 + 2);
  expect(bubbleRows({ ...VIEW, sentence: '一'.repeat(60) }, 76)).toBe(2 + 1 + 1 + 2 + 2);
  expect(bubbleRows({ ...VIEW, related: [{ ref: { repo: 'o/r', number: 1 }, label: 'x' }], more: '还有 3 个' }, 76)).toBe(2 + 1 + 1 + 1 + 2 + 2);
});

test('the bubble stands above the row, clear of the rows left in the unit', () => {
  const at = placeBubble(anchor({ rowsBelow: 2 }), VIEW, { columns: 118, onScreen: { first: 0, last: 39, of: 60 } });
  expect(at).toEqual({ side: 'above', left: 10, width: 76, inner: 72, offset: 3 });
});

test('it starts at the link and stays inside the block', () => {
  expect(placeBubble(anchor({ column: 100 }), VIEW, { columns: 118 }).left).toBe(42);
  expect(placeBubble(anchor({ column: 100 }), VIEW, { columns: 60 })).toMatchObject({ left: 0, width: 60, inner: 56 });
});

test('with the rows shown above too few, it goes below inside the block', () => {
  const at = placeBubble(anchor({ rowsBelow: 1 }), VIEW, { columns: 118, onScreen: { first: 28, last: 60, of: 70 } });
  expect(at).toMatchObject({ side: 'below', offset: -2 });
});

test('it stays above when nothing under it is the block\'s, or more rows are shown above', () => {
  expect(placeBubble(anchor({ tail: '' }), VIEW, { columns: 118, onScreen: { first: 28, last: 60, of: 70 } }).side).toBe('above');
  expect(placeBubble(anchor({}), VIEW, { columns: 118, onScreen: { first: 26, last: 32, of: 70 } }).side).toBe('above');
});

test('a block with its top row shown, or not said, counts as having room', () => {
  expect(placeBubble(anchor({ row: 1 }), VIEW, { columns: 118, onScreen: { first: 0, last: 30, of: 31 } }).side).toBe('above');
  expect(placeBubble(anchor({ row: 1 }), VIEW, { columns: 118, onScreen: null }).side).toBe('above');
  expect(placeBubble(anchor({ row: 1 }), VIEW, { columns: 118 }).side).toBe('above');
});

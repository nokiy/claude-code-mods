// What the card and the note say for an entry; the drawing itself is covered in peek.test.ts.
import { expect, test } from 'claude-code/testing';
import type { Entry, Facts } from '../hooks/cache';
import { cardView, glossOf, stateLabel } from '../hooks/card';

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
  });
});

test('a card whose generation failed keeps the original title and says so', () => {
  expect(cardView({ repo: 'o/r', number: 52 }, FACTS, null, false)).toEqual({
    head: 'PR #52 原标题 · 待验收',
    repo: 'o/r',
    sentence: '暂无说明',
    changes: [],
  });
});

test('a card still waiting for its summary says that instead', () => {
  expect(cardView({ repo: 'o/r', number: 52 }, FACTS, null, true).sentence).toBe('生成中…');
});

test('an issue is a Ticket, or a Spec by its label', () => {
  expect(cardView({ repo: 'o/r', number: 7 }, issue({}), null, false).head).toBe('Ticket #7 原标题 · 进行中');
  expect(cardView({ repo: 'o/r', number: 7 }, issue({ isSpec: true }), null, false).head).toBe('Spec #7 原标题 · 进行中');
});

// Unit tests for the pure helpers (CI fold, cell widths, wrapping, git ticket status), all on synthetic data.
import { describe, expect, test } from 'claude-code/testing';
import type { PrTicket, TicketStatus } from '../types';
import type { TicketFacts } from './parse';
import { bodyClosingNumbers, closingNumbers, mergedByCommits, parseAcceptance, parseCi, relTime, shortTitle, sortTickets, summarize, ticketBranches, ticketStatus, truncate, width, wrapCells } from './parse';
import { strings } from './strings';

describe('parseCi', () => {
  test('folds CheckRun and StatusContext', () => {
    const ci = parseCi([
      { status: 'COMPLETED', conclusion: 'SUCCESS' },
      { status: 'COMPLETED', conclusion: 'FAILURE' },
      { status: 'IN_PROGRESS', conclusion: '' },
      { state: 'SUCCESS' },
    ]);
    expect(ci).toEqual({ ok: 2, fail: 1, pending: 1, total: 4 });
  });
  test('empty', () => {
    expect(parseCi([]).total).toBe(0);
  });
});

describe('cell widths', () => {
  test('truncate cuts by cells with an ellipsis', () => {
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(truncate('abc', 4)).toBe('abc');
    expect(truncate('中文标题很长', 5)).toBe('中文…');
  });
  test('wrapCells: one row, two rows, and a cut last row', () => {
    expect(wrapCells('abc', 5, 2)).toEqual(['abc']);
    expect(wrapCells('abcdefgh', 5, 2)).toEqual(['abcde', 'fgh']);
    expect(wrapCells('abcdefghijklmno', 5, 2)).toEqual(['abcde', 'fghi…']);
    expect(wrapCells('中文标题很长', 4, 2)).toEqual(['中文', '标…']);
    expect(wrapCells('', 5, 2)).toEqual([]);
  });
});

describe('parseAcceptance', () => {
  const TABLE = `## Acceptance
| Item | Target/source | State | Rounds | Rewrites |
|------|---------------|-------|--------|----------|
| a | x | ✓ | 0 | 0 |
| b | y | ✅ done | 2 | 0 |
| c | z | DONE | 1 | 0 |
| d | w | ✗ | 3 | 1 |
| e | v | needs-info | 0 | 0 |

after`;
  test('counts rows, ✓/✅/done and max rounds', () => {
    expect(parseAcceptance(TABLE)).toEqual({ done: 3, total: 5, maxRounds: 3 });
  });
  test('no table -> null', () => {
    expect(parseAcceptance('just text\n| a | b |\n|---|---|\n| 1 | 2 |')).toBeNull();
  });
  test('a table without State/Rounds is skipped for a later one', () => {
    expect(parseAcceptance(`| a | b |\n|---|---|\n| 1 | 2 |\n\n${TABLE}`)?.total).toBe(5);
  });
});

describe('ticket status from git', () => {
  const names = [
    'dev', 'worktree-14-x', 'feat/14-theme-toggle', 'origin/feat/14-theme-toggle',
    'fix/16-save-settings', 'origin/docs/17-wrapup', 'spec/12-dark-mode', 'feat/140-other',
  ];
  test('branch matching: (^|/)N-, no worktree-*', () => {
    expect(ticketBranches(14, names)).toEqual(['feat/14-theme-toggle', 'origin/feat/14-theme-toggle']);
    expect(ticketBranches(17, names)).toEqual(['origin/docs/17-wrapup']);
    expect(ticketBranches(13, names)).toEqual([]);
    expect(ticketBranches(14, ['worktree-14-x'])).toEqual([]);
  });
  const F = (o: Partial<TicketFacts> = {}): TicketFacts => ({ isHead: false, counts: [], isMerged: false, ...o });
  test('status rules: CLOSED or an all-✓ table is done and overrides git', () => {
    expect(ticketStatus('CLOSED', null, F({ counts: [5] }))).toBe('done');
    expect(ticketStatus('OPEN', { done: 3, total: 3, maxRounds: 0 }, F({ counts: [4], isHead: true }))).toBe('done');
    expect(ticketStatus('OPEN', { done: 0, total: 0, maxRounds: 0 }, F())).toBe('todo');
    expect(ticketStatus('OPEN', { done: 2, total: 3, maxRounds: 0 }, F({ isMerged: true }))).toBe('merged');
  });
  test('status rules: head branch or a branch ahead is doing; branches alone never mean merged', () => {
    expect(ticketStatus('OPEN', null, F({ isHead: true }))).toBe('doing');
    expect(ticketStatus('OPEN', null, F({ counts: [0, 3] }))).toBe('doing');
    expect(ticketStatus('OPEN', null, F({ counts: [0, 3], isMerged: true }))).toBe('doing');
    // Every branch fully merged, no headline: not started (the old rule said merged).
    expect(ticketStatus('OPEN', null, F({ counts: [0, 0] }))).toBe('todo');
  });
  test('status rules: a deleted branch plus a headline is merged; neither is not started', () => {
    expect(ticketStatus('OPEN', null, F({ isMerged: true }))).toBe('merged');
    expect(ticketStatus('OPEN', null, F())).toBe('todo');
  });
  test('mergedByCommits: strict <type>(#N): headlines and merge headlines naming /N-', () => {
    const heads = [
      'feat(#5): add toggle',
      'fix(#6): repair it',
      'docs: absorb #7 into notes',
      'chore: 吸收 #8',
      "Merge branch 'fix/9-thing' into spec/1-demo",
      'Merge pull request #3 from org/feat/10-other',
      'refactor(#11) missing colon',
      'fix: see feat(#12): quoted',
    ];
    expect([...mergedByCommits(heads, [5, 6, 7, 8, 9, 10, 11, 12, 13])].sort((a, b) => a - b)).toEqual([5, 6, 9, 10]);
    // Numbers not asked for are ignored.
    expect([...mergedByCommits(heads, [6])]).toEqual([6]);
    expect(mergedByCommits([], [1]).size).toBe(0);
  });
  const mk = (number: number, status: TicketStatus): PrTicket => ({ number, title: '', state: '', progress: null, status, branch: null, ahead: 0 });
  test('summarize: merged = merged + done, accepted = done', () => {
    expect(summarize([mk(1, 'merged'), mk(2, 'done'), mk(3, 'todo'), mk(4, 'doing')])).toEqual({ merged: 2, done: 1, total: 4 });
  });
  test('sortTickets: in progress, not started, merged, done, stable within a status', () => {
    const sorted = sortTickets([mk(1, 'done'), mk(2, 'merged'), mk(3, 'todo'), mk(4, 'doing'), mk(5, 'doing'), mk(6, 'merged')]);
    expect(sorted.map(x => x.number)).toEqual([4, 5, 3, 2, 6, 1]);
  });
});

describe('closing numbers', () => {
  test('body keywords, any case, de-duplicated in order', () => {
    const body = 'Add dark mode\n\nCloses #18\nfixes #7, resolves #18\nRESOLVED #3';
    expect(bodyClosingNumbers(body)).toEqual([18, 7, 3]);
  });

  test('skips other-repo refs and non-closing mentions', () => {
    expect(bodyClosingNumbers('Closes octo/other#5\nSee #9\nrelated to #4\nFixes #6')).toEqual([6]);
    expect(bodyClosingNumbers('')).toEqual([]);
  });

  test('references win; the body is only the fallback', () => {
    expect(closingNumbers({ closingIssuesReferences: [{ number: 12 }], body: 'Closes #18' })).toEqual([12]);
    expect(closingNumbers({ closingIssuesReferences: [], body: 'Closes #18' })).toEqual([18]);
    expect(closingNumbers({})).toEqual([]);
  });
});

describe('shortTitle', () => {
  test('cuts at —— , " — " or （ then truncates', () => {
    expect(shortTitle('设置页 ② · 主题按系统切换——台账 / 标定（吸收 #3）', 30)).toBe('设置页 ② · 主题按系统切换');
    expect(shortTitle('Dark mode · 深色 — Feature Spec', 30)).toBe('Dark mode · 深色');
    expect(shortTitle('标题（备注）', 30)).toBe('标题');
    expect(width(shortTitle('一二三四五六七八九十一二三四五六七八九十', 30))).toBeLessThanOrEqual(30);
  });
});

describe('relTime', () => {
  const NOW = Date.parse('2026-01-10T12:00:00Z');
  const en = strings('en');
  const zh = strings('zh');
  test('English and Chinese, from seconds to days', () => {
    expect(relTime('2026-01-10T11:59:50Z', NOW, en)).toBe('just now');
    expect(relTime('2026-01-10T11:55:00Z', NOW, en)).toBe('5 min ago');
    expect(relTime('2026-01-10T10:00:00Z', NOW, en)).toBe('2 h ago');
    expect(relTime('2026-01-07T12:00:00Z', NOW, en)).toBe('3 d ago');
    expect(relTime('2026-01-10T10:00:00Z', NOW, zh)).toBe('2 小时前');
    expect(relTime('nope', NOW, en)).toBe('unknown');
  });
});

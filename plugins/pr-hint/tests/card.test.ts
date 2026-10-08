// Tests the AbovePrompt card text (two-line header with its bar, ordered full ticket lines), the hint layout and the hint spans, on synthetic data.
import { expect, test } from 'claude-code/testing';
import type { PrData, PrTicket } from '../types';
import { cardLines, hintLayout, hintSpans, refreshText, ticketSubjects, withoutAgents } from '../hooks/card';
import { width } from '../hooks/parse';
import { strings } from '../hooks/strings';

const en = strings('en');
const zh = strings('zh');
const NOW = Date.parse('2026-01-10T11:00:00Z');
const SPEC = { number: 12, title: 'Dark mode · 深色模式贯穿设置页与编辑器，系统主题自动跟随与手动切换 — Feature Spec' };
const base: PrData = {
  where: { cwd: '/tmp/x', root: '/tmp/x', branch: 'spec/12-dark-mode' },
  number: 15, title: 'short title', state: 'OPEN', isDraft: false, base: 'main', head: 'spec/12-dark-mode',
  url: 'u', fetchedAt: NOW - 30_000, ci: { ok: 1, fail: 0, pending: 0, total: 1 }, tickets: [], spec: SPEC,
};
const t = (number: number, status: PrTicket['status'], over: Partial<PrTicket> = {}): PrTicket => ({
  number, title: `title ${number}`, state: 'OPEN', progress: null, status, branch: null, ahead: 0, ...over,
});
const many = (n: number, status: PrTicket['status'] = 'merged') => Array.from({ length: n }, (_, i) => t(i + 1, status));
const texts = (pr: PrData, inner = 90, s = en) => cardLines(pr, NOW, inner, s).lines.map(l => l.text);

// The bar run: filled cells then empty cells, nothing else.
const BAR = /█*░*/u;
const bar = (l: string) => / (█*░+|█+) Tickets /u.exec(l)?.[1] ?? '';

test('header is two lines: PR #n, title, bar, Tickets d/n, Spec #n; then ◐ N running; tickets follow', () => {
  const out = texts({ ...base, tickets: many(10) });
  expect(out[0]).toMatch(/^PR #15 short title █+ Tickets 10\/10 · Spec #12$/);
  expect(out[1]).toBe('◐ 0 running');
  expect(out.slice(2)).toHaveLength(10);
  expect(out.slice(2).every(l => l.startsWith('●'))).toBe(true);
});

test('header has no Draft / Ready word and no percent, Draft or Ready, in both languages', () => {
  for (const s of [en, zh]) {
    for (const isDraft of [true, false]) {
      const head = texts({ ...base, isDraft, tickets: [t(1, 'doing'), t(2, 'done')] }, 90, s).slice(0, 2).join('\n');
      expect(head).not.toMatch(/Draft|Ready|%/);
    }
  }
});

test('Tickets d/n counts merged and done only', () => {
  const tickets = [t(1, 'todo'), t(2, 'doing'), t(3, 'merged'), t(4, 'done')];
  expect(texts({ ...base, tickets })[0]).toContain(' Tickets 2/4 ');
});

test('the bar is 20 cells, fills d/n of them, and Tickets · Spec follow it; the line does not stretch to titleInner', () => {
  const tickets = [t(1, 'todo'), t(2, 'merged')];
  for (const room of [80, 144]) {
    const l = cardLines({ ...base, tickets }, NOW, room + 10, en, room).lines[0]!.text;
    const b = bar(l);
    expect(b.length).toBe(20);
    expect([...b].filter(c => c === '█').length).toBe(10);
    expect(BAR.exec(b)?.[0]).toBe(b);
    // `PR #15 short title ` (19) + bar (20) + ` Tickets 1/2 · Spec #12` (23).
    expect(width(l)).toBe(62);
  }
});

test('a long title is cut with … and the bar, Tickets and Spec stay, wide or narrow', () => {
  const wide = cardLines({ ...base, title: 'x'.repeat(300), tickets: many(2) }, NOW, 150, en, 144).lines[0]!.text;
  expect(width(wide)).toBe(144);
  expect(wide).toMatch(/^PR #15 x+… █{20} Tickets 2\/2 · Spec #12$/);
  const narrow = cardLines({ ...base, title: 'x'.repeat(300), tickets: many(2) }, NOW, 60, en, 50).lines[0]!.text;
  expect(width(narrow)).toBeLessThanOrEqual(50);
  expect(narrow).toMatch(/^PR #15 x+… █{10,20} Tickets 2\/2 · Spec #12$/);
});

test('no Spec: line 1 ends at Tickets d/n; no tickets reads Tickets 0/0 with an empty bar', () => {
  const l = texts({ ...base, spec: null })[0]!;
  expect(l).toMatch(/^PR #15 short title ░+ Tickets 0\/0$/);
});

test('◐ N running counts tickets in progress; colours: PR number cyan bold, ◐ yellow', () => {
  const { lines } = cardLines({ ...base, tickets: [t(1, 'doing'), t(2, 'doing'), t(3, 'todo')] }, NOW, 90, zh);
  expect(lines[1]?.text).toBe('◐ 2 running');
  expect(lines[1]?.parts[0]).toEqual({ text: '◐', color: 'yellow' });
  expect(lines[0]?.parts[0]).toEqual({ text: 'PR #15', color: 'cyan', bold: true });
});

test('every ticket gets a full line, none dropped: 30 tickets, 30 lines', () => {
  const out = texts({ ...base, tickets: many(30) }).filter(l => l.startsWith('●'));
  expect(out).toHaveLength(30);
  expect(out[0]).toBe('● #1 Merged title 1');
});

test('ticket line: status, short title, dim branch, N commits behind (no per-row counts)', () => {
  const doing = t(16, 'doing', {
    title: '保存设置——细节', branch: 'fix/16-save-settings', ahead: 3, progress: { done: 1, total: 3, maxRounds: 2 },
  });
  const { lines } = cardLines({ ...base, tickets: [doing] }, NOW, 90, en);
  const l = lines.at(-1);
  expect(l?.text).toBe('● #16 running 保存设置 · fix/16-save-settings · 3 commits behind');
  expect(l?.parts.find(p => p.text.includes('fix/16'))?.dim).toBe(true);
  expect(l?.parts.filter(p => p.color).map(p => [p.text, p.color]).slice(0, 2)).toEqual([['●', 'yellow'], ['running', 'yellow']]);
  // Merged with a branch but nothing ahead: branch shown, no "behind".
  const merged = cardLines({ ...base, tickets: [t(9, 'merged', { branch: 'feat/9-x' })] }, NOW, 90, en).lines.at(-1);
  expect(merged?.text).toBe('● #9 Merged title 9 · feat/9-x');
});

test('Chinese strings: the same card in Chinese', () => {
  const doing = t(16, 'doing', { branch: 'fix/16-save-settings', ahead: 3, progress: { done: 1, total: 3, maxRounds: 0 } });
  const out = texts({ ...base, tickets: [doing, t(9, 'todo')] }, 90, zh);
  expect(out[1]).toBe('◐ 1 running');
  expect(out[2]).toBe('● #16 running title 16 · fix/16-save-settings · 还差 3 个提交');
  expect(out[3]).toBe('● #9 not started title 9');
  expect(cardLines(base, NOW, 90, zh).footer).toBe(' · 拉取于 刚刚');
});

test('ticket status words are English in both languages, colours unchanged', () => {
  const tickets = [t(1, 'todo'), t(2, 'doing'), t(3, 'merged'), t(4, 'done')];
  for (const s of [en, zh]) {
    const rows = cardLines({ ...base, tickets }, NOW, 90, s).lines.filter(l => l.text.startsWith('●'));
    const words = rows.map(l => [l.parts[2]?.text, l.parts[2]?.color, l.parts[0]?.color]);
    expect(words).toEqual([
      ['running', 'yellow', 'yellow'],
      ['not started', 'gray', 'gray'],
      ['Merged', 'blueBright', 'blueBright'],
      ['accepted', 'green', 'green'],
    ]);
  }
});

test('ticket order: in progress, not started, merged, done', () => {
  const tickets = [t(1, 'done'), t(2, 'merged'), t(3, 'todo'), t(4, 'doing')];
  const nums = texts({ ...base, tickets }).filter(l => l.startsWith('●')).map(l => l.match(/#(\d+)/)?.[1]);
  expect(nums).toEqual(['4', '3', '2', '1']);
});

test('footer reads only the fetch time', () => {
  expect(cardLines(base, NOW, 90, en).footer).toBe(' · fetched just now');
  expect(cardLines({ ...base, fetchedAt: NOW - 5 * 60_000 }, NOW, 90, en).footer).toBe(' · fetched 5 min ago');
  expect(cardLines({ ...base, fetchedAt: NOW - 5 * 60_000 }, NOW, 90, zh).footer).toBe(' · 拉取于 5 分钟前');
});

test('refreshText: lists only what changed, in both languages', () => {
  const before = { ...base, isDraft: true, tickets: [t(7, 'doing')] };
  const after = { ...before, isDraft: false };
  expect(refreshText(before, after, en)).toBe('PR #15 updated: Draft → Ready');
  expect(refreshText(after, { ...after, state: 'MERGED' }, zh)).toBe('PR #15 已更新：Ready → Merged');
  expect(refreshText(before, { ...before, ci: { ok: 0, fail: 1, pending: 0, total: 1 }, title: 'new' }, en))
    .toBe('PR #15 updated: “new” · CI ✓0/1 ✗1');
  // A ticket's own status moving is not a PR change; only the ticket count is.
  expect(refreshText(before, { ...before, tickets: [t(7, 'done'), t(8, 'todo')] }, zh)).toBe('PR #15 已更新：Tickets 1 → 2');
  expect(refreshText(before, { ...before, tickets: [t(7, 'merged')] }, en)).toBe('PR #15 is up to date');
});

test('refreshText: unchanged (fetchedAt alone does not count) and gone', () => {
  expect(refreshText(base, { ...base, fetchedAt: NOW }, en)).toBe('PR #15 is up to date');
  expect(refreshText(base, { ...base, fetchedAt: NOW }, zh)).toBe('PR #15 已是最新');
  expect(refreshText(base, null, en)).toBe('No PR on this branch');
  expect(refreshText(base, null, zh)).toBe('当前分支已没有 PR');
});

const LONG = '主题 Dark深色模式贯穿设置页与编辑器，系统主题自动跟随与手动切换，添加深色模式——设置页 / 主题（吸收 #3）';

test('hint row: a wide row shows the full title and the state chip', () => {
  const title = '添加深色模式——设置页 / 主题（吸收 #3）';
  const pr = { ...base, title, tickets: many(10) };
  expect(hintLayout(pr, 200, en)).toEqual({ title, hasSummary: true });
});

test('hint row: the title takes exactly the width left, cut with …', () => {
  const pr = { ...base, title: LONG, tickets: many(10) };
  const head = width('PR #15 ');
  const summary = width(' · Ready');
  const out = hintLayout(pr, head + summary + 20, en);
  expect(out.hasSummary).toBe(true);
  expect(width(out.title)).toBe(20);
  expect(out.title.endsWith('…')).toBe(true);
});

test('hint row: under 8 cells for the title drops the chip first, then the title shrinks', () => {
  const pr = { ...base, title: LONG, tickets: many(10) };
  const head = width('PR #15 ');
  const summary = width(' · Ready');
  // 6 cells left: the chip goes and the title takes its room (6 + 8 = 14 cells ends on a whole CJK glyph).
  const tight = hintLayout(pr, head + summary + 6, en);
  expect(tight.hasSummary).toBe(false);
  expect(width(tight.title)).toBe(6 + summary);
  const narrow = hintLayout(pr, 20, en);
  expect(narrow.hasSummary).toBe(false);
  expect(width(narrow.title)).toBeGreaterThanOrEqual(7);
  // The chip is the PR's own state: a PR without tickets still shows it.
  expect(hintLayout({ ...base, tickets: [] }, 200, en).hasSummary).toBe(true);
});

test('ticketSubjects drops the lead every ticket shares, keeping the ordinal and the subject', () => {
  const mk = (number: number, title: string) => ({ number, title }) as never;
  const shared = ticketSubjects([
    mk(1, '深色模式 ① · 骨架——设置页开关'),
    mk(2, '深色模式 ② · 编辑器配色（吸收 #3）'),
  ]);
  expect(shared.get(1)).toBe('① 骨架——设置页开关');
  expect(shared.get(2)).toBe('② 编辑器配色（吸收 #3）');
  // Different leads, or a single ticket: titles stay as they are.
  const mixed = ticketSubjects([mk(1, '深色模式 ① · 骨架'), mk(2, '导出 ① · 格式')]);
  expect(mixed.get(1)).toBe('深色模式 ① · 骨架');
  expect(ticketSubjects([mk(1, '深色模式 ① · 骨架')]).get(1)).toBe('深色模式 ① · 骨架');
});

test('ticketSubjects drops a leading [mod] tag, before the shared lead is looked for', () => {
  const mk = (number: number, title: string) => ({ number, title }) as never;
  expect(ticketSubjects([mk(1, '[pr-hint] 提示行')]).get(1)).toBe('提示行');
  const shared = ticketSubjects([mk(1, '[pr-hint] 深色模式 ① · 骨架'), mk(2, '[pr-hint] 深色模式 ② · 配色')]);
  expect(shared.get(1)).toBe('① 骨架');
  expect(shared.get(2)).toBe('② 配色');
});

// agent-monitor's published totals for this PR (docs/adr/0001-cross-mod-state.md): 86.2k tokens, $1.25, 12 min 34 s, 2 refusals.
const STATS = { tokens: 86_200, cost: 1.25, ms: 754_000, refusals: 2 };
const line2 = (s = en, stats?: typeof STATS | Omit<typeof STATS, 'cost'>) =>
  cardLines({ ...base, tickets: [t(1, 'doing')] }, NOW, 90, s, 90, { stats }).lines[1]!;

test('line 2 carries the subagents\' cost, tokens and time, marked subagents only, then the refusals', () => {
  expect(line2(zh, STATS).text).toBe('◐ 1 running · ≈$1.25 · 86.2k tokens · 12m34s (仅子代理) · 拦截 ×2');
  expect(line2(en, STATS).text).toBe('◐ 1 running · ≈$1.25 · 86.2k tokens · 12m34s (subagents only) · blocked ×2');
  const parts = line2(en, STATS).parts;
  expect(parts.find(p => p.text.includes('subagents only'))?.dim).toBe(true);
  expect(parts.find(p => p.text.includes('blocked'))?.color).toBe('red');
});

test('line 2 without agent-monitor\'s value is only ◐ N running; no refusals or no price drops that segment alone', () => {
  expect(line2(en).text).toBe('◐ 1 running');
  expect(line2(en, { ...STATS, refusals: 0 }).text).toBe('◐ 1 running · ≈$1.25 · 86.2k tokens · 12m34s (subagents only)');
  expect(line2(en, { tokens: 900, ms: 5_000, refusals: 0 }).text).toBe('◐ 1 running · 900 tokens · 5s (subagents only)');
});

test('withoutAgents drops the agents pill so the row keeps one length while typing', () => {
  expect(withoutAgents('▸▸ bypass permissions on · (shift+tab to cycle) · ← 3 agents')).toBe('▸▸ bypass permissions on · (shift+tab to cycle)');
  expect(withoutAgents('▸▸ bypass permissions on (shift+tab to cycle) · ← 1 agent')).toBe('▸▸ bypass permissions on (shift+tab to cycle)');
  expect(withoutAgents('▸▸ bypass permissions on · (shift+tab to cycle)')).toBe('▸▸ bypass permissions on · (shift+tab to cycle)');
});

test('hintSpans colours the mode phrase and dims the rest', () => {
  expect(hintSpans('▸▸ bypass permissions on (shift+tab to cycle) · ← 1 agent')).toEqual([
    { text: '▸▸ bypass permissions on', color: 'red' },
    { text: ' (shift+tab to cycle) · ← 1 agent', dim: true },
  ]);
  expect(hintSpans('⏵⏵ accept edits on')[0]).toEqual({ text: '⏵⏵ accept edits on', color: 'magenta' });
  expect(hintSpans('plan mode on (x)')[0]?.color).toBe('cyan');
  expect(hintSpans('auto mode on')).toEqual([{ text: 'auto mode on', color: 'yellow' }]);
  expect(hintSpans('? for shortcuts')).toEqual([{ text: '? for shortcuts', dim: true }]);
});

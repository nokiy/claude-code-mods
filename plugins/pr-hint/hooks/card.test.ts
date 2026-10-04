// Tests the AbovePrompt card text (hierarchy, ordered full ticket lines), the hint layout and the hint spans, on synthetic data.
import { expect, test } from 'claude-code/testing';
import type { PrData, PrTicket } from '../types';
import { cardLines, hintLayout, hintSpans, ticketSubjects, withoutAgents } from './card';
import { width } from './parse';
import { strings } from './strings';

const en = strings('en');
const zh = strings('zh');
const NOW = Date.parse('2026-01-10T11:00:00Z');
const SPEC = { number: 12, title: 'Dark mode · 深色模式贯穿设置页与编辑器，系统主题自动跟随与手动切换 — Feature Spec' };
const base: PrData = {
  cwd: '/tmp/x',
  number: 15, title: 'short title', state: 'OPEN', isDraft: false, base: 'main', head: 'spec/12-dark-mode',
  url: 'u', updatedAt: '2026-01-10T10:00:00Z', ci: { ok: 1, fail: 0, pending: 0, total: 1 }, tickets: [], spec: SPEC,
};
const t = (number: number, status: PrTicket['status'], over: Partial<PrTicket> = {}): PrTicket => ({
  number, title: `title ${number}`, state: 'OPEN', progress: null, status, branch: null, ahead: 0, ...over,
});
const many = (n: number, status: PrTicket['status'] = 'merged') => Array.from({ length: n }, (_, i) => t(i + 1, status));
const texts = (pr: PrData, inner = 90, s = en) => cardLines(pr, NOW, inner, s).lines.map(l => l.text);

test('hierarchy: title, Spec with base ← head, CI + summary, then tickets', () => {
  const out = texts({ ...base, tickets: many(10) });
  expect(out[0]).toBe('PR #15 short title');
  expect(out[1]).toMatch(/^Spec #12 Dark mode .* · integration branch main ← spec\/12-dark-mode$/);
  expect(out[2]).toBe('CI ✓1/1 · merged 10/10 · accepted 0/10');
  expect(out.slice(3)).toHaveLength(10);
});

test('colours: PR number cyan bold, Spec magenta, summary counts blue and green', () => {
  const { lines } = cardLines({ ...base, tickets: many(2) }, NOW, 90, en);
  expect(lines[0]?.parts[0]).toEqual({ text: 'PR #15', color: 'cyan', bold: true });
  expect(lines[1]?.parts[0]?.color).toBe('magenta');
  const counts = lines[2]?.parts.filter(p => p.bold).map(p => [p.text, p.color]);
  expect(counts).toEqual([['2/2', 'blueBright'], ['0/2', 'green']]);
});

test('without a Spec the second row is state and base ← head; no tickets reads as unlinked', () => {
  const out = texts({ ...base, spec: null });
  expect(out[1]).toBe('integration branch main ← spec/12-dark-mode · OPEN');
  expect(out[2]).toBe('CI ✓1/1 · no linked tickets');
});

test('without a Spec and without tickets a draft shows (draft) after the branches', () => {
  expect(texts({ ...base, spec: null, isDraft: true })[1]).toBe('integration branch main ← spec/12-dark-mode · OPEN (draft)');
});

test('without a Spec, one ticket takes the Spec row: magenta Ticket #N · title · base ← head, no state', () => {
  const title = '[pr-hint] 提示行只显示当前目录的 PR；「← N agents」始终隐藏';
  const pr = { ...base, spec: null, isDraft: true, tickets: [t(22, 'doing', { title })] };
  const { lines } = cardLines(pr, NOW, 120, zh);
  expect(lines[1]?.text).toBe('Ticket #22 · 提示行只显示当前目录的 PR；「← N agents」始终隐藏 · 集成分支 main ← spec/12-dark-mode');
  expect(lines[1]?.parts[0]?.color).toBe('magenta');
  expect(lines[3]?.text).toBe('● #22 进行中 提示行只显示当前目录的 PR；「← N agents」始终隐藏');
  expect(texts(pr, 60)[1]).toMatch(/^Ticket #22 · .+… · integration branch main ← spec\/12-dark-mode$/);
});

test('without a Spec, two or more tickets show only the branches, magenta', () => {
  const { lines } = cardLines({ ...base, spec: null, tickets: many(2) }, NOW, 90, zh);
  expect(lines[1]?.parts).toEqual([{ text: '集成分支 main ← spec/12-dark-mode', color: 'magenta' }]);
});

test('the integration branch label follows the language', () => {
  expect(texts({ ...base, spec: null }, 90, zh)[1]).toBe('集成分支 main ← spec/12-dark-mode · OPEN');
});

test('every ticket gets a full line, none dropped: 30 tickets, 30 lines', () => {
  const out = texts({ ...base, tickets: many(30) }).filter(l => l.startsWith('●'));
  expect(out).toHaveLength(30);
  expect(out[0]).toBe('● #1 merged title 1');
});

test('ticket line: status, short title, dim branch, N commits behind (no per-row counts)', () => {
  const doing = t(16, 'doing', {
    title: '保存设置——细节', branch: 'fix/16-save-settings', ahead: 3, progress: { done: 1, total: 3, maxRounds: 2 },
  });
  const { lines } = cardLines({ ...base, tickets: [doing] }, NOW, 90, en);
  const l = lines.at(-1);
  expect(l?.text).toBe('● #16 in progress 保存设置 · fix/16-save-settings · 3 commits behind');
  expect(l?.parts.find(p => p.text.includes('fix/16'))?.dim).toBe(true);
  expect(l?.parts.filter(p => p.color).map(p => [p.text, p.color]).slice(0, 2)).toEqual([['●', 'yellow'], ['in progress', 'yellow']]);
  // Merged with a branch but nothing ahead: branch shown, no "behind".
  const merged = cardLines({ ...base, tickets: [t(9, 'merged', { branch: 'feat/9-x' })] }, NOW, 90, en).lines.at(-1);
  expect(merged?.text).toBe('● #9 merged title 9 · feat/9-x');
});

test('Chinese strings: the same card in Chinese', () => {
  const doing = t(16, 'doing', { branch: 'fix/16-save-settings', ahead: 3, progress: { done: 1, total: 3, maxRounds: 0 } });
  const out = texts({ ...base, tickets: [doing, t(9, 'todo')] }, 90, zh);
  expect(out[1]).toMatch(/· 集成分支 main ← spec\/12-dark-mode$/);
  expect(out[2]).toBe('CI ✓1/1 · 合入 0/2 · 验收 0/2');
  expect(out[3]).toBe('● #16 进行中 title 16 · fix/16-save-settings · 还差 3 个提交');
  expect(out[4]).toBe('● #9 未开始 title 9');
  expect(cardLines(base, NOW, 90, zh).footer).toBe(' · 更新于 1 小时前');
});

test('ticket order: in progress, not started, merged, done', () => {
  const tickets = [t(1, 'done'), t(2, 'merged'), t(3, 'todo'), t(4, 'doing')];
  const nums = texts({ ...base, tickets }).filter(l => l.startsWith('●')).map(l => l.match(/#(\d+)/)?.[1]);
  expect(nums).toEqual(['4', '3', '2', '1']);
});

test('a long title wraps to at most 3 rows', () => {
  const out = cardLines({ ...base, title: 'x'.repeat(300) }, NOW, 40, en).lines;
  expect(out.slice(0, 3).every(l => width(l.text) <= 40)).toBe(true);
  expect(out[2]?.text.endsWith('…')).toBe(true);
  expect(out[3]?.text).toMatch(/^Spec #12/);
});

test('footer reads updated', () => {
  expect(cardLines(base, NOW, 90, en).footer).toBe(' · updated 1 h ago');
});

const LONG = '主题 Dark深色模式贯穿设置页与编辑器，系统主题自动跟随与手动切换，添加深色模式——设置页 / 主题（吸收 #3）';

test('hint row: a wide row shows the full title and the summary', () => {
  const title = '添加深色模式——设置页 / 主题（吸收 #3）';
  const pr = { ...base, title, tickets: many(10) };
  expect(hintLayout(pr, 200, en)).toEqual({ title, hasSummary: true });
});

test('hint row: the title takes exactly the width left, cut with …', () => {
  const pr = { ...base, title: LONG, tickets: many(10) };
  const head = width('PR #15 ');
  const summary = width(' · merged 10/10 · accepted 0/10');
  const out = hintLayout(pr, head + summary + 20, en);
  expect(out.hasSummary).toBe(true);
  expect(width(out.title)).toBe(20);
  expect(out.title.endsWith('…')).toBe(true);
});

test('hint row: under 8 cells for the title drops the summary first, then the title shrinks', () => {
  const pr = { ...base, title: LONG, tickets: many(10) };
  const head = width('PR #15 ');
  const summary = width(' · merged 10/10 · accepted 0/10');
  const tight = hintLayout(pr, head + summary + 7, en);
  expect(tight.hasSummary).toBe(false);
  expect(width(tight.title)).toBe(7 + summary);
  const narrow = hintLayout(pr, 20, en);
  expect(narrow.hasSummary).toBe(false);
  expect(width(narrow.title)).toBeGreaterThanOrEqual(7);
  expect(hintLayout({ ...base, tickets: [] }, 200, en).hasSummary).toBe(false);
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

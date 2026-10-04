// Pure parsers and text helpers for gh JSON, acceptance tables, git ticket status and cell-width layout; no engine calls.
import type { PrCi, PrData, PrProgress, PrTicket, TicketStatus } from '../types';
import type { Strings } from './strings';

const DONE = /✓|✅|done/i;

const cells = (line: string): string[] =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());

const isRow = (line: string): boolean => line.trim().startsWith('|');

/**
 * Finds the first markdown table whose header has `State` and `Rounds`
 * columns (spec order: Item | Target/source | State | Rounds | Rewrites) and
 * counts its data rows: done = State cell has ✓, ✅ or "done". Null when
 * there is no such table.
 */
export function parseAcceptance(body: string): PrProgress | null {
  const lines = body.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!isRow(line)) continue;
    const head = cells(line).map(c => c.toLowerCase());
    const state = head.indexOf('state');
    const rounds = head.indexOf('rounds');
    if (state < 0 || rounds < 0) continue;

    let done = 0;
    let total = 0;
    let maxRounds = 0;
    let j = i + 1;
    // Skip the |---|---| separator.
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[j] ?? '') && (lines[j] ?? '').includes('-')) j++;
    for (; j < lines.length && isRow(lines[j] ?? ''); j++) {
      const row = cells(lines[j] ?? '');
      total++;
      if (DONE.test(row[state] ?? '')) done++;
      const n = parseInt(row[rounds] ?? '', 10);
      if (Number.isFinite(n) && n > maxRounds) maxRounds = n;
    }
    return { done, total, maxRounds };
  }
  return null;
}

type Check = { status?: string; conclusion?: string; state?: string };

const OK = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const FAIL = new Set(['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);

/** Folds statusCheckRollup (CheckRun and StatusContext entries) into counts. */
export function parseCi(rollup: unknown): PrCi {
  const ci: PrCi = { ok: 0, fail: 0, pending: 0, total: 0 };
  if (!Array.isArray(rollup)) return ci;
  for (const c of rollup as Check[]) {
    // A CheckRun is final only when COMPLETED; a StatusContext carries `state`.
    const verdict = (c.state ?? (c.status === 'COMPLETED' ? c.conclusion : '') ?? '').toUpperCase();
    ci.total++;
    if (OK.has(verdict)) ci.ok++;
    else if (FAIL.has(verdict)) ci.fail++;
    else ci.pending++;
  }
  return ci;
}

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : 0);

export function parseJson(text: string): Json | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

// GitHub closing keywords followed by a same-repo `#N` (`owner/repo#N` has no space before `#`, so it never matches).
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[ \t]+#(\d+)\b/gi;

/** Ticket numbers from `Closes #N` / `Fixes #N` / `Resolves #N` lines of a PR body: de-duplicated, in order. */
export function bodyClosingNumbers(body: string): number[] {
  const seen = new Set<number>();
  for (const m of body.matchAll(CLOSES)) seen.add(Number(m[1]));
  return [...seen].filter(n => n > 0);
}

/**
 * Issue numbers a PR closes: `closingIssuesReferences`, else the `Closes #N`
 * lines of its body (a PR into a non-default branch has no references).
 */
export function closingNumbers(pr: Json): number[] {
  const refs = Array.isArray(pr.closingIssuesReferences) ? (pr.closingIssuesReferences as Json[]) : [];
  const nums = refs.map(r => num(r.number)).filter(n => n > 0);
  return nums.length > 0 ? nums : bodyClosingNumbers(str(pr.body));
}

export function parseTicket(issue: Json): PrTicket {
  return {
    number: num(issue.number),
    title: str(issue.title),
    state: str(issue.state),
    progress: parseAcceptance(str(issue.body)),
    // Placeholder; the caller sets it from local git once branches are read.
    status: 'todo',
    branch: null,
    ahead: 0,
  };
}

export function parsePr(pr: Json, tickets: PrTicket[], spec: PrData['spec'] = null): PrData {
  return {
    number: num(pr.number),
    title: str(pr.title),
    state: str(pr.state),
    isDraft: pr.isDraft === true,
    base: str(pr.baseRefName),
    head: str(pr.headRefName),
    url: str(pr.url),
    updatedAt: str(pr.updatedAt),
    ci: parseCi(pr.statusCheckRollup),
    tickets,
    spec,
  };
}

/** Display width in terminal cells: wide (CJK, full-width) glyphs count 2. */
const cellWidth = (ch: string): number => {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff)
    ? 2
    : 1;
};

/** Display width of a string in terminal cells. */
export function width(s: string): number {
  let w = 0;
  for (const ch of s) w += cellWidth(ch);
  return w;
}

/** Cuts `s` to at most `max` cells, ending in `…` when cut. */
export function truncate(s: string, max: number): string {
  if (width(s) <= max) return s;
  let out = '';
  let w = 0;
  for (const ch of s) {
    const cw = cellWidth(ch);
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/**
 * Breaks `s` into at most `maxRows` rows of at most `max` cells each; what
 * does not fit in the last row is cut with `…`.
 */
export function wrapCells(s: string, max: number, maxRows: number): string[] {
  const rows: string[] = [];
  let rest = s;
  while (rest !== '' && rows.length < maxRows) {
    if (rows.length === maxRows - 1) {
      rows.push(truncate(rest, max));
      break;
    }
    let row = '';
    let w = 0;
    for (const ch of rest) {
      const cw = cellWidth(ch);
      if (w + cw > max) break;
      row += ch;
      w += cw;
    }
    rows.push(row);
    rest = rest.slice(row.length);
  }
  return rows;
}

/** `updatedAt` relative to `nowMs`, in the UI language. */
export function relTime(iso: string, nowMs: number, t: Strings): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return t.rel.unknown;
  const s = Math.max(0, Math.round((nowMs - at) / 1000));
  if (s < 60) return t.rel.now;
  if (s < 3600) return t.rel.min(Math.floor(s / 60));
  if (s < 86400) return t.rel.hour(Math.floor(s / 3600));
  return t.rel.day(Math.floor(s / 86400));
}

/** Branches that belong to ticket `n`: `(^|/)<n>-`, never `worktree-*`. */
export function ticketBranches(n: number, names: readonly string[]): string[] {
  const re = new RegExp(`(^|/)${n}-`);
  return names.filter(b => !b.startsWith('worktree-') && re.test(b));
}

/**
 * Ticket status from local facts. `counts` holds one
 * `rev-list --count <head>..<branch>` per branch of the ticket.
 * done = issue CLOSED, or an acceptance table that is all ✓ (n > 0);
 * it overrides the git-derived statuses.
 */
export function ticketStatus(state: string, progress: PrProgress | null, counts: readonly number[]): TicketStatus {
  if (state === 'CLOSED') return 'done';
  if (progress && progress.total > 0 && progress.done === progress.total) return 'done';
  if (counts.length === 0) return 'todo';
  return counts.some(c => c > 0) ? 'doing' : 'merged';
}

/** `merged` counts merged and done tickets; `done` counts done ones (the accepted number). */
export function summarize(tickets: readonly PrTicket[]): { merged: number; done: number; total: number } {
  const done = tickets.filter(t => t.status === 'done').length;
  const merged = tickets.filter(t => t.status === 'merged').length + done;
  return { merged, done, total: tickets.length };
}

const ORDER: Record<TicketStatus, number> = { doing: 0, todo: 1, merged: 2, done: 3 };

/** Attention first: in progress, not started, merged, done (stable within a status). */
export function sortTickets(tickets: readonly PrTicket[]): PrTicket[] {
  return tickets
    .map((t, i) => [t, i] as const)
    .sort((a, b) => ORDER[a[0].status] - ORDER[b[0].status] || a[1] - b[1])
    .map(([t]) => t);
}

/** First segment of a title (cut at `——`, ` — ` or `（`), at most `max` cells. */
export function shortTitle(title: string, max: number): string {
  const cut = title.split(/——| — |（/)[0] ?? title;
  return truncate(cut.trim(), max);
}

/** True when the issue JSON carries the label `spec`: that issue is the Spec, not a ticket. */
export function isSpecIssue(issue: Json): boolean {
  const labels = Array.isArray(issue.labels) ? (issue.labels as Json[]) : [];
  return labels.some(l => str(l.name) === 'spec');
}

// Hooks entry of pr-hint; refreshes PR data and draws the PromptHint line plus its hover-preview, click-to-pin card.
// The engine's `$` and the PR atom stay in this file (the validator follows them nowhere else); text and parsing live in card.ts, graphql.ts, parse.ts and strings.ts.
import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';
import { cardLines, hintLayout, hintSpans, refreshText, withoutAgents } from './card';
import { PR_ARGS, PR_QUERY, REPO_ARGS, issuesQuery, parseGraphql, parseIssues, splitIssues } from './graphql';
import { closingNumbers, mergedByCommits, parsePr, prHead, summarize, ticketBranches, ticketStatus, width } from './parse';
import { pickLang, strings } from './strings';
import type { Strings } from './strings';
import type { PrData, PrTicket } from '../types';

const pr = atom({ plugin: 'pr-hint', key: 'pr' } as const, null);
// Whether the card is pinned open (a press on the hint row's pin toggles it).
const pinned = atom({ plugin: 'pr-hint', key: 'pinned' } as const, false);
// Whether a manual ↻ refresh is running (the card's button shows it and ignores presses).
const refreshing = atom({ plugin: 'pr-hint', key: 'refreshing' } as const, false);

// Shared hover scope: the hint row lights it, the AbovePrompt card is revealed by it.
const SCOPE = 'pr-hint-card';

// Module-level on purpose: the validator wants `$` passed only to top-level
// functions of this file. A reload drops it with the rest of the environment.
let isBusy = false;
// A full refresh asked for while busy; it runs right after instead of being dropped.
let isFullPending = false;
// Callers of that queued full refresh (the manual ↻); released when it has run.
let fullWaiters: Array<() => void> = [];
// The two tier timers of this load; a repeated session.start cancels them before making new ones.
let timers: Array<{ cancel: () => void }> = [];
// `git for-each-ref` output at the last status computation; the git tier recomputes only when it differs.
let refSnap: string | null = null;
type Json = NonNullable<ReturnType<typeof parseGraphql>>;
// The open PR as last read: the directory it was read in, its JSON, the tickets as gh gave them (`raw`)
// and with their git status (`tickets`). The git tier recomputes from this without asking gh.
// `fetchedAt` is when gh last answered; the git recompute keeps it.
type Cache = { cwd: string; json: Json; raw: PrTicket[]; tickets: PrTicket[]; spec: PrData['spec']; fetchedAt: number };
let cache: Cache | null = null;
// full: PR, tickets and git, one gh request · git: local refs only.
type Mode = 'full' | 'git';

// The UI strings: the language option is read once per load (it needs the session's settings and LANG), English until then.
let langOption: unknown = 'auto';
let t: Strings = strings('en');
let langLoad: Promise<void> | undefined;
const ensureLang = ($: EngineInterface) => (langLoad ??= (async () => {
  t = strings(pickLang(langOption, (await $.settings.read()).language, await $.env.get('LANG')));
})());

// Local git only: which of the PR head's refs resolves, local first.
async function resolveHead($: EngineInterface, head: string): Promise<string | null> {
  for (const ref of [head, `origin/${head}`]) {
    const r = await $.process.run(['git', 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    if (r.exitCode === 0) return ref;
  }
  return null;
}

// Sets each ticket's status from the PR's commit headlines, branch names and `rev-list --count head..branch`.
async function applyStatuses($: EngineInterface, tickets: PrTicket[], headRef: string, headlines: string[]): Promise<PrTicket[]> {
  const head = await resolveHead($, headRef);
  const list = head === null ? null : await $.process.run(['git', 'branch', '-a', '--format=%(refname:short)']);
  const names = list && list.exitCode === 0 ? list.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const out: PrTicket[] = [];
  const merged = mergedByCommits(headlines, tickets.map(tk => tk.number));
  for (const tk of tickets) {
    const found: Array<{ b: string; n: number }> = [];
    for (const b of head === null ? [] : ticketBranches(tk.number, names)) {
      const c = await $.process.run(['git', 'rev-list', '--count', `${head}..${b}`]);
      const n = parseInt(c.stdout.trim(), 10);
      if (c.exitCode === 0 && Number.isFinite(n)) found.push({ b, n });
    }
    const ahead = Math.max(0, ...found.map(f => f.n));
    // Shown branch: the one furthest ahead; among equals a local one before its origin/ twin.
    const shown = [...found].sort((x, y) => y.n - x.n || Number(x.b.startsWith('origin/')) - Number(y.b.startsWith('origin/')))[0];
    out.push({
      ...tk,
      status: ticketStatus(tk.state, tk.progress, {
        isHead: ticketBranches(tk.number, [headRef]).length > 0,
        counts: found.map(f => f.n),
        isMerged: merged.has(tk.number),
      }),
      branch: shown?.b ?? null,
      ahead,
    });
  }
  return out;
}

// Local git only: the heads and remotes with their commits; null when git fails.
async function readRefs($: EngineInterface): Promise<string | null> {
  const r = await $.process.run(['git', 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes']);
  return r.exitCode === 0 ? r.stdout : null;
}

// Statuses from local git plus the PR's commits; remembers the ref snapshot they were computed at.
async function settle($: EngineInterface, raw: PrTicket[], json: Json, refs: string | null): Promise<PrTicket[]> {
  refSnap = refs ?? refSnap;
  const { headRef, headlines } = prHead(json);
  return applyStatuses($, raw, headRef, headlines);
}

// Never throws: any failure (no gh, no PR, bad JSON) reads as "no PR". One `gh api graphql` request brings the PR
// and its closing issues; only a PR into a non-default branch (GitHub links no issue) costs a second one for its `Closes #N` issues.
async function fetchPr($: EngineInterface): Promise<PrData | null> {
  try {
    // Runs in the session's working directory by default; the data is tagged with it, read before gh runs.
    const cwd = await $.session.cwd();
    const r = await $.process.run(['gh', ...PR_ARGS, '-f', `query=${PR_QUERY}`]);
    const json = r.exitCode === 0 ? parseGraphql(r.stdout) : null;
    // Only an OPEN PR is shown; merged or closed reads as no PR.
    if (!json) return (cache = null);

    let issues = json.closingIssuesReferences as Json[];
    const nums = closingNumbers(json);
    if (issues.length === 0 && nums.length > 0) {
      const more = await $.process.run(['gh', ...REPO_ARGS, '-f', `query=${issuesQuery(nums)}`]);
      issues = more.exitCode === 0 ? parseIssues(more.stdout) : [];
    }
    const refs = await readRefs($);
    const { raw, spec } = splitIssues(issues);
    cache = { cwd, json, raw, spec, tickets: await settle($, raw, json, refs), fetchedAt: await $.clock.now() };
    return parsePr(json, cwd, cache.tickets, spec, cache.fetchedAt);
  } catch {
    return (cache = null);
  }
}

// One tier's work. undefined = nothing changed, leave the atom alone.
async function step($: EngineInterface, mode: Mode): Promise<PrData | null | undefined> {
  if (mode === 'full') return fetchPr($);
  const c = cache;
  if (c === null) return undefined;
  try {
    // Another directory's cache is no use here: drop it and clear the atom.
    if (!await isHere($, c.cwd)) return (cache = null);
    const refs = await readRefs($);
    if (refs === null || refs === refSnap) return undefined;
    c.tickets = await settle($, c.raw, c.json, refs);
    return parsePr(c.json, c.cwd, c.tickets, c.spec, c.fetchedAt);
  } catch {
    return undefined;
  }
}

// Guarded so tiers never overlap: a tick that finds it busy is skipped, a full refresh is queued
// and its promise resolves once that queued run has finished.
async function refresh($: EngineInterface, mode: Mode): Promise<void> {
  if (isBusy) {
    if (mode !== 'full') return;
    isFullPending = true;
    return new Promise<void>(resolve => void fullWaiters.push(resolve));
  }
  isBusy = true;
  try {
    const next = await step($, mode);
    if (next === undefined) return;
    const prev = await read($, pr);
    if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, pr, () => next);
  } finally {
    isBusy = false;
    if (isFullPending) {
      isFullPending = false;
      const waiters = fullWaiters;
      fullWaiters = [];
      void refresh($, 'full').finally(() => waiters.forEach(release => release()));
    }
  }
}

// The ↻ press: one full refresh that really finishes, then a toast saying what changed.
// Further presses while it runs are ignored; the toast shows whether or not the card is still open.
async function manualRefresh($: EngineInterface): Promise<void> {
  if ((await read($, refreshing)) === true) return;
  await update($, refreshing, () => true);
  try {
    const before = await read($, pr);
    await refresh($, 'full');
    $.ui.toast(refreshText(before, await read($, pr), t), { timeoutMs: 5000 });
  } finally {
    await update($, refreshing, () => false);
  }
}

// Whether data read in `cwd` belongs to where the session is now; a failed read counts as "not here".
async function isHere($: EngineInterface, cwd: string): Promise<boolean> {
  try {
    return cwd === await $.session.cwd();
  } catch {
    return false;
  }
}

// The PR to draw: null when there is none or it was read in another directory (/clear, cd and repo
// switches all end up here), and then `isStale` says the atom is out of date. Never throws.
async function currentPr($: EngineInterface): Promise<{ data: PrData | null; isStale: boolean }> {
  const data = await read($, pr);
  if (data === null) return { data: null, isStale: false };
  return (await isHere($, data.cwd)) ? { data, isStale: false } : { data: null, isStale: true };
}

export const register: Register = (on, options) => {
  langOption = options.language;
  langLoad = undefined;
  t = strings('en');

  on('session.start', async ($, e, next) => {
    void refresh($, 'full');
    // One timer per tier: a second session.start replaces them instead of stacking.
    for (const tm of timers) tm.cancel();
    timers = [
      $.clock.every(20_000, () => void refresh($, 'git')),
      $.clock.every(300_000, () => void refresh($, 'full')),
    ];
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    void refresh($, 'full');
    return next(e);
  });

  // Hint row: the engine's hint, a pin Button (` ▸ ` / ` ▾ `, the click that pins the card),
  // then `PR #N` (cyan, bold), the title and counts in one Text. Only a Button takes a press
  // (Box and Text have no onPress) and a plain Button's hit area is its label cells, so the pin
  // is padded to three cells and `PR #N` keeps its colour. The Box is the hover handle: the card shares its `scope`.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const { data, isStale } = await currentPr($);
    // Only this row asks for the refresh of a stale PR; the card just hides, so a cd costs one full refresh.
    if (isStale) void refresh($, 'full');
    const hint = withoutAgents(e.props.hint);
    if (data === null) {
      // No PR: the engine's line stays live unless it carries the agents pill, which is always hidden.
      return hint === e.props.hint ? next(e) : next({ ...e, props: { ...e.props, hint } });
    }
    await ensureLang($);

    const { Box, Button, Text } = $.ui.resolve(e);
    const columns = e.viewport?.columns ?? 80;
    const isPinned = (await read($, pinned)) === true;
    // Room for the PR group: the row less the hint text, the " ·" separator (2), the padded pin (3) and a 2-cell margin.
    const layout = hintLayout(data, columns - width(hint) - 3 - 2 - 2, t);
    const sum = summarize(data.tickets);

    return (
      <Box key="pr-hint" flexDirection="row" hover={{ scope: SCOPE }}>
        <Box flexShrink={0}>
          <Text key="hint">
            {hintSpans(hint).map((p, i) => (
              <Text key={`h${i}`} color={p.color} dimColor={p.dim}>{p.text}</Text>
            ))}
            <Text dimColor>{' ·'}</Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Button
            key="pin"
            label={isPinned ? ' ▾ ' : ' ▸ '}
            plain
            hover={{ color: 'cyan', bold: true }}
            onPress={() => update($, pinned, p => !p)}
          />
        </Box>
        <Box flexShrink={0}>
          <Text key="pr-num" color="cyan" bold>{`PR #${data.number}`}</Text>
        </Box>
        {/* Only the title shrinks: the row's real width (the engine's own pills included) decides
            where it is cut, so the counts after it always stay whole. */}
        <Box flexShrink={1}>
          <Text key="pr-title" wrap="truncate-end">{` ${layout.hasSummary ? data.title : layout.title}`}</Text>
        </Box>
        {layout.hasSummary ? (
          <Box flexShrink={0}>
            <Text key="pr-sum">
              <Text dimColor>{' · '}</Text>
              <Text>{`${t.merged} `}</Text>
              <Text color="blueBright" bold>{`${sum.merged}/${sum.total}`}</Text>
              <Text dimColor>{' · '}</Text>
              <Text>{`${t.accepted} `}</Text>
              <Text color="green" bold>{`${sum.done}/${sum.total}`}</Text>
            </Text>
          </Box>
        ) : null}
      </Box>
    );
  });

  // The detail card lives in the AbovePrompt band: an absolute Box under PromptHint is
  // clipped by the bottom slot. It is hidden until the hint row's scope is hovered, and always
  // shown while pinned; the band scrolls by itself when taller than maxRows, so no ticket is dropped.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const { data } = await currentPr($);
    if (data === null || e.props.hasSurvey) return next(e);
    await ensureLang($);

    const { Box, Button, Text, Link } = $.ui.resolve(e);
    // Border (2) + paddingX (2) leave this many cells for text.
    const inner = Math.max(20, e.props.bodyColumns - 4);
    const isPinned = (await read($, pinned)) === true;
    const isRefreshing = (await read($, refreshing)) === true;
    const label = isRefreshing ? t.refreshing : t.refresh;
    // The title wraps in what the button (plus a 1-cell gap) leaves of the first row.
    const card = cardLines(data, await $.clock.now(), inner, t, Math.max(10, inner - width(label) - 1));
    const [head, ...rest] = card.lines;
    const row = (l: NonNullable<typeof head>, i: number) => (
      <Text key={String(i)} wrap="truncate-end">
        {l.parts.map((p, j) => (
          <Text key={String(j)} color={p.color} bold={p.bold} dimColor={p.dim}>{p.text}</Text>
        ))}
      </Text>
    );

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={1}
        {...(isPinned ? {} : { display: 'none' as const, hover: { scope: SCOPE, display: 'flex' as const } })}
      >
        {/* First row: the PR title shrinks and truncates, the ↻ refresh button keeps its full width at the right. */}
        <Box flexDirection="row">
          <Box flexShrink={1} flexGrow={1}>{row(head!, 0)}</Box>
          <Box key="refresh-box" flexShrink={0} marginLeft={1}>
            <Button
              key="refresh"
              label={label}
              plain
              hover={{ color: 'cyan', bold: true }}
              onPress={() => manualRefresh($)}
            />
          </Box>
        </Box>
        {rest.map((l, i) => row(l, i + 1))}
        <Text wrap="truncate-end">
          <Link href={data.url} label={t.openPr} />
          <Text>{card.footer}</Text>
        </Text>
      </Box>
    );
  });
}

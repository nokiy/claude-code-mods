// Hooks entry of pr-hint; refreshes PR data and draws the PromptHint line plus its hover-preview, click-to-pin card.
// The engine's `$` and the PR atom stay in this file (the validator follows them nowhere else); text and parsing live in card.ts, graphql.ts, parse.ts and strings.ts; tests are in ../tests.
import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';
import { cardLines, hintLayout, hintSpans, refreshText, withoutAgents } from './card';
import { PR_ARGS, PR_QUERY, REPO_ARGS, issuesQuery, parseGraphql, parseIssues, splitIssues } from './graphql';
import type { PrJson } from './graphql';
import { closingNumbers, isInside, mergedByCommits, parsePr, pickShown, prHead, sameWhere, summarize, ticketBranches, ticketStatus, width } from './parse';
import { pickLang, strings } from './strings';
import type { Strings } from './strings';
import type { PrData, PrTicket, Where } from '../types';

// The engine keeps what the old code stored across a reload or upgrade; the shape tag makes new code read an old-shaped PrData as absent.
// Bump the tag whenever PrData's shape changes.
const pr = atom({ plugin: 'pr-hint', key: 'pr' } as const, null, { shape: 'pr-v2' });
// Whether the card is pinned open (a press on the hint row's pin toggles it).
const pinned = atom({ plugin: 'pr-hint', key: 'pinned' } as const, false);
// Whether a manual ↻ refresh is running (the card's button shows it and ignores presses).
const refreshing = atom({ plugin: 'pr-hint', key: 'refreshing' } as const, false);

// Shared hover scope: the hint row lights it, the AbovePrompt card is revealed by it.
const SCOPE = 'pr-hint-card';

// Module-level on purpose: the validator wants `$` passed only to top-level
// functions of this file. A reload drops it with the rest of the environment.
// full: PR, tickets and git, one gh request · git: local refs only.
type Mode = 'full' | 'git';
// The refresh in flight, if any, and its mode: a tick that finds one is skipped, a full request joins a running full one
// (and waits for it) instead of queueing another.
let running: { mode: Mode; done: Promise<void> } | null = null;
// Set synchronously by the ↻ press, before any await, so two presses cannot both start.
let isManual = false;
// Whether the last full fetch got no usable answer from gh (then the data it left is the previous one).
let fetchFailed = false;
// The two tier timers of this load; a repeated session.start cancels them before making new ones.
let timers: Array<{ cancel: () => void }> = [];
// `git for-each-ref` output at the last status computation; the git tier recomputes only when it differs.
let refSnap: string | null = null;
// Where the session was last seen (render and 20s tier read it; the render compares PR data against it),
// and where the last full fetch ran, PR found or not: the 20s tier refetches when the two differ.
let curWhere: Where | null = null;
let fetchedWhere: Where | null = null;
// The open PR as last read: where, its JSON, the tickets as gh gave them (`raw`) and with their git status (`tickets`).
// The git tier recomputes from this without asking gh. `fetchedAt` is when gh last answered; the git recompute keeps it.
type Cache = { where: Where; json: PrJson; raw: PrTicket[]; tickets: PrTicket[]; spec: PrData['spec']; fetchedAt: number };
let cache: Cache | null = null;

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
    out.push({
      ...tk,
      status: ticketStatus(tk.state, tk.progress, {
        isHead: ticketBranches(tk.number, [headRef]).length > 0,
        counts: found.map(f => f.n),
        isMerged: merged.has(tk.number),
      }),
      branch: pickShown(found),
      ahead,
    });
  }
  return out;
}

// Local git only: where the session stands (directory, repository root, branch); null when any read fails.
async function readWhere($: EngineInterface): Promise<Where | null> {
  try {
    const cwd = await $.session.cwd();
    const top = await $.process.run(['git', 'rev-parse', '--show-toplevel']);
    const head = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD']);
    return top.exitCode === 0 && head.exitCode === 0 ? { cwd, root: top.stdout.trim(), branch: head.stdout.trim() } : null;
  } catch {
    return null;
  }
}

// Local git only: the heads and remotes with their commits; null when git fails.
async function readRefs($: EngineInterface): Promise<string | null> {
  const r = await $.process.run(['git', 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads', 'refs/remotes']);
  return r.exitCode === 0 ? r.stdout : null;
}

// Statuses from local git plus the PR's commits; remembers the ref snapshot they were computed at.
async function settle($: EngineInterface, raw: PrTicket[], json: PrJson, refs: string | null): Promise<PrTicket[]> {
  refSnap = refs ?? refSnap;
  const { headRef, headlines } = prHead(json);
  return applyStatuses($, raw, headRef, headlines);
}

// Never throws. One `gh api graphql` request brings the PR and its closing issues; only a PR into a non-default
// branch (GitHub links no issue) costs a second one for its `Closes #N` issues. Only a usable answer without an
// open PR of this repository clears the data. undefined = gh gave no usable answer (failed, timed out, bad JSON,
// GraphQL errors): the data read at this same place stays; data from another place is dropped, it is never drawn.
async function fetchPr($: EngineInterface): Promise<PrData | null | undefined> {
  // Runs in the session's working directory by default; the data is tagged with where it was read, before gh runs.
  const where = await readWhere($);
  if (where !== null) curWhere = fetchedWhere = where;
  const fail = () => {
    fetchFailed = true;
    if (cache !== null && sameWhere(cache.where, where)) return undefined;
    return (cache = null);
  };
  try {
    if (where === null) return fail();
    const r = await $.process.run(['gh', ...PR_ARGS, '-f', `query=${PR_QUERY}`]);
    const answer = r.exitCode === 0 ? parseGraphql(r.stdout) : null;
    if (answer === null || !answer.ok) return fail();
    // Only an OPEN PR is shown; merged or closed reads as no PR.
    const json = answer.pr;
    if (json === null) {
      fetchFailed = false;
      return (cache = null);
    }

    let issues = json.closingIssuesReferences;
    const nums = closingNumbers(json);
    if (issues.length === 0 && nums.length > 0) {
      const more = await $.process.run(['gh', ...REPO_ARGS, '-f', `query=${issuesQuery(nums)}`]);
      if (more.exitCode !== 0) return fail();
      issues = parseIssues(more.stdout);
    }
    const refs = await readRefs($);
    const { raw, spec } = splitIssues(issues);
    cache = { where, json, raw, spec, tickets: await settle($, raw, json, refs), fetchedAt: await $.clock.now() };
    fetchFailed = false;
    return parsePr(json, where, cache.tickets, spec, cache.fetchedAt);
  } catch {
    return fail();
  }
}

// One tier's work. undefined = nothing changed, leave the atom alone.
async function step($: EngineInterface, mode: Mode): Promise<PrData | null | undefined> {
  if (mode === 'full') return fetchPr($);
  try {
    // Local reads only; a failed read leaves everything as it was.
    const where = await readWhere($);
    if (where === null) return undefined;
    curWhere = where;
    // Another repository or branch than the last fetch's (PR found or not): read the PR anew; the render already hides the old one.
    if (!sameWhere(where, fetchedWhere)) {
      void refresh($, 'full');
      return undefined;
    }
    const c = cache;
    if (c === null) return undefined;
    const refs = await readRefs($);
    if (refs === null || refs === refSnap) return undefined;
    c.tickets = await settle($, c.raw, c.json, refs);
    return parsePr(c.json, c.where, c.tickets, c.spec, c.fetchedAt);
  } catch {
    return undefined;
  }
}

async function run($: EngineInterface, mode: Mode): Promise<void> {
  try {
    const next = await step($, mode);
    if (next === undefined) return;
    const prev = await read($, pr);
    if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, pr, () => next);
  } catch {
    fetchFailed = true;
  }
}

// One refresh at a time. A git tick that finds one running is skipped; a full request that finds a full one running
// waits for that one and shares its answer instead of queueing another (a git tick in flight is waited out, then it runs).
async function refresh($: EngineInterface, mode: Mode): Promise<void> {
  while (running !== null) {
    if (mode === 'git') return;
    const { mode: was, done } = running;
    await done;
    if (was === 'full') return;
  }
  // `running` is set before this function's first await, so two callers cannot both start.
  const done = run($, mode).finally(() => { running = null; });
  running = { mode, done };
  await done;
}

// The ↻ press: one full refresh that really finishes, then a toast saying what changed, or that the fetch failed.
// Further presses while it runs are ignored; the toast shows whether or not the card is still open.
async function manualRefresh($: EngineInterface): Promise<void> {
  if (isManual) return;
  isManual = true;
  try {
    await update($, refreshing, () => true);
    const before = await read($, pr);
    await refresh($, 'full');
    $.ui.toast(fetchFailed ? t.failed : refreshText(before, await read($, pr), t), { timeoutMs: 5000 });
  } catch {
    $.ui.toast(t.failed, { timeoutMs: 5000 });
  } finally {
    isManual = false;
    await update($, refreshing, () => false).catch(() => undefined);
  }
}

// The PR to draw: null when there is none or it was read elsewhere. Elsewhere = the session's directory is outside the
// repository root it was read in, or the root or branch last seen locally (fetch, 20s tier) differs (/clear, cd, repo and
// branch switches); then `isStale` says the atom is out of date. A subfolder of the same repo is still here.
// A failed cwd read only hides (no refresh asked). Never throws. The only cwd check at render: git runs in fetch and the 20s tier.
async function currentPr($: EngineInterface): Promise<{ data: PrData | null; isStale: boolean }> {
  const data = await read($, pr);
  if (data === null) return { data: null, isStale: false };
  try {
    const cwd = await $.session.cwd();
    const { where } = data;
    // Also inside the directory it was read from: git's root may be a symlink-resolved path the session's cwd is not spelled in.
    const isHere = (isInside(cwd, where.root) || isInside(cwd, where.cwd)) && sameWhere(where, curWhere);
    return isHere ? { data, isStale: false } : { data: null, isStale: true };
  } catch {
    return { data: null, isStale: false };
  }
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
    // Padded by a cell each side, like the pin: a plain Button's hit area is its label cells.
    const label = ` ${isRefreshing ? t.refreshing : t.refresh} `;
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

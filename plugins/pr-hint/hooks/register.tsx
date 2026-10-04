// Hooks entry of pr-hint; refreshes PR data and draws the PromptHint line plus its hover-preview, click-to-pin card.
// The engine's `$` and the PR atom stay in this file (the validator follows them nowhere else); text and parsing live in card.ts, parse.ts and strings.ts.
import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';
import { cardLines, hintLayout, hintSpans, withoutAgents } from './card';
import { closingNumbers, isSpecIssue, mergedByCommits, parseJson, parsePr, parseTicket, prHead, summarize, ticketBranches, ticketStatus, width } from './parse';
import { pickLang, strings } from './strings';
import type { Strings } from './strings';
import type { PrData, PrTicket } from '../types';

const pr = atom({ plugin: 'pr-hint', key: 'pr' } as const, null);
// Whether the card is pinned open (a press on the hint row's pin toggles it).
const pinned = atom({ plugin: 'pr-hint', key: 'pinned' } as const, false);

// Shared hover scope: the hint row lights it, the AbovePrompt card is revealed by it.
const SCOPE = 'pr-hint-card';

const PR_FIELDS =
  'number,title,state,isDraft,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,closingIssuesReferences,mergeable,baseRefName,headRefName,headRefOid,commits,url,updatedAt,body';

// Module-level on purpose: the validator wants `$` passed only to top-level
// functions of this file. A reload drops it with the rest of the environment.
let isBusy = false;
// A full refresh asked for while busy; it runs right after instead of being dropped.
let isFullPending = false;
// The three tier timers of this load; a repeated session.start cancels them before making new ones.
let timers: Array<{ cancel: () => void }> = [];
// `git for-each-ref` output at the last status computation; tier 1 recomputes only when it differs.
let refSnap: string | null = null;
type Json = NonNullable<ReturnType<typeof parseJson>>;
// The open PR as last read: the directory it was read in, its JSON, the closing-issue numbers, the tickets as gh gave them (`raw`)
// and with their git status (`tickets`). Tiers 1 and 3 recompute from this without asking gh for the PR.
type Cache = { cwd: string; key: string; json: Json; nums: number[]; raw: PrTicket[]; tickets: PrTicket[]; spec: PrData['spec'] };
let cache: Cache | null = null;
// full: PR, tickets and git · pr: the PR (tickets reused) · git: local refs only · issues: the closing issues.
type Mode = 'full' | 'pr' | 'git' | 'issues';

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

// Reads the closing issues; the one labelled `spec` is the Spec, not a ticket. `failed` counts issues gh did not answer.
async function loadIssues($: EngineInterface, nums: number[]): Promise<{ raw: PrTicket[]; spec: PrData['spec']; failed: number }> {
  const raw: PrTicket[] = [];
  let spec: PrData['spec'] = null;
  let failed = 0;
  for (const n of nums) {
    const res = await $.process.run(['gh', 'issue', 'view', String(n), '--json', 'number,title,state,body,labels']);
    const issue = res.exitCode === 0 ? parseJson(res.stdout) : null;
    if (issue && isSpecIssue(issue)) spec = { number: Number(issue.number), title: String(issue.title ?? '') };
    else if (issue) raw.push(parseTicket(issue));
    else failed++;
  }
  return { raw, spec, failed };
}

// Statuses from local git plus the PR's commits; remembers the ref snapshot they were computed at.
async function settle($: EngineInterface, raw: PrTicket[], json: Json, refs: string | null): Promise<PrTicket[]> {
  refSnap = refs ?? refSnap;
  const { headRef, headlines } = prHead(json);
  return applyStatuses($, raw, headRef, headlines);
}

// Never throws: any failure (no gh, no PR, bad JSON) reads as "no PR".
// `full` also re-reads the tickets and their git status; otherwise cached
// ones are reused while the closing-issue numbers and the head commit are unchanged.
async function fetchPr($: EngineInterface, mode: 'full' | 'pr'): Promise<PrData | null> {
  try {
    // Runs in the session's working directory by default; the data is tagged with it, read before gh runs.
    const cwd = await $.session.cwd();
    const r = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS]);
    const json = r.exitCode === 0 ? parseJson(r.stdout) : null;
    // Only an OPEN PR is shown; merged or closed reads as no PR.
    if (!json || json.state !== 'OPEN') return (cache = null);

    const nums = closingNumbers(json);
    // The head commit is part of the key: when the head moves, statuses are recomputed.
    const key = `${nums.join(',')}@${(typeof json.headRefOid === 'string' ? json.headRefOid : '')}`;
    if (mode === 'full' || cache === null || cache.key !== key || cache.cwd !== cwd) {
      const refs = await readRefs($);
      const { raw, spec } = await loadIssues($, nums);
      cache = { cwd, key, json, nums, raw, spec, tickets: await settle($, raw, json, refs) };
    } else {
      cache.json = json;
    }
    return { ...parsePr(cache.json, cache.tickets, cache.spec), cwd };
  } catch {
    return (cache = null);
  }
}

// One tier's work. undefined = nothing changed, leave the atom alone.
async function step($: EngineInterface, mode: Mode): Promise<PrData | null | undefined> {
  if (mode === 'full' || mode === 'pr') return fetchPr($, mode);
  const c = cache;
  if (c === null) return undefined;
  try {
    // Another directory's cache is no use here: drop it and clear the atom.
    if (c.cwd !== await $.session.cwd()) return (cache = null);
    const refs = await readRefs($);
    if (mode === 'git') {
      if (refs === null || refs === refSnap) return undefined;
    } else {
      // A failed answer keeps what we have rather than dropping a ticket.
      const { raw, spec, failed } = await loadIssues($, c.nums);
      if (failed > 0 || JSON.stringify([raw, spec]) === JSON.stringify([c.raw, c.spec])) return undefined;
      c.raw = raw;
      c.spec = spec;
    }
    c.tickets = await settle($, c.raw, c.json, refs);
    return { ...parsePr(c.json, c.tickets, c.spec), cwd: c.cwd };
  } catch {
    return undefined;
  }
}

// Guarded so tiers never overlap: a tick that finds it busy is skipped, a full refresh is queued.
async function refresh($: EngineInterface, mode: Mode): Promise<void> {
  if (isBusy) {
    if (mode === 'full') isFullPending = true;
    return;
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
      void refresh($, 'full');
    }
  }
}

// The PR to draw, or null when there is none or it was read in another directory (/clear, cd and
// repo switches all end up here); a stale one asks for a full refresh at once.
async function currentPr($: EngineInterface): Promise<PrData | null> {
  const data = await read($, pr);
  if (data === null) return null;
  if (data.cwd === await $.session.cwd()) return data;
  void refresh($, 'full');
  return null;
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
      $.clock.every(60_000, () => void refresh($, 'pr')),
      $.clock.every(300_000, () => void refresh($, 'issues')),
    ];
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    void refresh($, 'full');
    return next(e);
  });

  // Hint row: the engine's hint, a one-glyph pin Button (▸ / ▾, the click that pins the card),
  // then `PR #N` (cyan, bold), the title and counts in one Text. Only a Button takes a press
  // (Box and Text have no onPress) and a Button has no colour at rest, so the press lives on
  // the small glyph and `PR #N` keeps its colour. The Box is the hover handle: the card shares its `scope`.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const data = await currentPr($);
    if (data === null) {
      // No PR: the engine's line stays live unless it carries the agents pill, which is always hidden.
      const bare = withoutAgents(e.props.hint);
      return bare === e.props.hint ? next(e) : next({ ...e, props: { ...e.props, hint: bare } });
    }
    await ensureLang($);

    const { Box, Button, Text } = $.ui.resolve(e);
    const columns = e.viewport?.columns ?? 80;
    const isPinned = (await read($, pinned)) === true;
    // Room for the PR group: the row less the hint text, the " · " separator, the glyph + space and a 2-cell margin.
    const hint = withoutAgents(e.props.hint);
    const layout = hintLayout(data, columns - width(hint) - 3 - 2 - 2, t);
    const sum = summarize(data.tickets);

    return (
      <Box key="pr-hint" flexDirection="row" hover={{ scope: SCOPE }}>
        <Box flexShrink={0}>
          <Text key="hint">
            {hintSpans(hint).map((p, i) => (
              <Text key={`h${i}`} color={p.color} dimColor={p.dim}>{p.text}</Text>
            ))}
            <Text dimColor>{' · '}</Text>
          </Text>
        </Box>
        <Box flexShrink={0}>
          <Button
            key="pin"
            label={isPinned ? '▾' : '▸'}
            plain
            hover={{ color: 'cyan', bold: true }}
            onPress={() => update($, pinned, p => !p)}
          />
        </Box>
        <Box flexShrink={0}>
          <Text key="pr-num">
            <Text>{' '}</Text>
            <Text color="cyan" bold>{`PR #${data.number}`}</Text>
          </Text>
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
    const data = await currentPr($);
    if (data === null || e.props.hasSurvey) return next(e);
    await ensureLang($);

    const { Box, Text, Link } = $.ui.resolve(e);
    // Border (2) + paddingX (2) leave this many cells for text.
    const inner = Math.max(20, e.props.bodyColumns - 4);
    const isPinned = (await read($, pinned)) === true;
    const card = cardLines(data, await $.clock.now(), inner, t);

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        paddingX={1}
        {...(isPinned ? {} : { display: 'none' as const, hover: { scope: SCOPE, display: 'flex' as const } })}
      >
        {card.lines.map((l, i) => (
          <Text key={String(i)} wrap="truncate-end">
            {l.parts.map((p, j) => (
              <Text key={String(j)} color={p.color} bold={p.bold} dimColor={p.dim}>{p.text}</Text>
            ))}
          </Text>
        ))}
        <Text wrap="truncate-end">
          <Link href={data.url} label={t.openPr} />
          <Text>{card.footer}</Text>
        </Text>
      </Box>
    );
  });
}

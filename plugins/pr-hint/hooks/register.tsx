// Hooks entry of pr-hint; refreshes PR data and draws the PromptHint line plus its hover-preview, click-to-pin card.
// The engine's `$` and the PR atom stay in this file (the validator follows them nowhere else); text and parsing live in card.ts, parse.ts and strings.ts.
import { atom, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';
import { cardLines, hintLayout, hintSpans } from './card';
import { closingNumbers, isSpecIssue, parseJson, parsePr, parseTicket, summarize, ticketBranches, ticketStatus, width } from './parse';
import { pickLang, strings } from './strings';
import type { Strings } from './strings';
import type { PrData, PrTicket } from '../types';

const pr = atom({ plugin: 'pr-hint', key: 'pr' } as const, null);
// Whether the card is pinned open (a press on the hint row's pin toggles it).
const pinned = atom({ plugin: 'pr-hint', key: 'pinned' } as const, false);

// Shared hover scope: the hint row lights it, the AbovePrompt card is revealed by it.
const SCOPE = 'pr-hint-card';

const PR_FIELDS =
  'number,title,state,isDraft,reviewDecision,statusCheckRollup,additions,deletions,changedFiles,closingIssuesReferences,mergeable,baseRefName,headRefName,url,updatedAt,body';

// Module-level on purpose: the validator wants `$` passed only to top-level
// functions of this file. A reload drops it with the rest of the environment.
let isBusy = false;
// Tickets (with their git status) cached by the closing-issue numbers.
let cache: { key: string; tickets: PrTicket[]; spec: PrData['spec'] } | null = null;

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

// Sets each ticket's status from branch names and `rev-list --count head..branch`.
async function applyStatuses($: EngineInterface, tickets: PrTicket[], headRef: string): Promise<PrTicket[]> {
  const head = await resolveHead($, headRef);
  const list = head === null ? null : await $.process.run(['git', 'branch', '-a', '--format=%(refname:short)']);
  const names = list && list.exitCode === 0 ? list.stdout.split('\n').map(s => s.trim()).filter(Boolean) : [];
  const out: PrTicket[] = [];
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
      status: ticketStatus(tk.state, tk.progress, found.map(f => f.n)),
      branch: shown?.b ?? null,
      ahead,
    });
  }
  return out;
}

// Never throws: any failure (no gh, no PR, bad JSON) reads as "no PR".
// `isFull` also re-reads the tickets and their git status; otherwise cached
// ones are reused while the closing-issue numbers are unchanged.
async function fetchPr($: EngineInterface, isFull: boolean): Promise<PrData | null> {
  try {
    // Runs in the session's working directory by default.
    const r = await $.process.run(['gh', 'pr', 'view', '--json', PR_FIELDS]);
    if (r.exitCode !== 0) return null;
    const json = parseJson(r.stdout);
    if (!json) return null;
    // Only an OPEN PR is shown; merged or closed reads as no PR.
    if (json.state !== 'OPEN') return null;

    const nums = closingNumbers(json);
    const key = nums.join(',');
    if (isFull || cache === null || cache.key !== key) {
      const tickets: PrTicket[] = [];
      let spec: PrData['spec'] = null;
      for (const n of nums) {
        const res = await $.process.run(['gh', 'issue', 'view', String(n), '--json', 'number,title,state,body,labels']);
        const issue = res.exitCode === 0 ? parseJson(res.stdout) : null;
        // The issue labelled `spec` is the Spec, not a ticket.
        if (issue && isSpecIssue(issue)) spec = { number: Number(issue.number), title: String(issue.title ?? '') };
        else if (issue) tickets.push(parseTicket(issue));
      }
      const headRef = typeof json.headRefName === 'string' ? json.headRefName : '';
      cache = { key, tickets: await applyStatuses($, tickets, headRef), spec };
    }
    return parsePr(json, cache.tickets, cache.spec);
  } catch {
    return null;
  }
}

// Guarded so overlapping triggers (timer + turn end) never stack gh calls.
async function refresh($: EngineInterface, isFull: boolean): Promise<void> {
  if (isBusy) return;
  isBusy = true;
  try {
    const next = await fetchPr($, isFull);
    const prev = await read($, pr);
    if (JSON.stringify(prev) !== JSON.stringify(next)) await update($, pr, () => next);
  } finally {
    isBusy = false;
  }
}

export const register: Register = (on, options) => {
  langOption = options.language;
  langLoad = undefined;
  t = strings('en');

  on('session.start', async ($, e, next) => {
    void refresh($, true);
    // The timer refreshes the PR view only; tickets wait for session/turn events.
    $.clock.every(60_000, () => void refresh($, false));
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    void refresh($, true);
    return next(e);
  });

  // Hint row: the engine's hint, a one-glyph pin Button (▸ / ▾, the click that pins the card),
  // then `PR #N` (cyan, bold), the title and counts in one Text. Only a Button takes a press
  // (Box and Text have no onPress) and a Button has no colour at rest, so the press lives on
  // the small glyph and `PR #N` keeps its colour. The Box is the hover handle: the card shares its `scope`.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const data = await read($, pr);
    if (data === null) return next(e);
    await ensureLang($);

    const { Box, Button, Text } = $.ui.resolve(e);
    const columns = e.viewport?.columns ?? 80;
    const isPinned = (await read($, pinned)) === true;
    // Room for the PR group: the row less the hint text, the " · " separator, the glyph + space and a 2-cell margin.
    const layout = hintLayout(data, columns - width(e.props.hint) - 3 - 2 - 2, t);
    const sum = summarize(data.tickets);

    return (
      <Box key="pr-hint" flexDirection="row" hover={{ scope: SCOPE }}>
        <Box flexShrink={0}>
          <Text key="hint">
            {hintSpans(e.props.hint).map((p, i) => (
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
    const data = await read($, pr);
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

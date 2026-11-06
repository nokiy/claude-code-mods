// Hooks entry of ref-peek: annotates the numbers a reply mentions, draws the bubble over the reply, and keeps the cache behind them.
// The engine's `$` and the atoms stay in this file (the validator follows them nowhere else); recognition lives in refs.ts,
// repositories in repo.ts, cache decisions in cache.ts, the model's text in summary.ts, bubble text and placement in card.ts; tests are in ../tests.
import { atom, memberOf, read, update } from 'claude-code';
import type { EngineInterface, Register, RenderInput } from 'claude-code';
import { applyFetch, cacheKey, isDue, issueCommand, needsCheck, needsSummary, parseIssue, withSummary } from './cache';
import type { Entry, Facts, FetchAnswer } from './cache';
import { bareView, cardView, fit, glossOf, placeBubble } from './card';
import type { CardView, Placement } from './card';
import { anchorOf, annotate, findRefs } from './refs';
import type { Annotated, RefToken } from './refs';
import { commandHint, hrefOf, parseHref, parseRemote } from './repo';
import type { CommandHint } from './repo';
import { t } from './strings';
import { buildPrompt, parseSummary } from './summary';
import type { Summary } from './summary';
import type { PeekRef } from '../types';

const revision = atom({ plugin: 'ref-peek', key: 'revision' } as const, 0);
const peek = atom({ plugin: 'ref-peek', key: 'peek' } as const, null);
const lastRepo = atom({ plugin: 'ref-peek', key: 'lastRepo' } as const, null);
const originRepo = atom({ plugin: 'ref-peek', key: 'originRepo' } as const, null);
const blockRepo = atom({ plugin: 'ref-peek', key: 'blockRepo' } as const, null);

const MAX_FETCHES = 2;
const GH_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 5_000;
const MODEL_TIMEOUT_MS = 20_000;
const DEFAULT_COLUMNS = 80;
const BULLET_COLUMNS = 2;
const BUBBLE_FILL = 'userMessageBackground';
// The most links one Markdown answers (the engine's limit).
const MAX_PRESSABLE = 256;
// The engine's reply bullet on macOS; a mod is not told the platform, and this one is loaded on macOS only for now.
const BULLET = '⏺';

// Module-level on purpose: the work queue of this load. A reload drops it, and the next drawing asks again.
let running = 0;
const waiting: PeekRef[] = [];
const queued = new Set<string>();
// Failed generations by ref and `updated_at`: the session's retry budget.
const summaryFailures = new Map<string, number>();
// The directory whose origin was last asked for, so a drawing asks once.
let originAsked: string | null = null;

const failureKey = (ref: PeekRef, entry: Entry | undefined) => `${cacheKey(ref)}@${entry?.facts?.updatedAt}`;
const failuresOf = (ref: PeekRef, entry: Entry | undefined) => summaryFailures.get(failureKey(ref, entry)) ?? 0;

// The cast holds: only this mod writes the store.
async function readEntry($: EngineInterface, ref: PeekRef): Promise<Entry | undefined> {
  return (await $.store.get(cacheKey(ref))) as Entry | undefined;
}

async function saveEntry($: EngineInterface, ref: PeekRef, entry: Entry): Promise<void> {
  await $.store.set(cacheKey(ref), entry);
  await update($, revision, n => n + 1);
}

// Never throws: anything but an answer or a number GitHub does not know is a transient failure.
async function fetchIssue($: EngineInterface, ref: PeekRef): Promise<FetchAnswer> {
  try {
    return parseIssue((await $.process.run(issueCommand(ref), { timeoutMs: GH_TIMEOUT_MS })).stdout);
  } catch {
    return 'failed';
  }
}

// Never throws: null is the failure path, whatever the reason (no answer, a refused request, a reply that does not parse).
async function generate($: EngineInterface, facts: Facts): Promise<Summary | null> {
  try {
    const r = await $.model.complete({ model: 'haiku', prompt: buildPrompt(facts.title, facts.body), effort: 'low', timeoutMs: MODEL_TIMEOUT_MS });
    return r.isAnswered ? parseSummary(r.text) : null;
  } catch {
    return null;
  }
}

async function refreshRef($: EngineInterface, ref: PeekRef): Promise<void> {
  let entry = await readEntry($, ref);
  const now = await $.clock.now();
  if (needsCheck(entry, now)) {
    entry = applyFetch(entry, await fetchIssue($, ref), now);
    await saveEntry($, ref, entry);
  }
  if (entry?.facts == null || !needsSummary(entry, failuresOf(ref, entry))) return;
  const summary = await generate($, entry.facts);
  if (summary !== null) return saveEntry($, ref, withSummary(entry, summary));
  summaryFailures.set(failureKey(ref, entry), failuresOf(ref, entry) + 1);
}

function pump($: EngineInterface): void {
  while (running < MAX_FETCHES) {
    const ref = waiting.shift();
    if (ref === undefined) return;
    running++;
    void refreshRef($, ref).catch(() => undefined).finally(() => {
      running--;
      queued.delete(cacheKey(ref));
      pump($);
      // Last, once the ref has left the queue: a failed generation saves nothing, and this redraw shows it and can ask for the retry.
      void update($, revision, n => n + 1);
    });
  }
}

// From a drawing: the work runs from a timer, so it outlives the dispatch that asked for it.
function schedule($: EngineInterface, ref: PeekRef): void {
  if (queued.has(cacheKey(ref))) return;
  queued.add(cacheKey(ref));
  waiting.push(ref);
  $.clock.after(0, () => pump($));
}

async function remoteRepo($: EngineInterface, path: string): Promise<string | null> {
  try {
    const r = await $.process.run(['git', '-C', path, 'remote', 'get-url', 'origin'], { timeoutMs: GIT_TIMEOUT_MS });
    return r.exitCode === 0 ? parseRemote(r.stdout) : null;
  } catch {
    return null;
  }
}

async function learnOrigin($: EngineInterface, cwd: string): Promise<void> {
  const repo = await remoteRepo($, cwd);
  await update($, originRepo, () => ({ cwd, repo }));
}

async function noteCommand($: EngineInterface, hint: CommandHint): Promise<void> {
  const repo = 'repo' in hint ? hint.repo : await remoteRepo($, await expandHome($, hint.path));
  if (repo !== null) await update($, lastRepo, () => repo);
}

async function expandHome($: EngineInterface, path: string): Promise<string> {
  return path.startsWith('~/') ? `${(await $.env.get('HOME')) ?? '~'}${path.slice(1)}` : path;
}

// The session's repository as a drawing sees it: the last one worked on, else the cwd's origin (asked for once, in the background).
async function sessionRepo($: EngineInterface): Promise<string | null> {
  const last = await read($, lastRepo);
  if (last !== null) return last;
  const cwd = await $.session.cwd();
  const origin = await read($, originRepo);
  if (origin?.cwd === cwd) return origin.repo;
  if (originAsked !== cwd) {
    originAsked = cwd;
    $.clock.after(0, () => void learnOrigin($, cwd));
  }
  return null;
}

// The block's repository: the session's, pinned to the block so a later move elsewhere does not turn an old #52 into another repository's.
async function repoOfBlock($: EngineInterface, requestId: string): Promise<string | null> {
  const member = memberOf(blockRepo, { requestId });
  const pinned = await read($, member);
  if (pinned !== null) return pinned;
  const repo = await sessionRepo($);
  if (repo !== null) $.clock.after(0, () => void update($, member, () => repo));
  return repo;
}

const refOf = (token: RefToken, repo: string): PeekRef => ({ repo, number: token.number });

// Each ref's cached entry, asking the background for those that are due. Never waits on the network.
async function readBlockEntries($: EngineInterface, tokens: RefToken[], repo: string): Promise<Map<string, Entry | undefined>> {
  const now = await $.clock.now();
  const entries = new Map<string, Entry | undefined>();
  for (const token of tokens) {
    const ref = refOf(token, repo);
    if (entries.has(cacheKey(ref))) continue;
    const entry = await readEntry($, ref);
    entries.set(cacheKey(ref), entry);
    if (isDue(entry, now, failuresOf(ref, entry))) schedule($, ref);
  }
  return entries;
}

// The block annotated from what is cached; null leaves it to the engine as it is.
async function annotatedBlock($: EngineInterface, requestId: string, text: string): Promise<Annotated | null> {
  const tokens = findRefs(text);
  if (tokens.length === 0) return null;
  const repo = await repoOfBlock($, requestId);
  if (repo === null) return null;
  // Subscribes this drawing: it runs again whenever the cache or the queue moves.
  await read($, revision);
  const entries = await readBlockEntries($, tokens, repo);
  const out = annotate(text, token => {
    const ref = refOf(token, repo);
    const entry = entries.get(cacheKey(ref));
    if (entry?.facts == null) return null;
    return { href: hrefOf(ref, entry.facts.isPr), gloss: glossOf(entry.facts, entry.summary) };
  });
  return out.hrefs.length > 0 ? out : null;
}

const isSameRef = (a: PeekRef | null, b: PeekRef) => a?.repo === b.repo && a?.number === b.number;

// A press on the anchor closes the bubble; any other ref of any block moves it there.
async function pressRef($: EngineInterface, href: string, requestId: string): Promise<void> {
  const shown = parseHref(href);
  if (shown === null) return;
  await update($, peek, open => (open?.requestId === requestId && open.href === href ? null : { requestId, href, shown }));
}

// A related row: the bubble stays where it stands and shows that ref.
async function showRef($: EngineInterface, shown: PeekRef): Promise<void> {
  await update($, peek, open => open && { ...open, shown });
}

function drawBubble($: EngineInterface, e: RenderInput<'AssistantMessage'>, view: CardView, at: Placement) {
  const { Box, Button, Text } = $.ui.resolve(e);
  const side = at.side === 'above' ? { bottom: at.offset } : { top: at.offset };
  return (
    <Box position="absolute" {...side} left={at.left} width={at.width} flexDirection="column" borderStyle="round" paddingX={1} backgroundColor={BUBBLE_FILL}>
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1}><Text bold>{view.head}</Text></Box>
        <Box key="close-box" flexShrink={0} marginLeft={1}>
          <Button key="close" label={t.close} plain hover={{ color: 'cyan', bold: true }} onPress={() => update($, peek, () => null)} />
        </Box>
      </Box>
      <Text dimColor>{view.repo}</Text>
      <Text>{view.sentence}</Text>
      {view.changes.length > 0 ? (
        <Box flexDirection="column">
          <Text dimColor>{t.changes}</Text>
          {view.changes.map(line => <Text>{`· ${line}`}</Text>)}
        </Box>
      ) : null}
      {view.related.map(row => (
        <Box key={`related-box-${cacheKey(row.ref)}`}>
          <Button key={`related-${cacheKey(row.ref)}`} label={fit(row.label, at.inner)} plain hover={{ color: 'cyan', bold: true }} onPress={() => showRef($, row.ref)} />
        </Box>
      ))}
      {view.more === null ? null : <Text dimColor>{view.more}</Text>}
    </Box>
  );
}

// What the open bubble of this block shows, or null when the bubble is elsewhere.
async function openView($: EngineInterface, e: RenderInput<'AssistantMessage'>) {
  const open = await read($, peek);
  if (open === null || open.requestId !== e.requestId) return null;
  const entry = await readEntry($, open.shown);
  const failures = failuresOf(open.shown, entry);
  if (isDue(entry, await $.clock.now(), failures)) schedule($, open.shown);
  const isPending = entry === undefined || queued.has(cacheKey(open.shown)) || needsSummary(entry, failures);
  const view = entry?.facts == null ? bareView(open.shown, isPending) : cardView(open.shown, entry.facts, entry.summary, needsSummary(entry, failures));
  return { href: open.href, view };
}

// The reply's Markdown. With the bubble open it is cut after the unit holding the ref: the engine's layout then counts the rows down to the ref,
// and only the rows left in that unit are estimated. Drawn last in its Box, the bubble paints over what stands before it.
async function drawReply($: EngineInterface, e: RenderInput<'AssistantMessage'>, out: Annotated) {
  const { Box, Markdown } = $.ui.resolve(e);
  const press = (link: { href: string }) => pressRef($, link.href, e.requestId);
  const reply = (key: string, text: string) => <Markdown key={key} text={text} onLinkPress={press} pressableLinks={out.hrefs.slice(0, MAX_PRESSABLE)} />;
  const open = await openView($, e);
  const columns = (e.viewport?.columns ?? DEFAULT_COLUMNS) - BULLET_COLUMNS;
  const anchor = open === null ? null : anchorOf(out.text, open.href, columns);
  if (open === null || anchor === null) return reply('reply', out.text);

  const at = placeBubble(anchor, open.view, { columns, onScreen: e.props.onScreen });
  const bubble = drawBubble($, e, open.view, at);
  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {reply('reply', anchor.through)}
        {at.side === 'above' ? bubble : null}
      </Box>
      {anchor.tail === '' ? null : (
        <Box flexDirection="column" marginTop={anchor.gap}>
          {reply('reply-tail', anchor.tail)}
          {at.side === 'below' ? bubble : null}
        </Box>
      )}
    </Box>
  );
}

export const register: Register = on => {
  // Bash calls show where the session works. All of it runs from a timer: the call goes on at once.
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    const hint = commandHint(e.command);
    if (hint !== null) $.clock.after(0, () => void noteCommand($, hint));
    return next(e);
  });

  // A press only reaches a Markdown of ours, and `next(e)` resolves to an opaque engine node that takes none: where clicks are reported
  // (the fullscreen terminal) the block draws the engine's own row itself; everywhere else the engine's row gets the new text.
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const out = e.props.isSummary === true ? null : await annotatedBlock($, e.requestId, e.props.text);
    if (out === null) return next(e);
    if (e.surface !== 'terminal' || e.viewport?.isFullscreen === false) return next({ ...e, props: { ...e.props, text: out.text } });

    const { Box, Text } = $.ui.resolve(e);
    return (
      <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
        {e.props.isFirstOfReply ? <Box minWidth={BULLET_COLUMNS}><Text color="text">{BULLET}</Text></Box> : null}
        <Box flexDirection="column">
          {await drawReply($, e, out)}
        </Box>
      </Box>
    );
  });
};

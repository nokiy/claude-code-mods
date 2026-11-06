// Hooks entry of ref-peek: annotates the numbers a reply mentions, draws the card above the prompt, and keeps the cache behind them.
// The engine's `$` and the atoms stay in this file (the validator follows them nowhere else); recognition lives in refs.ts,
// repositories in repo.ts, cache decisions in cache.ts, the model's text in summary.ts, card text in card.ts; tests are in ../tests.
import { atom, memberOf, read, update } from 'claude-code';
import type { EngineInterface, Register } from 'claude-code';
import { applyFetch, asEntry, cacheKey, isDue, needsCheck, needsSummary, parseIssue, withSummary } from './cache';
import type { Entry, Facts, FetchAnswer } from './cache';
import { cardView, glossOf } from './card';
import { annotate, findRefs } from './refs';
import type { RefToken } from './refs';
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
const CARD_COLUMNS = 64;
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

async function readEntry($: EngineInterface, ref: PeekRef): Promise<Entry | undefined> {
  return asEntry(await $.store.get(cacheKey(ref)));
}

async function saveEntry($: EngineInterface, ref: PeekRef, entry: Entry): Promise<void> {
  await $.store.set(cacheKey(ref), entry);
  await update($, revision, n => n + 1);
}

// Never throws: anything but an answer or a 404 is a transient failure.
async function fetchIssue($: EngineInterface, ref: PeekRef): Promise<FetchAnswer> {
  try {
    const r = await $.process.run(['gh', 'api', `repos/${ref.repo}/issues/${ref.number}`], { timeoutMs: GH_TIMEOUT_MS });
    if (r.exitCode === 0) return parseIssue(r.stdout) ?? 'failed';
    return r.stderr.includes('HTTP 404') ? 'missing' : 'failed';
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
async function annotatedBlock($: EngineInterface, requestId: string, text: string): Promise<{ text: string; hrefs: string[] } | null> {
  const tokens = findRefs(text);
  if (tokens.length === 0) return null;
  const repo = await repoOfBlock($, requestId);
  if (repo === null) return null;
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

async function togglePeek($: EngineInterface, href: string): Promise<void> {
  const ref = parseHref(href);
  if (ref !== null) await update($, peek, open => (isSameRef(open, ref) ? null : ref));
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

    const { Box, Markdown, Text } = $.ui.resolve(e);
    return (
      <Box alignItems="flex-start" flexDirection="row" marginTop={1} width="100%">
        {e.props.isFirstOfReply ? <Box minWidth={2}><Text color="text">{BULLET}</Text></Box> : null}
        <Box flexDirection="column">
          <Markdown key="reply" text={out.text} onLinkPress={link => togglePeek($, link.href)} pressableLinks={out.hrefs.slice(0, MAX_PRESSABLE)} />
        </Box>
      </Box>
    );
  });

  // The card stands above the engine's band, never in its place.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const ref = await read($, peek);
    if (ref === null || e.props.hasSurvey) return next(e);
    await read($, revision);
    const entry = await readEntry($, ref);
    if (entry?.facts == null) return next(e);
    if (isDue(entry, await $.clock.now(), failuresOf(ref, entry))) schedule($, ref);

    const { Box, Button, Text } = $.ui.resolve(e);
    const view = cardView(ref, entry.facts, entry.summary);
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" paddingX={1} width={Math.min(e.props.bodyColumns, CARD_COLUMNS)}>
          <Box flexDirection="row">
            <Box flexGrow={1} flexShrink={1}><Text bold>{view.head}</Text></Box>
            <Box key="close-box" flexShrink={0} marginLeft={1}>
              <Button key="close" label={t.close} plain hover={{ color: 'cyan', bold: true }} onPress={() => update($, peek, () => null)} />
            </Box>
          </Box>
          <Text dimColor>{view.repo}</Text>
          <Box marginTop={1}><Text>{view.sentence}</Text></Box>
          {view.changes.length > 0 ? (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor>{t.changes}</Text>
              {view.changes.map(line => <Text>{`· ${line}`}</Text>)}
            </Box>
          ) : null}
        </Box>
        {await next(e)}
      </Box>
    );
  });
};

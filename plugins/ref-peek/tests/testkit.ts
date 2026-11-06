// Shared mocks of the whole-mod suites: synthetic gh, git and haiku answers beneath the plugin, the engine's stand-ins, mount helpers and a call tally.
import { mock, test } from 'claude-code/testing';

type On = Parameters<typeof mock.env>[0];
export type Dollar = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0];

export const REPO = 'o/r';
export const NOW = Date.parse('2026-11-06T10:00:00Z');
export const USAGE = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
export const SUMMARY = { title: '积分兑换', summary: '用户能用积分兑换商品', changes: ['商品页新增兑换按钮', '积分不够时提示还差多少'] };
export const FULLSCREEN = { columns: 100, rows: 40, isFullscreen: true };
const done = { isStdoutTruncated: false, isStderrTruncated: false };

/** A PR as a test writes it, in the REST field names; `relations` is its GraphQL connection of related items. */
export const prJson = (number: number, over: object = {}) => ({
  number, title: `[x] 第 ${number} 号原标题`, body: '正文', state: 'open', draft: false,
  updated_at: '2026-11-06T03:37:24Z', labels: [], pull_request: { merged_at: null }, ...over,
});

// `issues` by `repo#n`; absent reads as 404. `ghFails` makes every call a transient failure, `modelReply` is what haiku says
// (null: no answer). `ghGate` / `modelGate` hold a call until resolved. `remotes` by directory answers `git remote get-url`.
const freshState = () => ({
  issues: { [`${REPO}#52`]: prJson(52) } as Record<string, unknown>,
  ghFails: false,
  modelReply: JSON.stringify(SUMMARY) as string | null,
  ghGate: null as Promise<void> | null,
  modelGate: null as Promise<void> | null,
  remotes: { '/work/app': 'git@github.com:o/r.git' } as Record<string, string>,
  cwd: '/work/app',
});
const freshTally = () => ({ gh: 0, ghRunning: 0, ghPeak: 0, model: 0, git: 0, prompts: [] as string[], ghPaths: [] as string[] });

export const st = freshState();
export const tally = freshTally();

const run = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, ...done } });

// The GraphQL node of a fixture written in the shape the issues endpoint answers.
type Fixture = {
  title: string; body?: string | null; state: string; draft?: boolean; updated_at: string; labels?: unknown[];
  pull_request?: { merged_at: unknown }; relations?: object;
};

function nodeOf(issue: Fixture) {
  const isPr = issue.pull_request !== undefined;
  const state = issue.pull_request?.merged_at ? 'MERGED' : issue.state.toUpperCase();
  const connection = { totalCount: 0, nodes: [], ...issue.relations };
  return {
    __typename: isPr ? 'PullRequest' : 'Issue', title: issue.title, body: issue.body, state, isDraft: issue.draft === true, updatedAt: issue.updated_at,
    labels: { nodes: issue.labels ?? [] }, [isPr ? 'closingIssuesReferences' : 'closedByPullRequestsReferences']: connection,
  };
}

const NOT_FOUND = JSON.stringify({ data: { repository: { issueOrPullRequest: null } }, errors: [{ type: 'NOT_FOUND', message: 'Could not resolve' }] });

async function gh(argv: readonly string[]) {
  const field = (name: string) => argv.find(a => a.startsWith(`${name}=`))?.slice(name.length + 1);
  const repo = `${field('owner')}/${field('name')}`;
  const path = `repos/${repo}/issues/${field('number')}`;
  tally.gh++;
  tally.ghPaths.push(path);
  tally.ghRunning++;
  tally.ghPeak = Math.max(tally.ghPeak, tally.ghRunning);
  if (st.ghGate) await st.ghGate;
  tally.ghRunning--;
  if (st.ghFails) return run(1, '', 'HTTP 502');
  const issue = st.issues[`${repo}#${field('number')}`] as Fixture | undefined;
  if (issue === undefined) return run(1, NOT_FOUND, 'gh: Could not resolve to an issue or pull request');
  return run(0, JSON.stringify({ data: { repository: { issueOrPullRequest: nodeOf(issue) } } }));
}

function git(argv: readonly string[]) {
  tally.git++;
  const remote = st.remotes[argv[2] ?? ''];
  return remote === undefined ? run(2, '', 'not a git repository') : run(0, `${remote}\n`);
}

/** Everything beneath the plugin: store, clock, cwd, gh, git, haiku, and and the engine's own drawing of a reply. */
export function wire(on: On) {
  Object.assign(st, freshState());
  Object.assign(tally, freshTally());
  mock.store(on);
  mock.env(on, { HOME: '/home/me' });
  on('session.cwd', async () => ({ value: st.cwd }));
  on('process.run', async (_$, e) => ({ ...(e.argv[0] === 'gh' ? await gh(e.argv) : git(e.argv)) }));
  on('model.complete', async (_$, e) => {
    tally.model++;
    tally.prompts.push(String(e.prompt));
    if (st.modelGate) await st.modelGate;
    return { value: st.modelReply === null ? { isAnswered: false, reason: 'empty-reply', usage: USAGE } : { isAnswered: true, text: st.modelReply, usage: USAGE } } as never;
  });
  on('ui.render', { component: 'AssistantMessage' }, async (_$, e) => ({ type: 'Text', children: [e.props.text] }) as never);
  on('tool.call', async () => ({ result: {} }) as never);
  return mock.clock(on, { now: NOW });
}

type Block = { text: string; id?: string; isFirstOfReply?: boolean; surface?: 'terminal' | 'desktop'; viewport?: object; props?: object };

export const mountBlock = ($: Dollar, b: Block) => $.ui.mount({
  plugin: 'ref-peek', surface: b.surface ?? 'terminal', component: 'AssistantMessage', requestId: b.id ?? 'm1',
  props: { text: b.text, isFirstOfReply: b.isFirstOfReply ?? true, ...b.props }, viewport: b.viewport ?? FULLSCREEN,
} as never);

type Mounted = Awaited<ReturnType<typeof mountBlock>>;

/** The markdown a block shows, whichever way it was drawn. */
export async function shown(ui: Mounted): Promise<string | undefined> {
  const own = await ui.find({ type: 'Markdown' } as never) as { props?: { text?: string } } | undefined;
  return own?.props?.text ?? (await ui.find({ type: 'Text' }))?.text;
}

export const href = (n: number, repo = REPO) => `https://github.com/${repo}/pull/${n}`;
export const linked = (label: string, n: number, repo = REPO) => `[${label}](${href(n, repo)})`;

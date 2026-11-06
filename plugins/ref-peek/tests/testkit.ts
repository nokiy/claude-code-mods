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

/** The issues endpoint's answer for a PR, in the shape `gh api` gives. */
export const prJson = (number: number, over: object = {}) => ({
  number, title: `[x] 第 ${number} 号原标题`, body: '正文', state: 'open', draft: false,
  updated_at: '2026-11-06T03:37:24Z', labels: [], pull_request: { merged_at: null }, ...over,
});

// `issues` by `repo#n`; absent reads as 404. `ghFails` makes every call a transient failure, `modelReply` is what haiku says
// (null: no answer). `ghGate` / `modelGate` hold a call until resolved. `remotes` by directory answers `git remote get-url`.
export const st = {
  issues: {} as Record<string, unknown>,
  ghFails: false,
  modelReply: JSON.stringify(SUMMARY) as string | null,
  ghGate: null as Promise<void> | null,
  modelGate: null as Promise<void> | null,
  remotes: {} as Record<string, string>,
  cwd: '/work/app',
};
export const tally = { gh: 0, ghRunning: 0, ghPeak: 0, model: 0, git: 0, prompts: [] as string[], ghPaths: [] as string[] };

const run = (exitCode: number, stdout: string, stderr = '') => ({ value: { exitCode, stdout, stderr, ...done } });

async function gh(path: string) {
  tally.gh++;
  tally.ghPaths.push(path);
  tally.ghRunning++;
  tally.ghPeak = Math.max(tally.ghPeak, tally.ghRunning);
  if (st.ghGate) await st.ghGate;
  tally.ghRunning--;
  if (st.ghFails) return run(1, '', 'HTTP 502');
  const m = /^repos\/(.+)\/issues\/(\d+)$/.exec(path);
  const issue = m ? st.issues[`${m[1]}#${m[2]}`] : undefined;
  return issue === undefined ? run(1, '{"message":"Not Found"}', 'gh: Not Found (HTTP 404)') : run(0, JSON.stringify(issue));
}

function git(argv: readonly string[]) {
  tally.git++;
  const remote = st.remotes[argv[2] ?? ''];
  return remote === undefined ? run(2, '', 'not a git repository') : run(0, `${remote}\n`);
}

/** Everything beneath the plugin: store, clock, cwd, gh, git, haiku, and the engine's own drawing of a reply and of the band. */
export function wire(on: On) {
  Object.assign(st, { issues: { [`${REPO}#52`]: prJson(52) }, ghFails: false, modelReply: JSON.stringify(SUMMARY), ghGate: null, modelGate: null, remotes: { '/work/app': 'git@github.com:o/r.git' }, cwd: '/work/app' });
  Object.assign(tally, { gh: 0, ghRunning: 0, ghPeak: 0, model: 0, git: 0, prompts: [], ghPaths: [] });
  mock.store(on);
  mock.env(on, { HOME: '/home/me' });
  on('session.cwd', async () => ({ value: st.cwd }));
  on('process.run', async (_$, e) => ({ ...(e.argv[0] === 'gh' ? await gh(e.argv[2] ?? '') : git(e.argv)) }));
  on('model.complete', async (_$, e) => {
    tally.model++;
    tally.prompts.push(String(e.prompt));
    if (st.modelGate) await st.modelGate;
    return { value: st.modelReply === null ? { isAnswered: false, reason: 'empty-reply', usage: USAGE } : { isAnswered: true, text: st.modelReply, usage: USAGE } } as never;
  });
  on('ui.render', { component: 'AssistantMessage' }, async (_$, e) => ({ type: 'Text', children: [e.props.text] }) as never);
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Text', children: ['engine band'] }) as never);
  on('tool.call', async () => ({ result: {} }) as never);
  return mock.clock(on, { now: NOW });
}

export const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 19 }, view: {} } as never;

type Block = { text: string; id?: string; isFirstOfReply?: boolean; surface?: 'terminal' | 'desktop'; viewport?: object; props?: object };

export const mountBlock = ($: Dollar, b: Block) => $.ui.mount({
  plugin: 'ref-peek', surface: b.surface ?? 'terminal', component: 'AssistantMessage', requestId: b.id ?? 'm1',
  props: { text: b.text, isFirstOfReply: b.isFirstOfReply ?? true, ...b.props }, viewport: b.viewport ?? FULLSCREEN,
} as never);

export const mountBand = ($: Dollar) => $.ui.mount({ plugin: 'ref-peek', surface: 'terminal', component: 'AbovePrompt', requestId: 'band', props: BAND } as never);

type Mounted = Awaited<ReturnType<typeof mountBlock>>;

/** The markdown a block shows, whichever way it was drawn. */
export async function shown(ui: Mounted): Promise<string | undefined> {
  const own = await ui.find({ type: 'Markdown' } as never) as { props?: { text?: string } } | undefined;
  return own?.props?.text ?? (await ui.find({ type: 'Text' }))?.text;
}

export const href = (n: number, repo = REPO) => `https://github.com/${repo}/pull/${n}`;
export const linked = (label: string, n: number, repo = REPO) => `[${label}](${href(n, repo)})`;

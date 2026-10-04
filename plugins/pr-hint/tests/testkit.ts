// Shared fixtures and mocks for the register, refresh and location test suites: synthetic `gh api graphql` and git answers, the session directory, mount helpers and a call tally.
import { mock, test } from 'claude-code/testing';

// The PR as the card reads it; `gql` wraps it into GraphQL's nodes shape. `linked` is the closing issues GitHub links.
export const PR = {
  number: 10, title: 'Add dark mode', state: 'OPEN', isDraft: false,
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], closingIssuesReferences: [7, 12],
  baseRefName: 'dev', headRefName: 'spec/12-dark-mode', url: 'https://example.test/pull/10', body: 'Closes #7\nCloses #12',
};
export const ISSUE = {
  number: 7, title: 'Theme toggle', state: 'OPEN',
  body: '| Item | Target/source | State | Rounds | Rewrites |\n|--|--|--|--|--|\n| a | b | ✓ | 2 | 0 |\n| c | d | ✗ | 0 | 0 |',
};
export const SPEC = {
  number: 12, title: 'Dark mode · 深色模式贯穿设置页与编辑器 — Feature Spec', state: 'OPEN', body: '',
  labels: [{ name: 'enhancement' }, { name: 'spec' }],
};
export const PROPS = { isDraft: false, isWorking: false, hint: '▸▸ bypass permissions on' };
export const BAND_PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never;
export const VIEWPORT = { columns: 160, rows: 50 };
export const done = { isStdoutTruncated: false, isStderrTruncated: false };

type On = Parameters<typeof mock.env>[0];

// Mutable test state: the session's directory (a test moves it to stand for a cd or a /clear),
// the `git for-each-ref` answer, ticket 7's issue, and whether GitHub links the closing issues (a PR into a non-default branch has none).
// `root` is the repository root git reports (null: the session directory itself); `ghFails` makes every gh call exit 1 (a transient failure).
export const st = { dir: '/tmp/x', root: null as string | null, ghFails: false, cwdFails: false, refs: 'refs/heads/dev aaa\n', issue7: ISSUE as unknown, gate: null as Promise<void> | null, linked: true, branch: 'dev', ghBranch: null as string | null };
// gql counts PR requests, issues the follow-up by-number requests.
export const tally = { refs: 0, branch: 0, gql: 0, issues: 0 };

const labelled = (i: unknown) => ({ ...(i as object), labels: { nodes: ((i as { labels?: Array<{ name: string }> }).labels ?? []) } });
const issueOf = (n: number) => (n === 12 ? SPEC : n === 7 ? st.issue7 : null);

// `gh api graphql` answers: the PR request (query names pullRequests) or the by-number issues request.
const gql = (query: string) => {
  if (query.includes('pullRequests(')) {
    const nodes = st.linked ? PR.closingIssuesReferences.map(n => labelled(issueOf(n))) : [];
    const pr = { ...PR, commits: { nodes: [] }, statusCheckRollup: { contexts: { nodes: PR.statusCheckRollup } }, closingIssuesReferences: { nodes } };
    return { data: { repository: { pullRequests: { nodes: [pr] } } } };
  }
  const nums = [...query.matchAll(/i(\d+):issue/g)].map(m => Number(m[1]));
  return { data: { repository: Object.fromEntries(nums.map(n => [`i${n}`, issueOf(n) ? labelled(issueOf(n)) : null])) } };
};

// gh and git answers: ticket 7 has one branch two commits ahead of the head.
export const reply = (argv: readonly string[]) => {
  const ok = (stdout: string) => ({ exitCode: 0, stdout });
  if (argv[0] === 'git') {
    if (argv[1] === 'for-each-ref') return ok(st.refs);
    if (argv[1] === 'rev-parse' && argv.includes('--abbrev-ref')) return ok(`${st.branch}\n`);
    if (argv[1] === 'rev-parse' && argv.includes('--show-toplevel')) return ok(`${st.root ?? st.dir}\n`);
    if (argv[1] === 'rev-parse') return ok('abc\n');
    if (argv[1] === 'branch') return ok('dev\nspec/12-dark-mode\nfeat/7-theme-toggle\nworktree-7-x\n');
    if (argv[1] === 'rev-list') return ok(argv[3]?.endsWith('feat/7-theme-toggle') ? '2\n' : '0\n');
  }
  return ok(JSON.stringify(gql(argv[argv.length - 1] ?? '')));
};

// The language comes from the session's settings and LANG: none here, so English.
export const quiet = (on: On) => {
  st.dir = '/tmp/x';
  st.root = null;
  st.ghFails = false;
  st.cwdFails = false;
  on('session.cwd', async () => {
    if (st.cwdFails) throw new Error('cwd unavailable');
    return { value: st.dir };
  });
  mock.env(on, {});
  on('settings.read', async () => ({ value: {} }));
};

export type Dollar = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0];

export const mountHint = ($: Dollar, hint = PROPS.hint) => $.ui.mount({
  plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: { ...PROPS, hint }, viewport: VIEWPORT,
});
export const mountBand = ($: Dollar) => $.ui.mount({
  plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS,
});
// Stands for the engine's own band and hint line, which the plugin passes through when there is no PR.
export const engineLines = (on: On) => {
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Text', children: ['engine band'] }) as never);
  on('ui.render', { component: 'PromptHint' }, async (_$, e) => ({ type: 'Text', children: [e.props.hint] }) as never);
};

// Two tiers: 20 s local git, 5 min `gh api graphql`. Set `st.gate` after wire() to hold every PR request until it resolves;
// `ghHere` limits the gh answers to one directory and `st.ghBranch` to one branch (elsewhere gh finds no PR).
export const wire = (on: On, ghHere?: string) => {
  Object.assign(tally, { refs: 0, branch: 0, gql: 0, issues: 0 });
  st.refs = 'refs/heads/dev aaa\n';
  st.issue7 = ISSUE;
  st.gate = null;
  st.linked = true;
  st.branch = 'dev';
  st.ghBranch = null;
  quiet(on);
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'for-each-ref') tally.refs++;
    if (e.argv[1] === 'branch') tally.branch++;
    if (e.argv[0] === 'gh') {
      const isPr = (e.argv[e.argv.length - 1] ?? '').includes('pullRequests(');
      tally[isPr ? 'gql' : 'issues']++;
      if (isPr && st.gate) await st.gate;
    }
    if (e.argv[0] === 'gh' && st.ghFails) return { value: { exitCode: 1, stdout: '', stderr: 'HTTP 502', ...done } };
    // Elsewhere gh answers successfully, with no PR.
    if (e.argv[0] === 'gh' && ((ghHere !== undefined && st.dir !== ghHere) || (st.ghBranch !== null && st.branch !== st.ghBranch))) {
      return { value: { exitCode: 0, stdout: JSON.stringify({ data: { repository: { pullRequests: { nodes: [] } } } }), stderr: '', ...done } };
    }
    return { value: { ...reply(e.argv), stderr: '', ...done } };
  });
};

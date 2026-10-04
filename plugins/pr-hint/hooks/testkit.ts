// Shared fixtures and mocks for the register.test.ts and cwd.test.ts suites: synthetic gh and git answers, the session directory and a call tally.
import { mock } from 'claude-code/testing';

export const PR = {
  number: 10, title: 'Add dark mode', state: 'OPEN', isDraft: false, reviewDecision: '',
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], additions: 3, deletions: 3,
  changedFiles: 1, closingIssuesReferences: [{ number: 7 }, { number: 12 }], mergeable: 'MERGEABLE',
  baseRefName: 'dev', headRefName: 'spec/12-dark-mode', url: 'https://example.test/pull/10',
  updatedAt: '2026-01-10T10:51:08Z',
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
// the `git for-each-ref` answer and ticket 7's issue.
export const st = { dir: '/tmp/x', cwdFails: false, refs: 'refs/heads/dev aaa\n', issue7: ISSUE as unknown, gate: null as Promise<void> | null };
export const tally = { refs: 0, branch: 0, pr: 0, issue: 0 };

// gh and git answers: ticket 7 has one branch two commits ahead of the head.
export const reply = (argv: readonly string[]) => {
  const ok = (stdout: string) => ({ exitCode: 0, stdout });
  if (argv[0] === 'git') {
    if (argv[1] === 'for-each-ref') return ok(st.refs);
    if (argv[1] === 'rev-parse') return ok('abc\n');
    if (argv[1] === 'branch') return ok('dev\nspec/12-dark-mode\nfeat/7-theme-toggle\nworktree-7-x\n');
    if (argv[1] === 'rev-list') return ok(argv[3]?.endsWith('feat/7-theme-toggle') ? '2\n' : '0\n');
  }
  if (argv[1] === 'issue') return ok(JSON.stringify(argv[3] === '12' ? SPEC : ISSUE));
  return ok(JSON.stringify(PR));
};

// The language comes from the session's settings and LANG: none here, so English.
export const quiet = (on: On) => {
  st.dir = '/tmp/x';
  st.cwdFails = false;
  on('session.cwd', async () => {
    if (st.cwdFails) throw new Error('cwd unavailable');
    return { value: st.dir };
  });
  mock.env(on, {});
  on('settings.read', async () => ({ value: {} }));
};

// Three tiers: 20 s local git, 60 s PR, 5 min issues. `gate` holds every `gh pr view` until it resolves;
// `ghHere` limits the gh answers to one directory (elsewhere gh finds no PR).
export const wire = (on: On, gate?: Promise<void>, ghHere?: string) => {
  Object.assign(tally, { refs: 0, branch: 0, pr: 0, issue: 0 });
  st.refs = 'refs/heads/dev aaa\n';
  st.issue7 = ISSUE;
  st.gate = null;
  quiet(on);
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'for-each-ref') tally.refs++;
    if (e.argv[1] === 'branch') tally.branch++;
    if (e.argv[1] === 'issue') tally.issue++;
    if (e.argv[1] === 'pr') {
      tally.pr++;
      if (gate) await gate;
      if (st.gate) await st.gate;
    }
    if (e.argv[0] === 'gh' && ghHere !== undefined && st.dir !== ghHere) {
      return { value: { exitCode: 1, stdout: '', stderr: '', ...done } };
    }
    const r = e.argv[1] === 'issue' && e.argv[3] === '7' ? { exitCode: 0, stdout: JSON.stringify(st.issue7) } : reply(e.argv);
    return { value: { ...r, stderr: '', ...done } };
  });
};

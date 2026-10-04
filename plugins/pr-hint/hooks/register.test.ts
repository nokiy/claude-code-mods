// Renders PromptHint and AbovePrompt through the plugin with gh and git output mocked beneath it, on synthetic data.
import { expect, mock, test } from 'claude-code/testing';

const PR = {
  number: 10, title: 'Add dark mode', state: 'OPEN', isDraft: false, reviewDecision: '',
  statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }], additions: 3, deletions: 3,
  changedFiles: 1, closingIssuesReferences: [{ number: 7 }, { number: 12 }], mergeable: 'MERGEABLE',
  baseRefName: 'dev', headRefName: 'spec/12-dark-mode', url: 'https://example.test/pull/10',
  updatedAt: '2026-01-10T10:51:08Z',
};
const ISSUE = {
  number: 7, title: 'Theme toggle', state: 'OPEN',
  body: '| Item | Target/source | State | Rounds | Rewrites |\n|--|--|--|--|--|\n| a | b | ✓ | 2 | 0 |\n| c | d | ✗ | 0 | 0 |',
};
const SPEC = {
  number: 12, title: 'Dark mode · 深色模式贯穿设置页与编辑器 — Feature Spec', state: 'OPEN', body: '',
  labels: [{ name: 'enhancement' }, { name: 'spec' }],
};
// gh and git answers: ticket 7 has one branch two commits ahead of the head.
let refs = 'refs/heads/dev aaa\n';
const reply = (argv: readonly string[]) => {
  const ok = (stdout: string) => ({ exitCode: 0, stdout });
  if (argv[0] === 'git') {
    if (argv[1] === 'for-each-ref') return ok(refs);
    if (argv[1] === 'rev-parse') return ok('abc\n');
    if (argv[1] === 'branch') return ok('dev\nspec/12-dark-mode\nfeat/7-theme-toggle\nworktree-7-x\n');
    if (argv[1] === 'rev-list') return ok(argv[3]?.endsWith('feat/7-theme-toggle') ? '2\n' : '0\n');
  }
  if (argv[1] === 'issue') return ok(JSON.stringify(argv[3] === '12' ? SPEC : ISSUE));
  return ok(JSON.stringify(PR));
};
const PROPS = { isDraft: false, isWorking: false, hint: '▸▸ bypass permissions on' };
// The language comes from the session's settings and LANG: none here, so English.
const quiet = (on: Parameters<typeof mock.env>[0]) => {
  mock.env(on, {});
  on('settings.read', async () => ({ value: {} }));
};

for (const [name, hasPr] of [['with PR', true], ['no PR', false]] as const) {
  test(`PromptHint ${name}`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    quiet(on);
    const done = { isStdoutTruncated: false, isStderrTruncated: false };
    on('session.start', async (_$, e) => ({ cwd: e.cwd }));
    on('process.run', async (_$, e) => {
      if (!hasPr) return { value: { exitCode: 1, stdout: '', stderr: 'no pull requests found', ...done } };
      return { value: { ...reply(e.argv), stderr: '', ...done } };
    });
    // Stands for the engine's own line, which the plugin passes through when there is no PR.
    on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Text', children: ['engine band'] }) as never);
    on('ui.render', { component: 'PromptHint' }, async (_$, e) => ({ type: 'Text', children: [e.props.hint] }) as never);
    await $.session.start({ cwd: '/tmp/x' } as never);
    await clock.settle();

    const ui = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: { columns: 160, rows: 50 } });
    const hint = await ui.find({ type: 'Text', text: /bypass permissions/ });
    expect(hint).toBeDefined();
    const pr = await ui.find({ type: 'Button', key: 'pin' });
    if (hasPr) {
      expect(pr).toBeDefined();
      const tree0 = JSON.stringify(await ui.drawn());
      // One row: the hint, the ▸ pin Button, then `PR #N` (cyan, bold), title and counts in one Text.
      expect((await ui.find({ type: 'Text', text: /^▸▸ bypass/ }))?.text).toBe('▸▸ bypass permissions on · ');
      expect(pr?.props.label).toBe('▸');
      // PR number, title (the only part that shrinks) and counts are separate pieces of one row.
      expect((await ui.find({ type: 'Text', text: /Add dark mode/ }))?.text).toBe(' Add dark mode');
      expect((await ui.find({ type: 'Text', text: /merged/ }))?.text).toBe(' · merged 0/1 · accepted 0/1');
      const num = await ui.find({ type: 'Text', text: /^PR #10$/ });
      expect(num?.props.color).toBe('cyan');
      expect(num?.props.bold).toBe(true);
      // The mode phrase is red, as the engine draws it; the engine element is not nested; no spacer.
      const spans = await ui.findAll({ type: 'Text', text: /bypass permissions on/ });
      expect(spans.some(s => s.props.color === 'red')).toBe(true);
      expect(tree0).not.toContain('"type":"engine"');
      expect(tree0).not.toContain('flexGrow');
      expect(await ui.find({ type: 'Text', text: /● #12/ })).toBeUndefined();
      // The hint row carries the hover scope; no 📌, the PR number is the click target; no card of its own.
      expect(tree0).toContain('"scope":"pr-hint-card"');
      expect(tree0).not.toContain('📌');
      expect(tree0).not.toContain('"position":"absolute"');
      expect(tree0).not.toContain('Spec #');

      // The AbovePrompt band: hidden with hover reveal until pinned, the full hierarchy, all tickets.
      const band = await $.ui.mount({
        plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
      });
      const root = (await band.drawn()) as unknown as {
        props: { display?: string }; hover?: { scope?: string; display?: string }; children: Array<{ children?: unknown[] }>;
      };
      const hidden = (r: typeof root) => JSON.stringify(r);
      expect(hidden(root)).toContain('"display":"none"');
      expect(hidden(root)).toContain('"hover":{"scope":"pr-hint-card","display":"flex"}');
      // A press on the pin shows the card without display:none; a second press hides it again.
      await ui.press({ key: 'pin' });
      await clock.settle();
      const shown = (await band.drawn()) as unknown as typeof root;
      expect(hidden(shown)).not.toContain('"display":"none"');
      expect(hidden(shown)).not.toContain('"scope":"pr-hint-card"');
      await ui.press({ key: 'pin' });
      await clock.settle();
      expect(hidden((await band.drawn()) as unknown as typeof root)).toContain('"display":"none"');
      const lines = (await band.findAll({ type: 'Text' })).map(x => x.text ?? '');
      const idx = (re: RegExp) => lines.findIndex(l => re.test(l));
      // Order: title, Spec, CI + summary, ticket lines, link row (the Spec is not a ticket line).
      expect(idx(/^PR #10 Add dark mode/)).toBeGreaterThanOrEqual(0);
      expect(idx(/^PR #10 /)).toBeLessThan(idx(/^Spec #12 Dark mode · 深色模式贯穿设置页与编辑器 · integration branch dev ← spec\/12-dark-mode/));
      expect(idx(/^Spec #12/)).toBeLessThan(idx(/^CI ✓1\/1 · merged 0\/1 · accepted 0\/1/));
      expect(idx(/^CI ✓1/)).toBeLessThan(idx(/^● #7 in progress Theme toggle · feat\/7-theme-toggle · 2 commits behind/));
      expect(idx(/^● #7/)).toBeLessThan(idx(/^Open PR · updated/));
      expect(lines.some(l => l.startsWith('● #12'))).toBe(false);
      await band.unmount();
    } else {
      expect(pr).toBeUndefined();
      // No PR: the band passes through to the engine's own (stand-in) drawing too.
      const band = await $.ui.mount({
        plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt',
        props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
      });
      expect(await band.find({ type: 'Text', text: /engine band/ })).toBeDefined();
      expect(JSON.stringify(await band.drawn())).not.toContain('pr-hint-card');
      await band.unmount();
    }
    await ui.unmount();
  });
}

test('hint is drawn as spans (no nested engine element) and the timers reuse cached tickets', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  quiet(on);
  const done = { isStdoutTruncated: false, isStderrTruncated: false };
  let issueCalls = 0;
  let gitCalls = 0;
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'issue') issueCalls++;
    if (e.argv[0] === 'git' && e.argv[1] !== 'for-each-ref') gitCalls++;
    return { value: { ...reply(e.argv), stderr: '', ...done } };
  });
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  expect(issueCalls).toBe(2);

  const ui = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: { columns: 160, rows: 50 } });
  expect(await ui.find({ type: 'Button', key: 'pin' })).toBeDefined();
  expect(JSON.stringify(await ui.drawn())).not.toContain('"type":"engine"');
  await ui.unmount();

  const gitBefore = gitCalls;
  await clock.advance(60_000);
  expect(issueCalls).toBe(2);
  // The ticks find nothing new: no status recompute, no issue calls.
  expect(gitCalls).toBe(gitBefore);
});

for (const state of ['MERGED', 'CLOSED']) {
  test(`a ${state} PR reads as no PR: the engine line is untouched`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    quiet(on);
    const done = { isStdoutTruncated: false, isStderrTruncated: false };
    on('session.start', async (_$, e) => ({ cwd: e.cwd }));
    on('process.run', async (_$, e) => {
      const out = e.argv[1] === 'pr' ? { ...PR, state } : {};
      return { value: { exitCode: 0, stdout: JSON.stringify(out), stderr: '', ...done } };
    });
    on('ui.render', { component: 'PromptHint' }, async (_$, e) => ({ type: 'Text', children: [e.props.hint] }) as never);
    await $.session.start({ cwd: '/tmp/x' } as never);
    await clock.settle();
    const ui = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: { columns: 160, rows: 50 } });
    expect(await ui.find({ type: 'Button', key: 'pin' })).toBeUndefined();
    expect(await ui.find({ type: 'Text', text: /bypass permissions/ })).toBeDefined();
    await ui.unmount();
  });
}

test('the ticket cache is recomputed when headRefOid changes', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  quiet(on);
  const done = { isStdoutTruncated: false, isStderrTruncated: false };
  let oid = 'aaa';
  let issueCalls = 0;
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'issue') issueCalls++;
    const r = e.argv[1] === 'pr' ? { exitCode: 0, stdout: JSON.stringify({ ...PR, headRefOid: oid }) } : reply(e.argv);
    return { value: { ...r, stderr: '', ...done } };
  });
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  expect(issueCalls).toBe(2);
  await clock.advance(60_000);
  expect(issueCalls).toBe(2);
  oid = 'bbb';
  await clock.advance(60_000);
  expect(issueCalls).toBe(4);
});

// Three tiers: 20 s local git, 60 s PR, 5 min issues.
const done = { isStdoutTruncated: false, isStderrTruncated: false };
const tally = { refs: 0, branch: 0, pr: 0, issue: 0 };
let issue7 = ISSUE;
const wire = (on: Parameters<typeof mock.env>[0], gate?: Promise<void>) => {
  Object.assign(tally, { refs: 0, branch: 0, pr: 0, issue: 0 });
  refs = 'refs/heads/dev aaa\n';
  issue7 = ISSUE;
  quiet(on);
  on('session.start', async (_$, e) => ({ cwd: e.cwd }));
  on('process.run', async (_$, e) => {
    if (e.argv[1] === 'for-each-ref') tally.refs++;
    if (e.argv[1] === 'branch') tally.branch++;
    if (e.argv[1] === 'issue') tally.issue++;
    if (e.argv[1] === 'pr') {
      tally.pr++;
      if (gate) await gate;
    }
    const r = e.argv[1] === 'issue' && e.argv[3] === '7' ? { exitCode: 0, stdout: JSON.stringify(issue7) } : reply(e.argv);
    return { value: { ...r, stderr: '', ...done } };
  });
};

test('the 20s tick: an unchanged ref snapshot recomputes nothing, a changed one recomputes with no gh call', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const base = { ...tally };
  await clock.advance(20_000);
  expect(tally.refs).toBe(base.refs + 1);
  expect(tally.branch).toBe(base.branch);
  expect(tally.pr).toBe(base.pr);
  expect(tally.issue).toBe(base.issue);

  refs = 'refs/heads/dev aaa\nrefs/heads/feat/12-x bbb\n';
  const before = { ...tally };
  await clock.advance(20_000);
  expect(tally.branch).toBe(before.branch + 1);
  expect(tally.pr).toBe(before.pr);
  expect(tally.issue).toBe(before.issue);
});

test('the 5 min tick re-reads the issues and flips a CLOSED ticket to accepted', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const band = await $.ui.mount({
    plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100 } as never,
  });
  expect(await band.find({ type: 'Text', text: /^● #7 in progress/ })).toBeDefined();
  issue7 = { ...ISSUE, state: 'CLOSED' };
  await clock.advance(240_000);
  const issuesBefore = tally.issue;
  expect(await band.find({ type: 'Text', text: /^● #7 in progress/ })).toBeDefined();
  await clock.advance(60_000);
  expect(tally.issue).toBeGreaterThan(issuesBefore);
  expect(await band.find({ type: 'Text', text: /^● #7 accepted/ })).toBeDefined();
  await band.unmount();
});

test('two session.start events leave one timer per tier', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const base = { ...tally };
  await clock.advance(20_000);
  expect(tally.refs).toBe(base.refs + 1);
  await clock.advance(40_000);
  // 60 s in all: three git ticks, one PR tick.
  expect(tally.refs).toBe(base.refs + 3);
  expect(tally.pr).toBe(base.pr + 1);
});

test('a full refresh asked for while busy runs right after', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  let open = () => {};
  wire(on, new Promise<void>(r => { open = r; }));
  await $.session.start({ cwd: '/tmp/x' } as never);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  expect(tally.pr).toBe(1);
  open();
  await clock.settle();
  expect(tally.pr).toBe(2);
  expect(tally.issue).toBe(4);
});

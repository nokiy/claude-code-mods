// Renders PromptHint and AbovePrompt through the plugin with gh and git output mocked beneath it, on synthetic data; the location (directory, branch) and agents-pill cases live in location.test.ts.
import { expect, mock, test } from 'claude-code/testing';
import { BAND_PROPS, ISSUE, PR, PROPS, VIEWPORT, done, quiet, reply, st, tally, wire } from './testkit';

for (const [name, hasPr] of [['with PR', true], ['no PR', false]] as const) {
  test(`PromptHint ${name}`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    quiet(on);
    on('session.start', async (_$, e) => ({ cwd: e.cwd }));
    on('process.run', async (_$, e) => {
      if (!hasPr && e.argv[0] === 'gh') return { value: { exitCode: 0, stdout: '{"data":{"repository":{"pullRequests":{"nodes":[]}}}}', stderr: '', ...done } };
      return { value: { ...reply(e.argv), stderr: '', ...done } };
    });
    // Stands for the engine's own line, which the plugin passes through when there is no PR.
    on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Text', children: ['engine band'] }) as never);
    on('ui.render', { component: 'PromptHint' }, async (_$, e) => ({ type: 'Text', children: [e.props.hint] }) as never);
    await $.session.start({ cwd: '/tmp/x' } as never);
    await clock.settle();

    const ui = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: VIEWPORT });
    const hint = await ui.find({ type: 'Text', text: /bypass permissions/ });
    expect(hint).toBeDefined();
    const pr = await ui.find({ type: 'Button', key: 'pin' });
    if (hasPr) {
      expect(pr).toBeDefined();
      const tree0 = JSON.stringify(await ui.drawn());
      // One row: the hint, the ▸ pin Button, then `PR #N` (cyan, bold), title and counts in one Text.
      expect((await ui.find({ type: 'Text', text: /^▸▸ bypass/ }))?.text).toBe('▸▸ bypass permissions on ·');
      expect(pr?.props.label).toBe(' ▸ ');
      // PR number, title (the only part that shrinks) and counts are separate pieces of one row.
      expect((await ui.find({ type: 'Text', text: /Add dark mode/ }))?.text).toBe(' Add dark mode');
      const chip = await ui.find({ type: 'Text', text: /^Ready$/ });
      expect(chip?.props.color).toBe('magenta');
      expect(await ui.find({ type: 'Text', text: /merged|accepted/ })).toBeUndefined();
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
      const band = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
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
      // Order: title, Spec, CI + PR state, ticket lines, link row (the Spec is not a ticket line).
      expect(idx(/^PR #10 Add dark mode/)).toBeGreaterThanOrEqual(0);
      expect(idx(/^PR #10 /)).toBeLessThan(idx(/^Spec #12 Dark mode · 深色模式贯穿设置页与编辑器 · integration branch dev ← spec\/12-dark-mode/));
      expect(idx(/^Spec #12/)).toBeLessThan(idx(/^CI ✓1\/1 · Ready$/));
      expect(idx(/^CI ✓1/)).toBeLessThan(idx(/^● #7 in progress Theme toggle · feat\/7-theme-toggle · 2 commits behind/));
      expect(idx(/^● #7/)).toBeLessThan(idx(/^Open PR · fetched just now$/));
      expect(lines.some(l => l.startsWith('● #12'))).toBe(false);
      await band.unmount();
    } else {
      expect(pr).toBeUndefined();
      // No PR: the band passes through to the engine's own (stand-in) drawing too.
      const band = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
      expect(await band.find({ type: 'Text', text: /engine band/ })).toBeDefined();
      expect(JSON.stringify(await band.drawn())).not.toContain('pr-hint-card');
      await band.unmount();
    }
    await ui.unmount();
  });
}

test('hint is drawn as spans (no nested engine element) and a minute of timers asks gh for nothing', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  // One GraphQL request carried the PR and both closing issues.
  expect(tally.gql).toBe(1);
  expect(tally.issues).toBe(0);

  const ui = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: VIEWPORT });
  expect(await ui.find({ type: 'Button', key: 'pin' })).toBeDefined();
  expect(JSON.stringify(await ui.drawn())).not.toContain('"type":"engine"');
  await ui.unmount();

  const base = { ...tally };
  await clock.advance(60_000);
  // Three git ticks find the same refs: no status recompute, no gh call.
  expect(tally.branch).toBe(base.branch);
  expect(tally.gql).toBe(1);
});

for (const state of ['MERGED', 'CLOSED']) {
  test(state === 'MERGED' ? 'a MERGED PR stays on its branch as a green Merged chip' : 'a CLOSED PR reads as no PR: the engine line is untouched', async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    quiet(on);
    on('session.start', async (_$, e) => ({ cwd: e.cwd }));
    on('process.run', async (_$, e) => ({ value: { ...reply(e.argv), stderr: '', ...done } }));
    on('ui.render', { component: 'PromptHint' }, async (_$, e) => ({ type: 'Text', children: [e.props.hint] }) as never);
    PR.state = state;
    try {
      await $.session.start({ cwd: '/tmp/x' } as never);
      await clock.settle();
    } finally {
      PR.state = 'OPEN';
    }
    const ui = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: VIEWPORT });
    expect(await ui.find({ type: 'Text', text: /bypass permissions/ })).toBeDefined();
    if (state === 'MERGED') {
      expect(await ui.find({ type: 'Button', key: 'pin' })).toBeDefined();
      expect((await ui.find({ type: 'Text', text: /^Merged$/ }))?.props.color).toBe('green');
    } else {
      expect(await ui.find({ type: 'Button', key: 'pin' })).toBeUndefined();
    }
    await ui.unmount();
  });
}

test('the 20s tick: an unchanged ref snapshot recomputes nothing, a changed one recomputes with no gh call', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const base = { ...tally };
  await clock.advance(20_000);
  expect(tally.refs).toBe(base.refs + 1);
  expect(tally.branch).toBe(base.branch);
  expect(tally.gql).toBe(base.gql);
  expect(tally.issues).toBe(base.issues);

  st.refs = 'refs/heads/dev aaa\nrefs/heads/feat/12-x bbb\n';
  const before = { ...tally };
  await clock.advance(20_000);
  expect(tally.branch).toBe(before.branch + 1);
  expect(tally.gql).toBe(before.gql);
  expect(tally.issues).toBe(before.issues);
});

test('the 5 min tick makes one GraphQL request and flips a CLOSED ticket to accepted', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const band = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  expect(await band.find({ type: 'Text', text: /^● #7 in progress/ })).toBeDefined();
  st.issue7 = { ...ISSUE, state: 'CLOSED' };
  await clock.advance(280_000);
  // Nothing asks gh before the 5 min mark (the 20 s ticks are local git only).
  expect(tally.gql).toBe(1);
  expect(await band.find({ type: 'Text', text: /^● #7 in progress/ })).toBeDefined();
  await clock.advance(20_000);
  expect(tally.gql).toBe(2);
  expect(tally.issues).toBe(0);
  expect(await band.find({ type: 'Text', text: /^● #7 accepted/ })).toBeDefined();
  await band.unmount();
});

test('a PR GitHub links no issue to (non-default base) reads its Closes #N issues with one more request', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  st.linked = false;
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  expect(tally.gql).toBe(1);
  expect(tally.issues).toBe(1);
  const band = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  expect(await band.find({ type: 'Text', text: /^● #7 in progress Theme toggle/ })).toBeDefined();
  expect(await band.find({ type: 'Text', text: /^Spec #12 / })).toBeDefined();
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
  await clock.advance(280_000);
  // 5 min in all: one gh tick (a stacked second timer would make two).
  expect(tally.gql).toBe(base.gql + 1);
});

test('a full refresh asked for while a full fetch is in flight joins it instead of queueing another', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  let open = () => {};
  wire(on);
  st.gate = new Promise<void>(r => { open = r; });
  await $.session.start({ cwd: '/tmp/x' } as never);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  expect(tally.gql).toBe(1);
  open();
  await clock.settle();
  expect(tally.gql).toBe(1);
  // Once it has finished, the next request is a new fetch.
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  expect(tally.gql).toBe(2);
});

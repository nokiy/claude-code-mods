// Renders PromptHint and AbovePrompt through the plugin with gh and git output mocked beneath it, on synthetic data; the location (directory, branch) and agents-pill cases live in location.test.ts.
import { expect, mock, test } from 'claude-code/testing';
import { BAND_PROPS, ISSUE, PR, PROPS, VIEWPORT, done, engineLines, injectPrStats, mountBand, mountHint, quiet, reply, st, tally, wire } from './testkit';

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
      // Exactly two header rows (PR #n, title, bar, Tickets d/n, Spec #n; then ◐ N running), ticket lines, link row.
      const rows = lines.filter(l => /^(PR #10 .+ Tickets|◐ \d+ running|● #\d+ |Open PR)/.test(l));
      expect(rows).toHaveLength(4);
      expect(rows[0]).toMatch(/^PR #10 Add dark mode █*░+ Tickets 0\/1 · Spec #12$/);
      expect(rows[1]).toBe('◐ 1 running');
      expect(rows[2]).toBe('● #7 running Theme toggle · feat/7-theme-toggle · 2 commits behind');
      expect(rows[3]).toBe('Open PR · fetched just now');
      expect(idx(/^PR #10 /)).toBeLessThan(idx(/^◐/));
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

for (const [state, sha] of [['MERGED', 'aaa'], ['MERGED', 'bbb'], ['CLOSED', 'aaa']] as const) {
  const name = state === 'CLOSED'
    ? 'a CLOSED PR reads as no PR: the engine line is untouched'
    : sha === 'aaa'
      ? 'a MERGED PR shows a green Merged chip while the branch sits on its merged commit'
      : 'a MERGED PR of a branch that moved on (dev after a release) reads as no PR';
  test(name, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    quiet(on);
    st.branch = 'dev';
    st.refs = `refs/heads/dev ${sha}\n`;
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
    if (state === 'MERGED' && sha === 'aaa') {
      expect(await ui.find({ type: 'Button', key: 'pin' })).toBeDefined();
      expect((await ui.find({ type: 'Text', text: /^Merged$/ }))?.props.color).toBe('green');
    } else {
      expect(await ui.find({ type: 'Button', key: 'pin' })).toBeUndefined();
    }
    await ui.unmount();
  });
}

test('a new commit on the branch drops its Merged PR at the next 20 s tick, with no gh call', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on);
  PR.state = 'MERGED';
  try {
    await $.session.start({ cwd: '/tmp/x' } as never);
    await clock.settle();
    const ui = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: VIEWPORT });
    expect(await ui.find({ type: 'Text', text: /^Merged$/ })).toBeDefined();
    const gql = tally.gql;
    st.refs = 'refs/heads/dev ccc\n';
    await clock.advance(20_000);
    expect(tally.gql).toBe(gql);
    expect(await ui.find({ type: 'Button', key: 'pin' })).toBeUndefined();
    await ui.unmount();
  } finally {
    PR.state = 'OPEN';
  }
});

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
  engineLines(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const band = await mountBand($);
  expect(await band.find({ type: 'Text', text: /^● #7 running/ })).toBeDefined();
  st.issue7 = { ...ISSUE, state: 'CLOSED' };
  await clock.advance(280_000);
  // Nothing asks gh before the 5 min mark (the 20 s ticks are local git only).
  expect(tally.gql).toBe(1);
  expect(await band.find({ type: 'Text', text: /^● #7 running/ })).toBeDefined();
  await clock.advance(20_000);
  expect(tally.gql).toBe(2);
  expect(tally.issues).toBe(0);
  expect(await band.find({ type: 'Text', text: /^● #7 accepted/ })).toBeDefined();
  await band.unmount();
});

// Spec story 3: tickets fast-forward merged into the integration branch count as merged. Their branches sit inside
// the head (`rev-list head..branch` = 0) and leave no merge commit; their headlines end in `(#N)`.
// A ticket branch inside the head whose number no headline carries stays not started (a branch alone is no progress).
const SEVEN = [40, 41, 42, 43, 44, 45, 46];
for (const withHeadlines of [true, false]) {
  test(`fast-forward merged tickets: headlines ending (#N) read Merged, Tickets 7/7 (headlines ${withHeadlines})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    wire(on);
    engineLines(on);
    st.closing = [...SEVEN, 12];
    st.issues = Object.fromEntries(SEVEN.map(n => [n, { number: n, title: `t${n}`, state: 'OPEN', body: '' }]));
    st.branches = ['dev', 'spec/12-dark-mode', ...SEVEN.flatMap(n => [`feature/${n}-x`, `origin/feature/${n}-x`])].join('\n');
    st.headlines = withHeadlines ? SEVEN.map(n => `feat(x): y (#${n})`) : ['chore: draft PR'];
    await $.session.start({ cwd: '/tmp/x' } as never);
    await clock.settle();
    const band = await mountBand($);
    const lines = (await band.findAll({ type: 'Text' })).map(x => x.text ?? '');
    const word = withHeadlines ? 'Merged' : 'not started';
    for (const n of SEVEN) expect(lines.some(l => l.startsWith(`● #${n} ${word} t${n}`))).toBe(true);
    expect(lines.some(l => /^PR #10 .+ Tickets (\d)\/7 · Spec #12$/.test(l) && l.includes(withHeadlines ? 'Tickets 7/7' : 'Tickets 0/7'))).toBe(true);
    await band.unmount();
  });
}

// Row 4: the bar has a fixed width and does not span the card. At 160 columns the old bar took all the title left:
// 144 cells (156 inner − ` ↻ refresh ` − gap) − `PR #10 ` − ` Add dark mode ` − ` Tickets 0/1 · Spec #12` = 100 cells.
// Now it is at most 2/5 of that and 32 cells, and `Tickets d/n · Spec #n` follows it directly.
test('at 160 columns the bar is fixed (≤ 2/5 of the old 100 cells, at most 32) and Tickets · Spec follow it', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const band = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, bodyColumns: 160 } as never });
  const head = (await band.findAll({ type: 'Text' })).map(x => x.text ?? '').find(l => l.startsWith('PR #10 ')) ?? '';
  const m = /^PR #10 Add dark mode ([█░]+) Tickets 0\/1 · Spec #12$/u.exec(head);
  expect(m).not.toBeNull();
  expect(m![1]!.length).toBeLessThanOrEqual(32);
  await band.unmount();
});

// The chain's later drawers (agent-monitor's rows, the engine band) render under the card, never inside its hidden box.
type Node = { type?: string; props?: { display?: string; borderStyle?: string }; children?: unknown[] };
const pathTo = (n: unknown, hit: (x: Node) => boolean): Node[] | null => {
  if (n === null || typeof n !== 'object') return null;
  if (hit(n as Node)) return [n as Node];
  for (const p of ((n as Node).children ?? []).map(c => pathTo(c, hit))) if (p) return [n as Node, ...p];
  return null;
};
const isMarker = (x: Node) => x.type === 'Text' && x.children?.[0] === 'engine band';

for (const pin of [false, true]) {
  test(`with a PR the band draws the card and passes the chain on below it (pinned ${pin})`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    wire(on);
    engineLines(on);
    await $.session.start({ cwd: '/tmp/x' } as never);
    await clock.settle();
    const hint = await mountHint($);
    if (pin) await hint.press({ key: 'pin' }).then(() => clock.settle());
    const band = await mountBand($);
    const tree = await band.drawn();
    const [toMarker, toCard] = [pathTo(tree, isMarker), pathTo(tree, x => x.props?.borderStyle === 'round')];
    expect([toMarker, toCard]).not.toContain(null);
    // Card first, rest below; the marker is not inside the card, and nothing above it is hidden.
    expect(toMarker!.includes(toCard!.at(-1)!)).toBe(false);
    expect(toMarker!.some(x => x.props?.display === 'none')).toBe(false);
    expect(toCard!.at(-1)!.props?.display).toBe(pin ? undefined : 'none');
    const lines = (await band.findAll({ type: 'Text' })).map(x => x.text ?? '');
    expect(lines.findIndex(l => /^PR #10 /.test(l))).toBeLessThan(lines.indexOf('engine band'));
    await band.unmount();
    await hint.unmount();
  });
}

test("the card reads agent-monitor's prStats: absent, line 2 is ◐ N running alone; present, it gains cost and refusals", async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on);
  const stats = injectPrStats(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const draw = async () => {
    const band = await mountBand($);
    const lines = (await band.findAll({ type: 'Text' })).map(x => x.text ?? '');
    await band.unmount();
    return lines;
  };
  const absent = await draw();
  expect(stats.reads).toBeGreaterThan(0);
  expect(absent.filter(l => /^◐ \d+ running$/.test(l))).toHaveLength(1);
  const seen = stats.reads;
  stats.value = { '10': { tokens: 86_200, cost: 1.25, ms: 754_000, refusals: 2 } };
  const present = await draw();
  expect(stats.reads).toBeGreaterThan(seen);
  expect(present.filter(l => /^◐ \d+ running · ≈\$1\.25 · 86\.2k tokens · 12m34s \(subagents only\) · blocked ×2$/.test(l))).toHaveLength(1);
});

test('with a PR and an empty rest of the chain, the band shows the card alone', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on, null);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const band = await mountBand($);
  const [card, rest] = ((await band.drawn()) as unknown as Node).children as Node[];
  expect(card?.props?.borderStyle).toBe('round');
  expect(card?.props?.display).toBe('none');
  expect(rest?.children).toEqual([]);
  await band.unmount();
});

test('a PR GitHub links no issue to (non-default base) reads its Closes #N issues with one more request', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on);
  st.linked = false;
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  expect(tally.gql).toBe(1);
  expect(tally.issues).toBe(1);
  const band = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  expect(await band.find({ type: 'Text', text: /^● #7 running Theme toggle/ })).toBeDefined();
  expect(await band.find({ type: 'Text', text: /^PR #10 .+ · Spec #12$/ })).toBeDefined();
  await band.unmount();
});

// The card header reads the same for a Draft and a Ready PR, in either language: no state word, no percent;
// ticket status words stay English.
for (const lang of ['en', 'zh'] as const) {
  for (const isDraft of [true, false]) {
    test(`card header: no Draft / Ready, no %, English status words (${lang}, draft ${isDraft})`, { options: { language: lang } }, async ($, on) => {
      const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
      wire(on);
      engineLines(on);
      PR.isDraft = isDraft;
      try {
        await $.session.start({ cwd: '/tmp/x' } as never);
        await clock.settle();
        const band = await mountBand($);
        const lines = (await band.findAll({ type: 'Text' })).map(x => x.text ?? '');
        const head = lines.filter(l => /^(PR #10 .+ Tickets|◐ \d+ running)/.test(l));
        expect(head).toHaveLength(2);
        expect(head.join('\n')).not.toMatch(/Draft|Ready|%/);
        expect(lines).toContain('● #7 running Theme toggle · feat/7-theme-toggle · ' + (lang === 'zh' ? '还差 2 个提交' : '2 commits behind'));
        await band.unmount();
      } finally {
        PR.isDraft = false;
      }
    });
  }
}

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

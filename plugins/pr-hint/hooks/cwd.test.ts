// Tests that a PR read in one directory is never drawn or refreshed from another (render, 20s and 5 min ticks, a failing cwd read), and the no-PR agents-pill rewrite.
import { expect, mock, test } from 'claude-code/testing';
import { BAND_PROPS, PROPS, VIEWPORT, st, tally, wire } from './testkit';

type Dollar = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0];
const mountHint = ($: Dollar, hint = PROPS.hint) => $.ui.mount({
  plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: { ...PROPS, hint }, viewport: VIEWPORT,
});
const mountBand = ($: Dollar) => $.ui.mount({
  plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS,
});
const engineLines = (on: Parameters<typeof wire>[0]) => {
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Text', children: ['engine band'] }) as never);
  on('ui.render', { component: 'PromptHint' }, async (_$, e) => ({ type: 'Text', children: [e.props.hint] }) as never);
};

test('a PR read in directory A is not drawn once the session is in B (no PR there)', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on, undefined, '/tmp/a');
  st.dir = '/tmp/a';
  engineLines(on);
  await $.session.start({ cwd: '/tmp/a' } as never);
  await clock.settle();
  const ui = await mountHint($);
  const band = await mountBand($);
  expect(await ui.find({ type: 'Text', text: /^PR #10$/ })).toBeDefined();

  // /clear or cd: no session.start, no timer yet; the next draw already drops the old PR.
  st.dir = '/tmp/b';
  await ui.unmount();
  await band.unmount();
  const prBefore = tally.pr;
  // The card alone only hides: it does not ask for a refresh.
  const band2 = await mountBand($);
  expect(await band2.find({ type: 'Text', text: /engine band/ })).toBeDefined();
  expect(JSON.stringify(await band2.drawn())).not.toContain('pr-hint-card');
  await clock.settle();
  expect(tally.pr).toBe(prBefore);
  // The hint row asks for one full refresh, which reads no PR in B and clears the atom.
  const ui2 = await mountHint($);
  expect(JSON.stringify(await ui2.drawn())).not.toContain('PR #');
  expect(await ui2.find({ type: 'Text', text: /bypass permissions/ })).toBeDefined();
  await clock.settle();
  expect(tally.pr).toBe(prBefore + 1);
  expect(JSON.stringify(await ui2.drawn())).not.toContain('PR #');
  await ui2.unmount();
  await band2.unmount();
});

// A tick in another directory must drop the cache itself: back in A afterwards, the old PR is gone
// (a tick that kept it, or recomputed from it, would leave A's PR in the atom for A to draw again).
for (const [name, ms] of [['20s git', 20_000], ['5 min issues', 300_000]] as const) {
  test(`the ${name} tick in another directory drops the cache instead of reusing it`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    wire(on, undefined, '/tmp/a');
    st.dir = '/tmp/a';
    engineLines(on);
    await $.session.start({ cwd: '/tmp/a' } as never);
    await clock.settle();
    const ui = await mountHint($);
    expect(await ui.find({ type: 'Text', text: /^PR #10$/ })).toBeDefined();
    await ui.unmount();

    st.dir = '/tmp/b';
    const issuesBefore = tally.issue;
    st.refs = 'refs/heads/dev aaa\nrefs/heads/other bbb\n';
    await clock.advance(ms);
    // Not recomputed from A's cache: no issue calls for B.
    expect(tally.issue).toBe(issuesBefore);
    st.dir = '/tmp/a';
    const ui2 = await mountHint($);
    expect(await ui2.find({ type: 'Button', key: 'pin' })).toBeUndefined();
    expect(JSON.stringify(await ui2.drawn())).not.toContain('PR #');
    await ui2.unmount();
  });
}

test('a failing cwd read draws nothing and does not throw from the render', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  st.cwdFails = true;
  const ui = await mountHint($);
  const band = await mountBand($);
  expect(await ui.find({ type: 'Button', key: 'pin' })).toBeUndefined();
  expect(await ui.find({ type: 'Text', text: /bypass permissions/ })).toBeDefined();
  expect(await band.find({ type: 'Text', text: /engine band/ })).toBeDefined();
  await ui.unmount();
  await band.unmount();
});

test('without a PR the agents pill is still hidden; a hint without it is passed through', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  // gh answers only in a directory the session is never in: no PR.
  wire(on, undefined, '/nowhere');
  engineLines(on);
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const ui = await mountHint($, '▸▸ bypass permissions on · ← 3 agents');
  expect(JSON.stringify(await ui.drawn())).not.toContain('← 3 agents');
  expect(await ui.find({ type: 'Text', text: /bypass permissions on/ })).toBeDefined();
  await ui.unmount();
  const plain = await mountHint($);
  expect(await plain.find({ type: 'Text', text: /^▸▸ bypass permissions on$/ })).toBeDefined();
  await plain.unmount();
});

// Tests that a PR read in one place (directory, branch) is never drawn or refreshed from another (render, the 20s git and 5 min gh ticks, a failing cwd read), and the no-PR agents-pill rewrite.
import { expect, mock, test } from 'claude-code/testing';
import { engineLines, mountBand, mountHint, st, tally, wire } from './testkit';

test('a PR read in directory A is not drawn once the session is in B (no PR there)', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on, '/tmp/a');
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
  const prBefore = tally.gql;
  // The card alone only hides: it does not ask for a refresh.
  const band2 = await mountBand($);
  expect(await band2.find({ type: 'Text', text: /engine band/ })).toBeDefined();
  expect(JSON.stringify(await band2.drawn())).not.toContain('pr-hint-card');
  await clock.settle();
  expect(tally.gql).toBe(prBefore);
  // The hint row asks for one full refresh, which reads no PR in B and clears the atom.
  const ui2 = await mountHint($);
  expect(JSON.stringify(await ui2.drawn())).not.toContain('PR #');
  expect(await ui2.find({ type: 'Text', text: /bypass permissions/ })).toBeDefined();
  await clock.settle();
  expect(tally.gql).toBe(prBefore + 1);
  expect(JSON.stringify(await ui2.drawn())).not.toContain('PR #');
  await ui2.unmount();
  await band2.unmount();
});

// A tick in another directory must drop the cache itself: back in A afterwards, the old PR is gone
// (a tick that kept it, or recomputed from it, would leave A's PR in the atom for A to draw again).
for (const [name, ms] of [['20s git', 20_000], ['5 min gh', 300_000]] as const) {
  test(`the ${name} tick in another directory drops the cache instead of reusing it`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
    wire(on, '/tmp/a');
    st.dir = '/tmp/a';
    engineLines(on);
    await $.session.start({ cwd: '/tmp/a' } as never);
    await clock.settle();
    const ui = await mountHint($);
    expect(await ui.find({ type: 'Text', text: /^PR #10$/ })).toBeDefined();
    await ui.unmount();

    st.dir = '/tmp/b';
    st.refs = 'refs/heads/dev aaa\nrefs/heads/other bbb\n';
    const branchBefore = tally.branch;
    await clock.advance(ms);
    // Not recomputed from A's cache: no status recompute (git `branch` listing) for B.
    expect(tally.branch).toBe(branchBefore);
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
  wire(on, '/nowhere');
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

test('a branch switch in the same directory drops the old PR at the next 20s tick and runs a full fetch', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on);
  st.branch = 'feat/a';
  st.ghBranch = 'feat/a';
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const ui = await mountHint($);
  expect(await ui.find({ type: 'Text', text: /^PR #10$/ })).toBeDefined();
  await ui.unmount();

  st.branch = 'feat/b';
  const before = tally.gql;
  await clock.advance(20_000);
  await clock.settle();
  expect(tally.gql).toBe(before + 1);
  const ui2 = await mountHint($);
  expect(JSON.stringify(await ui2.drawn())).not.toContain('PR #');
  await ui2.unmount();
});

test('the same branch costs no extra fetch at the 20s tick', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineLines(on);
  st.branch = 'feat/a';
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const before = tally.gql;
  await clock.advance(20_000);
  await clock.settle();
  expect(tally.gql).toBe(before);
  const ui = await mountHint($);
  expect(await ui.find({ type: 'Text', text: /^PR #10$/ })).toBeDefined();
  await ui.unmount();
});

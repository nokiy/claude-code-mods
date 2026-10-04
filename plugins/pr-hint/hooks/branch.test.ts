// Tests that a PR read on one branch is dropped by the 20s local tick once the checkout moves to another, with a full refresh, and that the same branch costs no extra fetch.
import { expect, mock, test } from 'claude-code/testing';
import { PROPS, VIEWPORT, st, tally, wire } from './testkit';

type Dollar = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0];
const mountHint = ($: Dollar) => $.ui.mount({
  plugin: 'pr-hint', surface: 'terminal', component: 'PromptHint', props: PROPS, viewport: VIEWPORT,
});

const engineHint = (on: Parameters<typeof wire>[0]) => {
  on('ui.render', { component: 'PromptHint' }, async (_$, e) => ({ type: 'Text', children: [e.props.hint] }) as never);
};

test('a branch switch in the same directory drops the old PR at the next 20s tick and runs a full fetch', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-01-10T11:00:00Z') });
  wire(on);
  engineHint(on);
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
  engineHint(on);
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

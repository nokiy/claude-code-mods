// Tests the card's ↻ refresh button: a press runs a full fetch (waiting out a busy refresh) and always toasts what changed.
import { expect, mock, test } from 'claude-code/testing';
import { BAND_PROPS, ISSUE, PR, mountBand, st, tally, wire } from './testkit';
import type { Dollar } from './testkit';

const NOW = Date.parse('2026-01-10T11:00:00Z');

async function setup($: Dollar, on: Parameters<typeof wire>[0]) {
  const clock = mock.clock(on, { now: NOW });
  wire(on);
  const toasts: string[] = [];
  on('ui.toast', async (_$, e, next) => {
    toasts.push(e.text);
    return next(e);
  });
  await $.session.start({ cwd: '/tmp/x' } as never);
  await clock.settle();
  const band = await $.ui.mount({ plugin: 'pr-hint', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS });
  return { clock, band, toasts };
}

test('↻ refresh is on the card header row; a press runs a full fetch and toasts the change, then "up to date"', async ($, on) => {
  const { clock, band, toasts } = await setup($, on);
  const btn = await band.find({ type: 'Button', key: 'refresh' });
  expect(btn?.props.label).toBe(' ↻ refresh ');
  expect(btn?.props.plain).toBe(true);

  const before = tally.gql;
  PR.state = 'MERGED';
  try {
    await band.press({ key: 'refresh' });
    await clock.settle();
  } finally {
    PR.state = 'OPEN';
  }
  expect(tally.gql).toBe(before + 1);
  expect(toasts).toEqual(['PR #10 updated: Ready → Merged']);

  // A ticket closing is not a PR change: the toast reads only the PR state (here back to the fixture's Ready).
  st.issue7 = { ...ISSUE, state: 'CLOSED' };
  await band.press({ key: 'refresh' });
  await clock.settle();
  await band.press({ key: 'refresh' });
  await clock.settle();
  expect(toasts).toEqual([toasts[0], 'PR #10 updated: Merged → Ready', 'PR #10 is up to date']);
  // The footer shows the fetch time and nothing else.
  expect((await band.findAll({ type: 'Text' })).some(x => /^Open PR · fetched just now$/.test(x.text ?? ''))).toBe(true);
  expect((await band.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe(' ↻ refresh ');
  await band.unmount();
});

test('a failed fetch keeps the data and the old fetch time, and the toast says it failed, not "no open PR"', async ($, on) => {
  const { clock, band, toasts } = await setup($, on);
  // A fresh mount each time: the footer's age is computed at draw time.
  const footer = async () => {
    const b = await mountBand($);
    const text = (await b.findAll({ type: 'Text' })).map(x => x.text ?? '').find(x => x.startsWith('Open PR'));
    await b.unmount();
    return text;
  };
  expect(await footer()).toBe('Open PR · fetched just now');
  await clock.advance(120_000);
  expect(await footer()).toBe('Open PR · fetched 2 min ago');

  st.ghFails = true;
  await band.press({ key: 'refresh' });
  await clock.settle();
  expect(toasts).toEqual(['Fetch failed, try again later']);
  // The PR is still drawn and its fetch time did not move.
  expect(await footer()).toBe('Open PR · fetched 2 min ago');
  expect(await band.find({ type: 'Text', text: /^PR #10 / })).toBeDefined();
  // The 5 min tick fails the same way and leaves the data alone too.
  await clock.advance(300_000);
  expect(await band.find({ type: 'Text', text: /^PR #10 / })).toBeDefined();

  // A good answer works again.
  st.ghFails = false;
  await band.press({ key: 'refresh' });
  await clock.settle();
  expect(toasts.at(-1)).toBe('PR #10 is up to date');
  await band.unmount();
});

test('a PR that is gone (closed unmerged) toasts that the branch has no PR', async ($, on) => {
  const { clock, band, toasts } = await setup($, on);
  PR.state = 'CLOSED';
  try {
    await band.press({ key: 'refresh' });
    await clock.settle();
  } finally {
    PR.state = 'OPEN';
  }
  expect(toasts).toEqual(['No PR on this branch']);
  await band.unmount();
});

test('while a full fetch is in flight the press joins it (one gh request), shows refreshing…, ignores a second press', async ($, on) => {
  const { clock, band, toasts } = await setup($, on);
  let release = () => {};
  st.gate = new Promise<void>(r => (release = r));
  // The 5 min tick starts a refresh that hangs on gh.
  await clock.advance(300_000);
  PR.isDraft = true;
  const first = band.press({ key: 'refresh' });
  await clock.settle();
  expect((await band.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe(' refreshing… ');
  const second = band.press({ key: 'refresh' });
  await clock.settle();
  expect(toasts).toEqual([]);

  release();
  try {
    await first;
    await second;
    await clock.settle();
  } finally {
    PR.isDraft = false;
  }
  expect(toasts).toEqual(['PR #10 updated: Ready → Draft']);
  // The start-up fetch and the one the press joined: no third request was queued.
  expect(tally.gql).toBe(2);
  expect((await band.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe(' ↻ refresh ');
  await band.unmount();
});

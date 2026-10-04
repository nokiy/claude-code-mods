// Tests the card's ↻ button: a press runs a full fetch (waiting out a busy refresh) and always toasts what changed.
import { expect, mock, test } from 'claude-code/testing';
import { BAND_PROPS, ISSUE, PR, st, tally, wire } from './testkit';

const NOW = Date.parse('2026-01-10T11:00:00Z');

type Dollar = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0];

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

test('↻ is on the card header row; a press runs a full fetch and toasts the change, then "up to date"', async ($, on) => {
  const { clock, band, toasts } = await setup($, on);
  const btn = await band.find({ type: 'Button', key: 'refresh' });
  expect(btn?.props.label).toBe('↻');
  expect(btn?.props.plain).toBe(true);

  st.issue7 = { ...ISSUE, state: 'CLOSED' };
  const before = tally.pr;
  await band.press({ key: 'refresh' });
  await clock.settle();
  expect(tally.pr).toBe(before + 1);
  expect(toasts).toEqual(['PR #10 updated: merged 0/1 → 1/1 · accepted 0/1 → 1/1']);

  await band.press({ key: 'refresh' });
  await clock.settle();
  expect(toasts).toEqual([toasts[0], 'PR #10 is up to date']);
  // The footer shows the fetch time, not just GitHub's update time.
  expect((await band.findAll({ type: 'Text' })).some(x => /refreshed just now$/.test(x.text ?? ''))).toBe(true);
  expect((await band.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe('↻');
  await band.unmount();
});

test('a PR that is gone toasts that no PR is open', async ($, on) => {
  const { clock, band, toasts } = await setup($, on);
  PR.state = 'MERGED';
  try {
    await band.press({ key: 'refresh' });
    await clock.settle();
  } finally {
    PR.state = 'OPEN';
  }
  expect(toasts).toEqual(['No open PR on this branch']);
  await band.unmount();
});

test('while another refresh is busy the press waits for the queued full one, shows refreshing…, ignores a second press', async ($, on) => {
  const { clock, band, toasts } = await setup($, on);
  let release = () => {};
  st.gate = new Promise<void>(r => (release = r));
  // The 60 s tick starts a PR refresh that hangs on gh.
  await clock.advance(60_000);
  st.issue7 = { ...ISSUE, state: 'CLOSED' };
  const first = band.press({ key: 'refresh' });
  await clock.settle();
  expect((await band.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe('refreshing…');
  const second = band.press({ key: 'refresh' });
  await clock.settle();
  expect(toasts).toEqual([]);

  release();
  await first;
  await second;
  await clock.settle();
  expect(toasts).toEqual(['PR #10 updated: merged 0/1 → 1/1 · accepted 0/1 → 1/1']);
  expect((await band.find({ type: 'Button', key: 'refresh' }))?.props.label).toBe('↻');
  await band.unmount();
});

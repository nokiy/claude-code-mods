// A click on a ref and the card above the prompt.
import { expect, test } from 'claude-code/testing';
import { REPO, href, mountBand, mountBlock, prJson, st, tally, wire } from './testkit';
import type { Dollar } from './testkit';

const texts = async (band: Awaited<ReturnType<typeof mountBand>>) => (await band.findAll({ type: 'Text' })).map(x => x.text ?? '');

async function ready($: Dollar, clock: ReturnType<typeof wire>, text = 'PR #52 和 PR #53') {
  st.issues[`${REPO}#53`] = prJson(53, { state: 'closed', pull_request: { merged_at: '2026-11-06T04:00:00Z' } });
  const ui = await mountBlock($, { text });
  await clock.settle();
  return { ui, band: await mountBand($) };
}

const press = (ui: Awaited<ReturnType<typeof mountBlock>>, n: number) => ui.press({ key: 'reply', link: { href: href(n) } });

test('the band is the engine\'s alone until a ref is pressed', async ($, on) => {
  const { band } = await ready($, wire(on));
  expect(await texts(band)).toEqual(['engine band']);
});

test('a click opens the card with the engine band still under it', async ($, on) => {
  const clock = wire(on);
  const { ui, band } = await ready($, clock);
  await press(ui, 52);
  await clock.settle();
  const lines = await texts(band);
  expect(lines).toContain('PR #52 积分兑换 · 待验收');
  expect(lines).toContain('o/r');
  expect(lines).toContain('用户能用积分兑换商品');
  expect(lines).toContain('做完后的变化');
  expect(lines).toContain('· 商品页新增兑换按钮');
  expect(lines[lines.length - 1]).toBe('engine band');
});

test('the card carries no file counts and no link to the PR', async ($, on) => {
  const clock = wire(on);
  const { ui, band } = await ready($, clock);
  await press(ui, 52);
  await clock.settle();
  const tree = JSON.stringify(await band.drawn());
  expect(tree).not.toMatch(/"Link"|打开 PR|Open PR|\+\d+|文件/);
});

test('the same ref closes it, another ref switches it', async ($, on) => {
  const clock = wire(on);
  const { ui, band } = await ready($, clock);
  await press(ui, 52);
  await press(ui, 53);
  await clock.settle();
  expect((await texts(band)).some(l => l.startsWith('PR #53') && l.endsWith('· 已合并'))).toBe(true);
  expect((await texts(band)).some(l => l.startsWith('PR #52'))).toBe(false);

  await press(ui, 53);
  await clock.settle();
  expect(await texts(band)).toEqual(['engine band']);
});

test('the close button closes it, the band staying', async ($, on) => {
  const clock = wire(on);
  const { ui, band } = await ready($, clock);
  await press(ui, 52);
  await clock.settle();
  await band.press({ key: 'close' });
  await clock.settle();
  expect(await texts(band)).toEqual(['engine band']);
});

test('without a summary the card keeps the title and says so', async ($, on) => {
  const clock = wire(on);
  st.modelReply = null;
  const { ui, band } = await ready($, clock, 'PR #52');
  await press(ui, 52);
  await clock.settle();
  const lines = await texts(band);
  expect(lines).toContain('PR #52 第 52 号原标题 · 待验收');
  expect(lines).toContain('暂无说明');
  expect(lines).not.toContain('做完后的变化');
});

test('an open card redraws when the summary lands', async ($, on) => {
  const clock = wire(on);
  let open = () => {};
  st.modelGate = new Promise(r => { open = r; });
  const { ui, band } = await ready($, clock, 'PR #52');
  await press(ui, 52);
  await clock.settle();
  expect(await texts(band)).toContain('生成中…');
  expect(await texts(band)).not.toContain('暂无说明');
  open();
  await clock.settle();
  expect(await texts(band)).toContain('用户能用积分兑换商品');
});

test('an open card waits through the retry, and says so only once generation has failed', async ($, on) => {
  const clock = wire(on);
  let open = () => {};
  st.modelGate = new Promise(r => { open = r; });
  st.modelReply = null;
  const { ui, band } = await ready($, clock, 'PR #52');
  await press(ui, 52);
  await clock.settle();
  expect(await texts(band)).toContain('生成中…');
  open();
  await clock.settle();
  expect(tally.model).toBe(2);
  expect(await texts(band)).toContain('暂无说明');
  expect(await texts(band)).not.toContain('生成中…');
});

test('a survey holds the band: the card yields to it', async ($, on) => {
  const clock = wire(on);
  const { ui } = await ready($, clock);
  await press(ui, 52);
  await clock.settle();
  const band = await $.ui.mount({ plugin: 'ref-peek', surface: 'terminal', component: 'AbovePrompt', requestId: 'survey', props: { hasSurvey: true, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 19 }, view: {} } } as never);
  expect(await texts(band)).toEqual(['engine band']);
});

test('a press on anything but a ref of ours is no card', async ($, on) => {
  const clock = wire(on);
  const { ui, band } = await ready($, clock);
  await ui.press({ key: 'reply', link: { href: 'https://example.test/x' } });
  await clock.settle();
  expect(await texts(band)).toEqual(['engine band']);
});

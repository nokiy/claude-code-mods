// A click on a ref and the bubble over the reply.
import { expect, test } from 'claude-code/testing';
import { FULLSCREEN, REPO, href, mountBlock, prJson, shown, st, tally, wire } from './testkit';
import type { Dollar } from './testkit';

type Block = Awaited<ReturnType<typeof mountBlock>>;

const texts = async (ui: Block) => (await ui.findAll({ type: 'Text' })).map(x => x.text ?? '').filter(x => x !== '⏺');
const press = (ui: Block, n: number, key = 'reply') => ui.press({ key, link: { href: href(n) } });
const tree = async (ui: Block) => JSON.stringify(await ui.drawn());
const isOpen = async (ui: Block) => (await tree(ui)).includes('"position":"absolute"');

async function ready($: Dollar, clock: ReturnType<typeof wire>, text = 'PR #52 和 PR #53', id = 'm1') {
  st.issues[`${REPO}#53`] = prJson(53, { state: 'closed', pull_request: { merged_at: '2026-11-06T04:00:00Z' } });
  const ui = await mountBlock($, { text, id });
  await clock.settle();
  return ui;
}

test('the reply is one Markdown and no bubble until a ref is pressed', async ($, on) => {
  const ui = await ready($, wire(on));
  expect(await isOpen(ui)).toBe(false);
  expect((await ui.findAll({ type: 'Markdown' } as never)).length).toBe(1);
});

test('a click opens the bubble inside the block, filled so the reply does not show through', async ($, on) => {
  const clock = wire(on);
  const ui = await ready($, clock);
  await press(ui, 52);
  await clock.settle();
  const lines = await texts(ui);
  expect(lines).toContain('PR #52 积分兑换 · 待验收');
  expect(lines).toContain('o/r');
  expect(lines).toContain('用户能用积分兑换商品');
  expect(lines).toContain('做完后的变化');
  expect(lines).toContain('· 商品页新增兑换按钮');
  expect(await tree(ui)).toContain('"backgroundColor":"userMessageBackground"');
});

test('the bubble carries no file counts and no link to the PR', async ($, on) => {
  const clock = wire(on);
  const ui = await ready($, clock);
  await press(ui, 52);
  await clock.settle();
  expect(await tree(ui)).not.toMatch(/"Link"|打开 PR|Open PR|\+\d+|文件/);
});

test('an open bubble cuts the block after the ref\'s unit and stands on its first part, the rest under it', async ($, on) => {
  const clock = wire(on);
  const ui = await ready($, clock, '甲 PR #52\n\n乙段');
  await press(ui, 52);
  await clock.settle();
  const parts = await ui.findAll({ type: 'Markdown' } as never) as Array<{ props?: { text?: string } }>;
  expect(parts.length).toBe(2);
  expect(parts[0]?.props?.text?.endsWith('）')).toBe(true);
  expect(parts[1]?.props?.text).toBe('乙段');
  expect(await tree(ui)).toContain('"bottom":1');
  expect(await tree(ui)).toContain('"marginTop":1');
});

test('a ref in the tail stays pressable', async ($, on) => {
  const clock = wire(on);
  const ui = await ready($, clock, '甲 PR #52\n\n乙 PR #53');
  await press(ui, 52);
  await clock.settle();
  await press(ui, 53, 'reply-tail');
  await clock.settle();
  expect((await texts(ui)).some(l => l.startsWith('PR #53'))).toBe(true);
});

test('with too few rows shown above, the bubble goes below, drawn after the tail so it stays on top', async ($, on) => {
  const clock = wire(on);
  const text = `${'段落\n\n'.repeat(20)}甲 PR #52\n\n${'段落\n\n'.repeat(20)}`.trim();
  st.issues[`${REPO}#53`] = prJson(53);
  const ui = await mountBlock($, { text, props: { onScreen: { first: 38, last: 70, of: 90 } } });
  await clock.settle();
  await press(ui, 52);
  await clock.settle();
  const drawn = await tree(ui);
  expect(drawn).toContain('"top":-1');
  expect(drawn.indexOf('"position":"absolute"')).toBeGreaterThan(drawn.indexOf('"reply-tail"'));
});

test('the same ref closes it, another ref switches it', async ($, on) => {
  const clock = wire(on);
  const ui = await ready($, clock);
  await press(ui, 52);
  await press(ui, 53);
  await clock.settle();
  expect((await texts(ui)).some(l => l.startsWith('PR #53') && l.endsWith('· 已合并'))).toBe(true);
  expect((await texts(ui)).some(l => l.startsWith('PR #52'))).toBe(false);

  await press(ui, 53);
  await clock.settle();
  expect(await isOpen(ui)).toBe(false);
});

test('a ref in another block moves the bubble there', async ($, on) => {
  const clock = wire(on);
  const one = await ready($, clock, 'PR #52', 'm1');
  const two = await ready($, clock, 'PR #52', 'm2');
  await press(one, 52);
  await clock.settle();
  expect([await isOpen(one), await isOpen(two)]).toEqual([true, false]);
  await press(two, 52);
  await clock.settle();
  expect([await isOpen(one), await isOpen(two)]).toEqual([false, true]);
});

test('the close button closes it', async ($, on) => {
  const clock = wire(on);
  const ui = await ready($, clock);
  await press(ui, 52);
  await clock.settle();
  await ui.press({ key: 'close' });
  await clock.settle();
  expect(await isOpen(ui)).toBe(false);
  expect((await ui.findAll({ type: 'Markdown' } as never)).length).toBe(1);
});

test('without a summary the bubble keeps the title and says so', async ($, on) => {
  const clock = wire(on);
  st.modelReply = null;
  const ui = await ready($, clock, 'PR #52');
  await press(ui, 52);
  await clock.settle();
  const lines = await texts(ui);
  expect(lines).toContain('PR #52 第 52 号原标题 · 待验收');
  expect(lines).toContain('暂无说明');
  expect(lines).not.toContain('做完后的变化');
});

test('an open bubble redraws when the summary lands', async ($, on) => {
  const clock = wire(on);
  let open = () => {};
  st.modelGate = new Promise(r => { open = r; });
  const ui = await ready($, clock, 'PR #52');
  await press(ui, 52);
  await clock.settle();
  expect(await texts(ui)).toContain('生成中…');
  expect(await texts(ui)).not.toContain('暂无说明');
  open();
  await clock.settle();
  expect(await texts(ui)).toContain('用户能用积分兑换商品');
});

test('an open bubble waits through the retry, and says so only once generation has failed', async ($, on) => {
  const clock = wire(on);
  let open = () => {};
  st.modelGate = new Promise(r => { open = r; });
  st.modelReply = null;
  const ui = await ready($, clock, 'PR #52');
  await press(ui, 52);
  await clock.settle();
  expect(await texts(ui)).toContain('生成中…');
  open();
  await clock.settle();
  expect(tally.model).toBe(2);
  expect(await texts(ui)).toContain('暂无说明');
  expect(await texts(ui)).not.toContain('生成中…');
});

test('a press on anything but a ref of ours opens nothing', async ($, on) => {
  const clock = wire(on);
  const ui = await ready($, clock);
  await ui.press({ key: 'reply', link: { href: 'https://example.test/x' } });
  await clock.settle();
  expect(await isOpen(ui)).toBe(false);
});

test('the desktop and a terminal without clicks have no bubble and no press', async ($, on) => {
  const clock = wire(on);
  const ui = await mountBlock($, { text: 'PR #52', viewport: { ...FULLSCREEN, isFullscreen: false } });
  await clock.settle();
  expect(await ui.find({ type: 'Markdown' } as never)).toBeUndefined();
  expect(await shown(ui)).toContain('PR #52');
});

const ticketOf = (n: number) => ({ number: n, title: `[x] 第 ${n} 号票`, labels: { nodes: [] }, repository: { nameWithOwner: REPO } });
const prOf = (n: number) => ({ number: n, title: `feat: 第 ${n} 号 PR`, repository: { nameWithOwner: REPO } });

async function related($: Dollar, clock: ReturnType<typeof wire>) {
  st.issues[`${REPO}#59`] = prJson(59, { pull_request: undefined, relations: { totalCount: 1, nodes: [prOf(52)] } });
  st.issues[`${REPO}#52`] = prJson(52, { relations: { totalCount: 1, nodes: [ticketOf(59)] } });
  const ui = await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  await press(ui, 52);
  await clock.settle();
  return ui;
}

test('a PR\'s bubble lists its ticket, plain and titled', async ($, on) => {
  const ui = await related($, wire(on));
  const row = await ui.find({ key: `related-${REPO}#59` } as never) as { props?: { label?: string; plain?: boolean } } | undefined;
  expect(row?.props?.label).toBe('关联 Ticket #59 第 59 号票');
  expect(row?.props?.plain).toBe(true);
});

test('a row switches the bubble in place, fetching a ref nothing knows, and the ticket lists its PR', async ($, on) => {
  const clock = wire(on);
  const ui = await related($, clock);
  const before = tally.gh;
  await ui.press({ key: `related-${REPO}#59` });
  await clock.settle();
  expect(tally.gh).toBe(before + 1);
  expect((await texts(ui)).some(l => l.startsWith('Ticket #59'))).toBe(true);
  const back = await ui.find({ key: `related-${REPO}#52` } as never) as { props?: { label?: string } } | undefined;
  expect(back?.props?.label).toBe('所属 PR #52 第 52 号 PR');
});

test('a press on the anchor closes the bubble even after a row switched it', async ($, on) => {
  const clock = wire(on);
  const ui = await related($, clock);
  await ui.press({ key: `related-${REPO}#59` });
  await clock.settle();
  await press(ui, 52);
  await clock.settle();
  expect(await isOpen(ui)).toBe(false);
});

test('a row to a number GitHub does not know says it has no summary', async ($, on) => {
  const clock = wire(on);
  st.issues[`${REPO}#52`] = prJson(52, { relations: { totalCount: 1, nodes: [ticketOf(404)] } });
  const ui = await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  await press(ui, 52);
  await clock.settle();
  await ui.press({ key: `related-${REPO}#404` });
  await clock.settle();
  expect(await texts(ui)).toContain('#404');
  expect(await texts(ui)).toContain('暂无说明');
});

test('rows past four are counted, and none shows the model was asked for them', async ($, on) => {
  const clock = wire(on);
  st.issues[`${REPO}#52`] = prJson(52, { relations: { totalCount: 6, nodes: [1, 2, 3, 4].map(ticketOf) } });
  const ui = await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  await press(ui, 52);
  await clock.settle();
  expect(await texts(ui)).toContain('还有 2 个');
  expect(tally.model).toBe(1);
});

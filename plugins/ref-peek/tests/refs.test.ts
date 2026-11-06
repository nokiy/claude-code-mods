// Recognition and annotation of the numbers a reply mentions.
import { expect, test } from 'claude-code/testing';
import { annotate, findRefs } from '../hooks/refs';
import type { Lookup } from '../hooks/refs';

const found = (text: string) => findRefs(text).map(t => t.text);
const known: Lookup = t => ({ href: `https://github.com/o/r/pull/${t.number}`, gloss: '一句话' });
const link = (label: string, n = 52) => `[${label}](https://github.com/o/r/pull/${n})`;

test('every written form is recognised', () => {
  expect(found('PR #1, Ticket #2, Spec #3, Issue #4 and #5')).toEqual(['PR #1', 'Ticket #2', 'Spec #3', 'Issue #4', '#5']);
});

test('a number works next to Chinese text and punctuation', () => {
  expect(found('见#12的说明，修复了 #13。')).toEqual(['#12', '#13']);
});

test('fenced code, inline code and existing links are skipped', () => {
  const text = [
    'PR #1',
    '```',
    'PR #2',
    '```',
    '~~~sh',
    'gh pr view #3',
    '~~~',
    '`PR #4` and ``PR #5``',
    '[PR #6](https://x.test/6) ![#7](https://x.test/7.png) [PR #8][ref]',
    'PR #9',
  ].join('\n');
  expect(found(text)).toEqual(['PR #1', 'PR #9']);
});

test('an unclosed fence runs to the end of the block', () => {
  expect(found('PR #1\n```\nPR #2')).toEqual(['PR #1']);
});

test('an indented block after a blank line is code', () => {
  expect(found('说明\n\n    PR #1\n    PR #2\n\n    PR #3\n\nPR #4')).toEqual(['PR #4']);
  expect(found('    PR #1')).toEqual([]);
  expect(found('说明\n\n\tPR #1')).toEqual([]);
});

test('an indented line inside a list item or a paragraph is no code', () => {
  expect(found('- 第一条\n\n    PR #1')).toEqual(['PR #1']);
  expect(found('1. 第一条\n    PR #1')).toEqual(['PR #1']);
  expect(found('- 第一条\n\n  续行\n\n    PR #1')).toEqual(['PR #1']);
  expect(found('说明\n    PR #1')).toEqual(['PR #1']);
});

test('a paragraph after a blank line ends the list', () => {
  expect(found('- 第一条\n\n结束\n\n    PR #1')).toEqual([]);
});

test('things that only look like a number stay out', () => {
  for (const text of ['C#', 'C# 7', 'C#7', 'foo#12', 'https://x.test/y#12', 'www.x.test/#12', '&#39;', '# 12 heading', '###12', '#12a', '#1.2', '#0', 'a/b/c#1', 'o/r#12', '../up#1', 'fix_#12_login', '#12_old', 'foo_#12']) {
    expect(found(text)).toEqual([]);
  }
});

test('a heading keeps its marks and a number after them is a number', () => {
  expect(found('## #12 标题')).toEqual(['#12']);
});

test('the note follows the first mention and the link every mention', () => {
  const out = annotate('PR #52 可以验收了，PR #52 不用再改。', known);
  expect(out.text).toBe(`${link('PR #52')}（一句话）可以验收了，${link('PR #52')} 不用再改。`);
  expect(out.hrefs).toEqual(['https://github.com/o/r/pull/52']);
});

test('two spellings of one number count as one ref', () => {
  expect(annotate('PR #52 就是 #52', known).text).toBe(`${link('PR #52')}（一句话）就是 ${link('#52')}`);
});

test('a number already explained gets the link alone', () => {
  for (const after of ['（已有说明）', ' (note)', '(note)', '：积分兑换', ': note', ' ：积分兑换', '  （说明）', ' — 积分兑换', ' – 积分兑换']) {
    expect(annotate(`PR #52${after}`, known).text).toBe(`${link('PR #52')}${after}`);
  }
  expect(annotate('**PR #52**（说明）', known).text).toBe(`${link('PR #52')}（说明）`);
});

const NOTED = `${link('PR #52')}（一句话）`;

test('a plain hyphen explains nothing', () => {
  expect(annotate('#12 - #15', known).text).toBe(`${link('#12', 12)}（一句话）- ${link('#15', 15)}（一句话）`);
  expect(annotate('#12-15', known).text).toBe(`${link('#12', 12)}（一句话）-15`);
  expect(annotate('PR #52 -> main', known).text).toBe(`${NOTED}-> main`);
  expect(annotate('PR #52 - 积分兑换', known).text).toBe(`${NOTED}- 积分兑换`);
});

test('an emphasis span around an annotated ref loses its marks', () => {
  expect(annotate('**PR #52**已经', known).text).toBe(`${NOTED}已经`);
  expect(annotate('已**PR #52**已', known).text).toBe(`已${NOTED}已`);
  expect(annotate('**PR #52 已合并**', known).text).toBe(`${NOTED}已合并`);
  expect(annotate('**PR #52** 已经', known).text).toBe(`${NOTED}已经`);
  expect(annotate('*PR #52*已经', known).text).toBe(`${NOTED}已经`);
  expect(annotate('***PR #52***已经', known).text).toBe(`${NOTED}已经`);
});

test('a second mention in emphasis loses its marks too', () => {
  expect(annotate('PR #52 和 **PR #52**已经', known).text).toBe(`${NOTED}和 ${link('PR #52')}已经`);
});

test('nested emphasis and code inside the span do not keep the marks', () => {
  expect(annotate('**前面 *PR #52* 后面**已经', known).text).toBe(`前面 ${NOTED}后面已经`);
  expect(annotate('**`x` PR #52**已经', known).text).toBe(`\`x\` ${NOTED}已经`);
});

test('emphasis without an annotated ref stays', () => {
  expect(annotate('**注意** PR #52 **重要**', known).text).toBe(`**注意** ${NOTED}**重要**`);
  expect(annotate('**PR #52**已经', () => null).text).toBe('**PR #52**已经');
  expect(annotate('**`PR #52`**已经', known).text).toBe('**`PR #52`**已经');
});

test('marks that open nothing stay', () => {
  expect(annotate('snake_case PR #52 more_text', known).text).toBe(`snake_case ${NOTED}more_text`);
  expect(annotate('变量_a 和 PR #52 和 b_值', known).text).toBe(`变量_a 和 ${NOTED}和 b_值`);
  expect(annotate('2 * 3 PR #52 4 * 5', known).text).toBe(`2 * 3 ${NOTED}4 * 5`);
  expect(annotate('* PR #52\n* 下一条', known).text).toBe(`* ${NOTED}\n* 下一条`);
});

test('an underscore is no emphasis: a number inside it stays as written', () => {
  expect(annotate('__PR #52__', known)).toEqual({ text: '__PR #52__', hrefs: [] });
});

test('a list dash on the next line explains nothing', () => {
  expect(annotate('- PR #52\n- 下一条', known).text).toBe(`- ${NOTED}\n- 下一条`);
});

test('a later mention does not make up for one that was already explained', () => {
  expect(annotate('PR #52（说明）和 PR #52', known).text).toBe(`${link('PR #52')}（说明）和 ${link('PR #52')}`);
});

test('a table cell and a list item are annotated in place', () => {
  expect(annotate('| PR #52 | 通过 |\n| --- | --- |\n- PR #53', known).text)
    .toBe(`| ${link('PR #52')}（一句话） | 通过 |\n| --- | --- |\n- ${link('PR #53', 53)}（一句话）`);
});

test('code is left byte for byte', () => {
  const text = '```\nPR #52\n```\n`PR #52`';
  expect(annotate(text, known)).toEqual({ text, hrefs: [] });
});

test('a number with nothing known stays as written, link-free', () => {
  expect(annotate('PR #52 和 #53', () => null)).toEqual({ text: 'PR #52 和 #53', hrefs: [] });
});

test('an empty note leaves the link alone', () => {
  expect(annotate('PR #52', t => ({ ...known(t)!, gloss: '' })).text).toBe(link('PR #52'));
});

// Recognition and annotation of the numbers a reply mentions.
import { expect, test } from 'claude-code/testing';
import { annotate, findRefs } from '../hooks/refs';
import type { Lookup } from '../hooks/refs';

const found = (text: string) => findRefs(text).map(t => t.text);
const known: Lookup = t => ({ href: `https://github.com/${t.repo ?? 'o/r'}/pull/${t.number}`, gloss: '一句话' });
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

test('things that only look like a number stay out', () => {
  for (const text of ['C#', 'C# 7', 'C#7', 'foo#12', 'https://x.test/y#12', 'www.x.test/#12', '&#39;', '# 12 heading', '###12', '#12a', '#1.2', '#0', 'a/b/c#1']) {
    expect(found(text)).toEqual([]);
  }
});

test('a heading keeps its marks and a number after them is a number', () => {
  expect(found('## #12 标题')).toEqual(['#12']);
});

test('owner/repo#N names its own repository', () => {
  expect(findRefs('见 nokiy/claude-code-mods#12')[0]).toMatchObject({ number: 12, repo: 'nokiy/claude-code-mods' });
  expect(findRefs('PR #12')[0]?.repo).toBeNull();
});

test('a dotted path segment is no repository', () => {
  expect(findRefs('../up#1').some(t => t.repo !== null)).toBe(false);
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
  for (const after of ['（已有说明）', ' (note)', '(note)']) {
    expect(annotate(`PR #52${after}`, known).text).toBe(`${link('PR #52')}${after}`);
  }
  expect(annotate('**PR #52**（说明）', known).text).toBe(`**${link('PR #52')}**（说明）`);
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

// Where a repository is read from (remotes, Bash commands, the links ref-peek wrote), then which one a block's numbers belong to:
// the session's last repository, the cwd's origin.
import { expect, test } from 'claude-code/testing';
import { commandHint, hrefOf, parseHref, parseRemote } from '../hooks/repo';
import { linked, mountBlock, prJson, shown, st, tally, wire } from './testkit';

test('every GitHub remote spelling gives owner/repo', () => {
  for (const url of ['git@github.com:o/r.git', 'https://github.com/o/r.git', 'https://github.com/o/r', 'ssh://git@github.com/o/r.git\n']) {
    expect(parseRemote(url)).toBe('o/r');
  }
});

test('a remote elsewhere is no repository', () => {
  expect(parseRemote('git@gitlab.com:o/r.git')).toBeNull();
  expect(parseRemote('')).toBeNull();
});

test('a Bash command names a repository', () => {
  expect(commandHint('gh pr view 5 --repo o/r')).toEqual({ repo: 'o/r' });
  expect(commandHint('gh pr view 5 --repo=o/r --json title')).toEqual({ repo: 'o/r' });
  expect(commandHint('gh issue list -R o/r')).toEqual({ repo: 'o/r' });
  expect(commandHint('git clone https://github.com/o/r.git')).toEqual({ repo: 'o/r' });
  expect(commandHint('gh api repos/o/r/issues/5')).toEqual({ repo: 'o/r' });
});

test('a Bash command names a path to resolve', () => {
  expect(commandHint('git -C /work/app status')).toEqual({ path: '/work/app' });
  expect(commandHint('cd "/work/my app" && git status')).toEqual({ path: '/work/my app' });
  expect(commandHint("ls; cd '/work/app'")).toEqual({ path: '/work/app' });
  expect(commandHint('cd ../other')).toEqual({ path: '../other' });
});

test('a repository named outright beats a path in the same command', () => {
  expect(commandHint('cd /work/app && gh pr view 5 --repo o/r')).toEqual({ repo: 'o/r' });
});

test('a path the shell would still have to expand tells nothing', () => {
  expect(commandHint('cd $HOME/app')).toBeNull();
  expect(commandHint('cd -')).toBeNull();
});

test('a command about no repository tells nothing', () => {
  expect(commandHint('ls -la')).toBeNull();
  expect(commandHint('echo abcd/efgh')).toBeNull();
});

test('the link written for a ref reads back as that ref', () => {
  expect(parseHref(hrefOf({ repo: 'o/r', number: 52 }, true))).toEqual({ repo: 'o/r', number: 52 });
  expect(parseHref(hrefOf({ repo: 'o/r', number: 7 }, false))).toEqual({ repo: 'o/r', number: 7 });
  expect(hrefOf({ repo: 'o/r', number: 52 }, true)).toBe('https://github.com/o/r/pull/52');
  expect(hrefOf({ repo: 'o/r', number: 7 }, false)).toBe('https://github.com/o/r/issues/7');
});

test('any other link is no ref', () => {
  expect(parseHref('https://example.test/o/r/pull/52')).toBeNull();
});

const bash = (command: string) => ({ tool: 'Bash', command }) as never;

test('the cwd\'s origin is the last resort', async ($, on) => {
  const clock = wire(on);
  const ui = await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52']);
  expect(await shown(ui)).toContain(linked('PR #52', 52));
});

test('a directory with no GitHub origin leaves the text as written', async ($, on) => {
  const clock = wire(on);
  st.remotes = {};
  const ui = await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(await shown(ui)).toBe('PR #52');
  expect(tally.gh).toBe(0);
  expect(tally.git).toBe(1);
});

test('the repository a Bash call named beats the cwd', async ($, on) => {
  const clock = wire(on);
  st.issues['a/b#52'] = prJson(52);
  await $.tool.call(bash('gh pr view 52 --repo a/b'));
  await clock.settle();
  const ui = await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/a/b/issues/52']);
  expect(await shown(ui)).toContain(linked('PR #52', 52, 'a/b'));
});

test('a path in a Bash call resolves through its remote', async ($, on) => {
  const clock = wire(on);
  st.remotes['/work/other'] = 'https://github.com/c/d.git';
  st.issues['c/d#52'] = prJson(52);
  await $.tool.call(bash('git -C /work/other status'));
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/c/d/issues/52']);
});

test('a home path is expanded before git sees it', async ($, on) => {
  const clock = wire(on);
  st.remotes['/home/me/proj'] = 'git@github.com:c/d.git';
  st.issues['c/d#52'] = prJson(52);
  await $.tool.call(bash('cd ~/proj && git status'));
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/c/d/issues/52']);
});

test('a path outside any repository changes nothing', async ($, on) => {
  const clock = wire(on);
  await $.tool.call(bash('cd /tmp && ls'));
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52']);
});

test('a URL in the block does not move its numbers to that repository', async ($, on) => {
  const clock = wire(on);
  st.issues['a/b#52'] = prJson(52);
  st.issues['e/f#52'] = prJson(52);
  await $.tool.call(bash('gh pr view 1 --repo a/b'));
  await clock.settle();
  await mountBlock($, { text: 'https://github.com/e/f 的 PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/a/b/issues/52']);
});

test('o/r#N is no mention and moves nothing', async ($, on) => {
  const clock = wire(on);
  st.issues['e/f#52'] = prJson(52);
  const ui = await mountBlock($, { text: '见 e/f#52 和 PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52']);
  expect(await shown(ui)).toContain('见 e/f#52 和 ');
});

test('a block keeps the repository it was first drawn under', async ($, on) => {
  const clock = wire(on);
  st.issues['a/b#52'] = prJson(52, { title: '别的仓库' });
  const ui = await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  await $.tool.call(bash('gh pr view 1 --repo a/b'));
  await clock.settle();
  expect(await shown(ui)).toContain(linked('PR #52', 52));
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52']);
});

test('the same number in two repositories is two cache entries', async ($, on) => {
  const clock = wire(on);
  st.issues['a/b#52'] = prJson(52);
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  await $.tool.call(bash('gh pr view 1 --repo a/b'));
  await clock.settle();
  await mountBlock($, { text: 'PR #52', id: 'm2' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52', 'repos/a/b/issues/52']);
  expect(tally.model).toBe(2);
});

test('a Bash call goes on without waiting for any of this', async ($, on) => {
  const clock = wire(on);
  const answered = await $.tool.call(bash('git -C /work/other status'));
  expect(tally.git).toBe(0);
  expect(answered).toBeDefined();
  await clock.settle();
});

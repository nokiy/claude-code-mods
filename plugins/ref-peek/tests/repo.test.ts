// Where a repository is read from (remotes, Bash commands, the links ref-peek wrote), then which one a block's numbers belong to:
// the session's last repository, the cwd's origin.
import { expect, test } from 'claude-code/testing';
import { commandHint, hrefOf, parseHref, parseRemote, replCommands, shellCommands, stepHints } from '../hooks/repo';
import { bash, linked, mountBlock, prJson, repl, shown, st, step, tally, wire } from './testkit';

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

test('a Bash call runs its command; any other tool, or arguments of another shape, run none', () => {
  expect(shellCommands(bash('git status'))).toEqual(['git status']);
  expect(shellCommands({ name: 'Read', input: { file_path: '/x', command: 'git status' } })).toEqual([]);
  expect(shellCommands({ name: 'Bash', input: null })).toEqual([]);
  expect(shellCommands({ name: 'Bash', input: { command: 42 } })).toEqual([]);
  expect(shellCommands({ name: 'REPL', input: 'not an object' })).toEqual([]);
});

test('Code Mode\'s REPL code runs each literal shell command, in order', () => {
  expect(shellCommands(repl('await $`echo hi`.text()'))).toEqual(['echo hi']);
  expect(replCommands('const [a, b] = await Promise.all([\n  $`gh pr view 1 --repo a/b`.nothrow().text(),\n  $`git -C /w status`.text()\n])'))
    .toEqual(['gh pr view 1 --repo a/b', 'git -C /w status']);
  expect(replCommands('const t = await file(\'/abs/x\').text(); tools.Agent({ prompt: "go" })')).toEqual([]);
});

test('the other shell spellings of REPL code count too', () => {
  expect(replCommands('await $("cd /w && ls", 5000)')).toEqual(['cd /w && ls']);
  expect(replCommands('await tools.Bash({ description: "x", command: \'gh pr list -R a/b\' })')).toEqual(['gh pr list -R a/b']);
  expect(replCommands('await Bash({command: "git -C \\"/my w\\" status"})')).toEqual(['git -C "/my w" status']);
});

test('a command built at run time is skipped, and the scan stays in step after it', () => {
  expect(replCommands('$`cd ${dir}`; $`gh pr view 1 --repo a/b`')).toEqual(['gh pr view 1 --repo a/b']);
  expect(replCommands('$`ls ${`x`} y`; $`git -C /w status`')).toEqual(['git -C /w status']);
  expect(replCommands('$`echo ${ {a: "}`"}.a }`; $`cd /w`')).toEqual(['cd /w']);
  expect(replCommands('await $(`ls ${d}`)')).toEqual([]);
});

test('no shell tag, a half-written template, or broken code tells nothing', () => {
  expect(replCommands('foo$`cd /w`')).toEqual([]);
  expect(replCommands('const s = `price ${n}$`;')).toEqual([]);
  expect(replCommands('$`cd /w')).toEqual([]);
  expect(replCommands('{"code": ')).toEqual([]);
});

test('a step\'s hints come from every call, in order, minus the commands about no repository', () => {
  expect(stepHints([bash('ls'), repl('$`cd /w`; $`echo x`'), bash('gh pr view 1 --repo a/b')])).toEqual([{ path: '/w' }, { repo: 'a/b' }]);
  expect(stepHints([])).toEqual([]);
});

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
  await step($, [bash('gh pr view 52 --repo a/b')]);
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
  await step($, [bash('git -C /work/other status')]);
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/c/d/issues/52']);
});

test('a home path is expanded before git sees it', async ($, on) => {
  const clock = wire(on);
  st.remotes['/home/me/proj'] = 'git@github.com:c/d.git';
  st.issues['c/d#52'] = prJson(52);
  await step($, [bash('cd ~/proj && git status')]);
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/c/d/issues/52']);
});

test('a path outside any repository changes nothing', async ($, on) => {
  const clock = wire(on);
  await step($, [bash('cd /tmp && ls')]);
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52']);
});

test('a URL in the block does not move its numbers to that repository', async ($, on) => {
  const clock = wire(on);
  st.issues['a/b#52'] = prJson(52);
  st.issues['e/f#52'] = prJson(52);
  await step($, [bash('gh pr view 1 --repo a/b')]);
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
  await step($, [bash('gh pr view 1 --repo a/b')]);
  await clock.settle();
  expect(await shown(ui)).toContain(linked('PR #52', 52));
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52']);
});

test('the same number in two repositories is two cache entries', async ($, on) => {
  const clock = wire(on);
  st.issues['a/b#52'] = prJson(52);
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  await step($, [bash('gh pr view 1 --repo a/b')]);
  await clock.settle();
  await mountBlock($, { text: 'PR #52', id: 'm2' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/o/r/issues/52', 'repos/a/b/issues/52']);
  expect(tally.model).toBe(2);
});

test('a step streams on untouched, without waiting for any of this', async ($, on) => {
  const clock = wire(on);
  const chunks = await step($, [bash('git -C /work/other status')]);
  expect(chunks).toEqual([{ kind: 'text', index: 0, text: 'ok' }]);
  expect(tally.git).toBe(0);
  await clock.settle();
  expect(tally.git).toBe(1);
});

test('a shell command in Code Mode\'s REPL code moves the repository as a Bash call does', async ($, on) => {
  const clock = wire(on);
  st.issues['a/b#52'] = prJson(52);
  await step($, [repl('const out = await $`gh pr view 52 --repo a/b`.nothrow().text();\nout')]);
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/a/b/issues/52']);
});

test('a subagent\'s shell commands count as the main loop\'s do', async ($, on) => {
  const clock = wire(on);
  st.remotes['/work/other'] = 'https://github.com/c/d.git';
  st.issues['c/d#52'] = prJson(52);
  await step($, [repl('$`git -C /work/other log`')], 'agent-1');
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/c/d/issues/52']);
});

test('of several commands in one step, the last that names a repository wins', async ($, on) => {
  const clock = wire(on);
  st.remotes['/work/other'] = 'https://github.com/c/d.git';
  st.issues['c/d#52'] = prJson(52);
  await step($, [bash('gh pr view 1 --repo a/b'), repl('$`git -C /work/other status`; $`cd /tmp`')]);
  await clock.settle();
  await mountBlock($, { text: 'PR #52' });
  await clock.settle();
  expect(tally.ghPaths).toEqual(['repos/c/d/issues/52']);
});

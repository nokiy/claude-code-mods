// Reads a GitHub repository out of remotes, shell commands (a Bash call's, or those in Code Mode's REPL code) and the links ref-peek writes.
import type { PeekRef } from '../types';

/** What a Bash command says about where the session works: a repository outright, or a path to ask git about. */
export type CommandHint = { repo: string } | { path: string };

// A path segment starting with a word character: `..` can never reach a `gh api` path.
const REPO = String.raw`\w[\w.-]*\/\w[\w.-]*`;
const GITHUB = new RegExp(String.raw`github\.com[/:](${REPO})`);
const NAMED = [new RegExp(String.raw`(?:--repo[= ]|\s-R\s+)['"]?(${REPO})`), GITHUB, new RegExp(String.raw`\brepos\/(${REPO})\/`)];
const PATH = /(?:^|[\s;&|(])(?:cd|git\s+-C)\s+("[^"]+"|'[^']+'|[^\s;&|)]+)/;
const HREF = new RegExp(String.raw`^https:\/\/github\.com\/(${REPO})\/(?:pull|issues)\/(\d+)$`);

const withoutSuffix = (repo: string) => repo.replace(/\.git$/, '').replace(/\.$/, '');

/** The owner/repo of a remote URL; null when it is not GitHub's. */
export function parseRemote(url: string): string | null {
  const repo = GITHUB.exec(url.trim())?.[1];
  return repo === undefined ? null : withoutSuffix(repo);
}

/** What one Bash command tells: a named repository wins over a path; a path the shell has yet to expand tells nothing. */
export function commandHint(command: string): CommandHint | null {
  for (const pattern of NAMED) {
    const repo = pattern.exec(command)?.[1];
    if (repo !== undefined) return { repo: withoutSuffix(repo) };
  }
  const raw = PATH.exec(command)?.[1];
  if (raw === undefined) return null;
  const path = raw.replace(/^(["'])(.*)\1$/, '$2');
  return path === '-' || /[$`]/.test(path) ? null : { path };
}

/** A tool call as a model step asks for it: the tool's name and its parsed arguments. */
export type ToolUse = { readonly name: string; readonly input: unknown };

/** A shell command a tool call runs, and the directory it is told to run in (Bun's `.cwd('/path')`), if any. */
export type Shell = { command: string; cwd: string | null };

/** What the shell commands of a step's tool calls tell, in call order; a command that names nothing falls back on its `cwd`. */
export function stepHints(uses: readonly ToolUse[]): CommandHint[] {
  return uses.flatMap(shellCommands)
    .map(s => commandHint(s.command) ?? (s.cwd === null ? null : { path: s.cwd }))
    .filter((hint): hint is CommandHint => hint !== null);
}

/** The shell commands a tool call runs: a Bash call's command, or every literal `$`…`` command in Code Mode's REPL code. */
export function shellCommands(use: ToolUse): Shell[] {
  const field = (key: string) => {
    const value = typeof use.input === 'object' && use.input !== null ? (use.input as Record<string, unknown>)[key] : undefined;
    return typeof value === 'string' ? value : '';
  };
  if (use.name === 'Bash') return field('command') === '' ? [] : [{ command: field('command'), cwd: null }];
  if (use.name === 'REPL') return replCommands(field('code'));
  return [];
}

// `.cwd('/path')` right after the template, with a plain quoted path.
const CWD = /^\.cwd\(\s*('[^'\\]*'|"[^"\\]*")\s*\)/;

const unquote = (literal: string) => literal.slice(1, -1).replace(/\\(.)/gs, (_, c: string) => ({ n: '\n', t: '\t' })[c] ?? c);

/** Code Mode's `$`…`` shell calls with literal commands, in source order; a command built at run time (`${}`) is skipped, not guessed. */
export function replCommands(code: string): Shell[] {
  const found: Shell[] = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== '$' || code[i + 1] !== '`' || /[\w$.]/.test(code[i - 1] ?? '')) continue;
    const t = scanTemplate(code, i + 1);
    if (t.isPlain && t.end < code.length) {
      const cwd = CWD.exec(code.slice(t.end + 1))?.[1];
      found.push({ command: unquote(code.slice(i + 1, t.end + 1)), cwd: cwd === undefined ? null : unquote(cwd) });
    }
    i = t.end;
  }
  return found;
}

// A template literal from its opening backtick: the index of its closing one (the code's length if none), and whether it has no `${}`.
function scanTemplate(code: string, start: number): { end: number; isPlain: boolean } {
  let isPlain = true;
  let i = start + 1;
  while (i < code.length && code[i] !== '`') {
    if (code[i] === '\\') i += 2;
    else if (code[i] === '$' && code[i + 1] === '{') {
      isPlain = false;
      i = skipInterpolation(code, i + 2);
    } else i++;
  }
  return { end: i, isPlain };
}

// From just inside `${`: the index after its closing brace, stepping over nested templates and quoted strings.
function skipInterpolation(code: string, start: number): number {
  let depth = 1;
  let i = start;
  while (i < code.length) {
    const c = code[i];
    if (c === '`') i = scanTemplate(code, i).end + 1;
    else if (c === "'" || c === '"') i = skipQuoted(code, i);
    else {
      if (c === '{') depth++;
      if (c === '}' && --depth === 0) return i + 1;
      i++;
    }
  }
  return i;
}

function skipQuoted(code: string, start: number): number {
  let i = start + 1;
  while (i < code.length && code[i] !== code[start]) i += code[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** The link written for a ref. */
export function hrefOf(ref: PeekRef, isPr: boolean): string {
  return `https://github.com/${ref.repo}/${isPr ? 'pull' : 'issues'}/${ref.number}`;
}

/** The ref a pressed link stands for; null for any other link. */
export function parseHref(href: string): PeekRef | null {
  const m = HREF.exec(href);
  return m?.[1] === undefined ? null : { repo: m[1], number: Number(m[2]) };
}

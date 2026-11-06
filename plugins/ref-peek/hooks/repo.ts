// Reads a GitHub repository out of remotes, Bash commands and the links ref-peek writes.
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

/** The link written for a ref. */
export function hrefOf(ref: PeekRef, isPr: boolean): string {
  return `https://github.com/${ref.repo}/${isPr ? 'pull' : 'issues'}/${ref.number}`;
}

/** The ref a pressed link stands for; null for any other link. */
export function parseHref(href: string): PeekRef | null {
  const m = HREF.exec(href);
  return m?.[1] === undefined ? null : { repo: m[1], number: Number(m[2]) };
}

// [POS] The attribution rule of agent-monitor (spec #36): the one function that says which PR a subagent belongs to, from the first
// `#N` of its description, else the branch on its transcript's first line. Every reader (the /sub PR mode, the per-PR totals, later
// quota-bar) calls this. Pure; tested in tests/unit/attribution.test.ts.
import type { PrEntry } from './prindex'

// `<prefix>/<N>-<slug>`: a ticket branch; leading zeros are dropped (`feature/007-x` is ticket 7).
const TICKET = /\/0*(\d+)-[^/]+$/
const HASH = /#0*(\d+)/
// Long-lived branches: a PR from one of them (dev -> main) is a release PR, which lists every ticket it carries and owns no agent.
const LONG = new Set(['dev', 'main', 'master', 'develop'])

const positive = (s: string | undefined): number | null => {
  const n = s === undefined ? 0 : Number(s)
  return n > 0 ? n : null
}

/** The ticket a branch works on (`feature/43-pr-mode` -> 43), else null. */
export const ticketOf = (branch: string | undefined): number | null => positive(TICKET.exec(branch ?? '')?.[1])

// Of several PRs that match, the open one, else the latest (highest number).
const best = (prs: readonly PrEntry[]): number | null =>
  prs.length === 0 ? null : [...prs].sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN') || b.number - a.number)[0]!.number

// `#N` -> a PR: the PR numbered N, else the PR whose Closes lists N.
const byNumber = (n: number | null, prs: readonly PrEntry[]): number | null =>
  n === null ? null : (prs.find(p => p.number === n)?.number ?? best(prs.filter(p => p.closes.includes(n))))

/**
 * The PR a subagent counts toward, or null (the `Other` group). Release PRs (head a long-lived branch) are never candidates.
 * 1. The first `#N` in `desc` (the spawn description) -> that PR, or the PR whose Closes lists N.
 * 2. Else the transcript's first-line `branch`: a ticket branch `*\/<N>-<slug>` -> the same resolver; else a branch that is a PR's head
 *    (a `spec/` integration branch) -> that PR; else (`dev`, `main`, `HEAD`, exploration branches, no branch) -> null.
 * The description comes first because a transcript's `gitBranch` is the checkout's, which concurrent agents and the main session share.
 */
export function attribute(agent: { desc?: string; branch?: string }, index: readonly PrEntry[]): number | null {
  const prs = index.filter(p => !LONG.has(p.head))
  const { desc, branch } = agent
  return byNumber(positive(HASH.exec(desc ?? '')?.[1]), prs) ?? byNumber(ticketOf(branch), prs) ?? (branch ? best(prs.filter(p => p.head === branch)) : null)
}

// [POS] The attribution rule of agent-monitor (spec #36): the one function that says which PR a subagent belongs to, from the branch on
// its transcript's first line. Every reader (the /sub PR mode, the per-PR totals, later quota-bar) calls this. Pure; tested in attribution.test.ts.
import type { PrEntry } from './prindex'

// `<prefix>/<N>-<slug>`: a ticket branch; leading zeros are dropped (`feature/007-x` is ticket 7).
const TICKET = /\/0*(\d+)-[^/]+$/

/** The ticket a branch works on (`feature/43-pr-mode` -> 43), else null. */
export function ticketOf(branch: string | undefined): number | null {
  const m = TICKET.exec(branch ?? '')
  const n = m ? Number(m[1]) : 0
  return n > 0 ? n : null
}

// Of several PRs that match, the open one, else the latest (highest number).
const best = (prs: readonly PrEntry[]): number | null =>
  prs.length === 0 ? null : [...prs].sort((a, b) => Number(b.state === 'OPEN') - Number(a.state === 'OPEN') || b.number - a.number)[0]!.number

/**
 * The PR a subagent started on `branch` counts toward, or null (the `Other` group):
 * a ticket branch -> the PR whose Closes lists that ticket; else a branch that is a PR's head (a `spec/` integration branch) -> that PR;
 * else (`dev`, `main`, `HEAD`, exploration branches, no branch) -> null. Pass the transcript's first-line branch (Rollup.gitBranch).
 */
export function attribute(branch: string | undefined, index: readonly PrEntry[]): number | null {
  if (!branch) return null
  const ticket = ticketOf(branch)
  return (ticket !== null ? best(index.filter(p => p.closes.includes(ticket))) : null) ?? best(index.filter(p => p.head === branch))
}

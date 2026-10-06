// [POS] The PR index of agent-monitor: recent open and merged PRs of the session's repository (number, title, state, head branch, closed
// tickets) from one `gh pr list`, cached in the store and refreshed on an interval; a failed fetch keeps the last good index. The process
// and store access is handed in (PrIo, built from `$` in register.tsx), so this stays pure.

/** One PR as the attribution rule reads it. `closes`: ticket numbers from GitHub's closing references, else the body's `Closes #N` lines. */
export type PrEntry = { number: number; title: string; state: 'OPEN' | 'MERGED'; head: string; closes: number[] }
/** What the store keeps under PR_INDEX_KEY: the PRs and when they were fetched (ms). Never PR bodies. */
export type PrIndex = { at: number; prs: PrEntry[] }
/** The index plus the session's branch, as the panel draws from it. */
export type PrView = { prs: PrEntry[]; branch?: string }

export const PR_INDEX_KEY = 'prIndex'
/** A stored index younger than this is not fetched again. */
export const PR_INDEX_TTL = 5 * 60 * 1000
export const GH_PR_LIST = ['gh', 'pr', 'list', '--state', 'all', '--limit', '50', '--json', 'number,title,state,headRefName,closingIssuesReferences,body']
export const GIT_BRANCH = ['git', 'rev-parse', '--abbrev-ref', 'HEAD']

type Run = { exitCode: number; stdout: string }
export type PrIo = { run: (argv: string[]) => Promise<Run>; load: (key: string) => Promise<unknown>; save: (key: string, value: PrIndex) => Promise<void> }

// GitHub closing keywords followed by a same-repo `#N` (as pr-hint reads them; a PR into a non-default branch has no closing references).
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?[ \t]+#(\d+)\b/gi
const nums = (xs: unknown[]) => [...new Set(xs.map(Number).filter(n => Number.isInteger(n) && n > 0))]

/** The `gh pr list` JSON as PR entries (closed-unmerged PRs dropped); null when it is no usable answer. */
export function parsePrList(text: string): PrEntry[] | null {
  let rows: unknown
  try { rows = JSON.parse(text) } catch { return null }
  if (!Array.isArray(rows)) return null
  return rows.flatMap((r: Record<string, unknown>) => {
    if (r === null || typeof r !== 'object' || (r.state !== 'OPEN' && r.state !== 'MERGED')) return []
    const refs = Array.isArray(r.closingIssuesReferences) ? nums(r.closingIssuesReferences.map((i: { number?: unknown }) => i?.number)) : []
    const closes = refs.length > 0 ? refs : nums([...String(r.body ?? '').matchAll(CLOSES)].map(m => m[1]))
    return [{ number: Number(r.number), title: String(r.title ?? ''), state: r.state, head: String(r.headRefName ?? ''), closes }]
  })
}

const asIndex = (v: unknown): PrIndex | undefined => {
  const i = v as PrIndex | undefined
  return i && typeof i === 'object' && typeof i.at === 'number' && Array.isArray(i.prs) ? i : undefined
}

/** In-load memory: the last good index and the session's branch. */
export type PrCache = { index?: PrIndex; branch?: string; loaded?: boolean }

/**
 * Bring the cache up to date at `now`: the branch read every call; the index loaded once from the store, fetched again when older than
 * PR_INDEX_TTL. A failed or unusable fetch leaves the index (memory and store) as it was. Returns the view to draw from.
 */
export async function refreshIndex(io: PrIo, cache: PrCache, now: number): Promise<PrView> {
  try {
    const b = await io.run(GIT_BRANCH)
    cache.branch = b.exitCode === 0 ? b.stdout.trim() || undefined : undefined
  } catch { /* no git here: no current branch */ }
  if (!cache.loaded) {
    cache.loaded = true
    cache.index ??= asIndex(await io.load(PR_INDEX_KEY).catch(() => undefined))
  }
  if (!cache.index || now - cache.index.at >= PR_INDEX_TTL) {
    try {
      const r = await io.run(GH_PR_LIST)
      const prs = r.exitCode === 0 ? parsePrList(r.stdout) : null
      if (prs) {
        cache.index = { at: now, prs }
        await io.save(PR_INDEX_KEY, cache.index).catch(() => {})
      }
    } catch { /* gh missing or timed out: the last index stands */ }
  }
  return { prs: cache.index?.prs ?? [], branch: cache.branch }
}

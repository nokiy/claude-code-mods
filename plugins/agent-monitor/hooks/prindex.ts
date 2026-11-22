// [POS] The PR index of agent-monitor: recent open and merged PRs of the session's repository (number, title, state, draft flag, head
// branch, closed tickets) from one `gh pr list`, cached in the store under the session directory and refreshed on an interval; a failed
// fetch keeps the last good index. At most MAX_PR_INDEXES directories keep one. The process and store access is handed in (PrIo, built
// from `$` in register.tsx), so this stays pure.

/**
 * One PR as the attribution rule reads it. `closes`: ticket numbers from GitHub's closing references, else the body's `Closes #N` lines.
 * `isDraft` is absent in an index stored before it was fetched: read as not a draft until the next refresh.
 */
export type PrEntry = { number: number; title: string; state: 'OPEN' | 'MERGED'; isDraft?: boolean; head: string; closes: number[] }

export type PrState = 'draft' | 'ready' | 'merged'
/** The PR's state as pr-hint names it (plugins/pr-hint/hooks/parse.ts prState): Draft → Ready → Merged. */
export const prState = (pr: Pick<PrEntry, 'state' | 'isDraft'>): PrState => (pr.state === 'MERGED' ? 'merged' : pr.isDraft ? 'draft' : 'ready')
/** What the store keeps under prIndexKey(cwd): the PRs and when they were fetched (ms). Never PR bodies. */
export type PrIndex = { at: number; prs: PrEntry[] }
/** The index plus the session's branch, as the panel draws from it. */
export type PrView = { prs: PrEntry[]; branch?: string }

/** The store is the plugin's, shared by every session in every repository: each session directory keeps its own index. */
export const prIndexKey = (cwd: string) => `prIndex:${cwd}`
/** At most this many directories keep a stored index; past it the least recently fetched go (the current one stays). */
export const MAX_PR_INDEXES = 20
/** A stored index younger than this is not fetched again. */
export const PR_INDEX_TTL = 5 * 60 * 1000
export const GH_PR_LIST = ['gh', 'pr', 'list', '--state', 'all', '--limit', '50', '--json', 'number,title,state,isDraft,headRefName,closingIssuesReferences,body']
export const GIT_BRANCH = ['git', 'rev-parse', '--abbrev-ref', 'HEAD']

type Run = { exitCode: number; stdout: string }
export type PrIo = {
  run: (argv: string[]) => Promise<Run>
  load: (key: string) => Promise<unknown>
  save: (key: string, value: PrIndex) => Promise<void>
  keys: () => Promise<readonly string[]>
  drop: (key: string) => Promise<void>
}

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
    return [{ number: Number(r.number), title: String(r.title ?? ''), state: r.state, isDraft: r.isDraft === true, head: String(r.headRefName ?? ''), closes }]
  })
}

const asIndex = (v: unknown): PrIndex | undefined => {
  const i = v as PrIndex | undefined
  return i && typeof i === 'object' && typeof i.at === 'number' && Array.isArray(i.prs) ? i : undefined
}

/** The stored index keys to delete so at most MAX_PR_INDEXES remain: `keep` always stays, then the newest by `at`; oldest first. */
export function stalePrIndexes(indexes: readonly { key: string; at: number }[], keep: string): string[] {
  const rest = indexes.filter(i => i.key !== keep).sort((a, b) => b.at - a.at)
  return rest.slice(MAX_PR_INDEXES - 1).reverse().map(i => i.key)
}

// Delete the indexes past the cap after `key` was written. Best effort: a refused read or delete leaves the rest for the next fetch.
async function prune(io: PrIo, key: string) {
  try {
    const others = (await io.keys()).filter(k => k.startsWith('prIndex:') && k !== key)
    if (others.length < MAX_PR_INDEXES) return
    const ats = await Promise.all(others.map(async k => ({ key: k, at: Number((await io.load(k) as { at?: unknown } | undefined)?.at) || 0 })))
    for (const k of stalePrIndexes(ats, key)) await io.drop(k)
  } catch { /* store refused: tried again on the next fetch */ }
}

/** In-load memory: the last good index, the session's branch, and the one read of the stored index (shared by every caller). */
export type PrCache = { index?: PrIndex; branch?: string; load?: Promise<PrIndex | undefined> }

/** The stored index, read from the store once per load into the cache (an index already in memory wins); runs no process. */
export function loadStored(io: Pick<PrIo, 'load'>, cache: PrCache, cwd: string): Promise<PrIndex | undefined> {
  cache.load ??= io.load(prIndexKey(cwd)).then(asIndex, () => undefined).then(stored => (cache.index ??= stored))
  return cache.load
}

/**
 * Bring the cache up to date at `now`: the branch read every call; the index loaded once from the store, fetched again when older than
 * PR_INDEX_TTL, then the other directories' indexes past MAX_PR_INDEXES deleted. A failed or unusable fetch leaves the index (memory and
 * store) as it was. Returns the view to draw from.
 */
export async function refreshIndex(io: PrIo, cache: PrCache, now: number, cwd: string): Promise<PrView> {
  const key = prIndexKey(cwd)
  try {
    const b = await io.run(GIT_BRANCH)
    cache.branch = b.exitCode === 0 ? b.stdout.trim() || undefined : undefined
  } catch { /* no git here: no current branch */ }
  await loadStored(io, cache, cwd)
  if (!cache.index || now - cache.index.at >= PR_INDEX_TTL) {
    try {
      const r = await io.run(GH_PR_LIST)
      const prs = r.exitCode === 0 ? parsePrList(r.stdout) : null
      if (prs) {
        cache.index = { at: now, prs }
        await io.save(key, cache.index).catch(() => {})
        await prune(io, key)
      }
    } catch { /* gh missing or timed out: the last index stands */ }
  }
  return { prs: cache.index?.prs ?? [], branch: cache.branch }
}

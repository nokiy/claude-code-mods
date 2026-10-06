// Attribution rule tests (spec #36): which PR a subagent belongs to, from the first `#N` of its description, else its first-line branch.
import { expect, test } from 'claude-code/testing'

import { assistantLine, jsonl, userLine } from '../tests/transcripts'
import { attribute } from './attribution'
import type { PrEntry } from './prindex'
import { emptyRollup, feed } from './transcript'

const pr = (number: number, head: string, closes: number[], state: PrEntry['state'] = 'OPEN'): PrEntry => ({ number, title: `PR ${number}`, state, head, closes })
// Issue and PR numbers share one sequence on GitHub: no PR number below is also a ticket number.
const INDEX: PrEntry[] = [
  pr(49, 'spec/36-pr-agent-views', [40, 41, 42, 43]),
  pr(39, 'feature/38-pass-next', [38], 'MERGED'),
  pr(6, 'feature/7-old', [7], 'MERGED'),
  pr(12, 'feature/7-redo', [7]),
]
const on = (branch: string | undefined) => attribute({ branch }, INDEX)

test('a ticket branch goes to the PR that closes its ticket', () => {
  expect(on('feature/43-pr-mode')).toBe(49)
  expect(on('fix/41-x')).toBe(49)
})

test('a branch that is a PR head (the spec integration branch) goes to that PR', () => {
  expect(on('spec/36-pr-agent-views')).toBe(49)
})

test('a zero-padded ticket number counts without its zeros', () => {
  expect(on('feature/0043-x')).toBe(49)
  expect(attribute({ branch: 'feature/007-x' }, [pr(12, 'feature/7-redo', [7])])).toBe(12)
})

test('HEAD, dev, main and exploration branches go to no PR', () => {
  for (const b of ['HEAD', 'dev', 'main', 'explore-cache', 'feature/99-nobody', '', undefined]) expect(on(b)).toBeNull()
})

test('a merged PR still takes its branches; of two PRs closing one ticket, the open one wins', () => {
  expect(on('feature/38-pass-next')).toBe(39)
  expect(on('feature/7-anything')).toBe(12)
  expect(attribute({ branch: 'feature/7-anything' }, INDEX.filter(p => p.number !== 12))).toBe(6)
})

test('the first transcript line\'s branch holds, whatever later lines say', () => {
  const a = { sessionId: 's', agentId: 'x', branch: 'dev' }
  const later = JSON.stringify({ ...JSON.parse(assistantLine(a, { id: 'm1' })), gitBranch: 'feature/43-pr-mode' })
  const { roll } = feed(emptyRollup(), jsonl([userLine(a), later]))
  expect(on(roll.gitBranch)).toBeNull()
  expect(on(feed(emptyRollup(), jsonl([userLine({ ...a, branch: 'feature/43-pr-mode' })])).roll.gitBranch)).toBe(49)
})

// A release PR (dev -> main) lists every ticket the release carries; it never owns an agent.
const RELEASE = pr(48, 'dev', [36, 38, 40, 41, 42, 43, 44, 45, 46], 'MERGED')
const WITH_RELEASE = [...INDEX, RELEASE]

test('a dev -> main release PR closing the same ticket never takes the agent', () => {
  expect(attribute({ branch: 'feature/38-x' }, WITH_RELEASE)).toBe(39)
  expect(attribute({ branch: 'feature/43-pr-mode' }, WITH_RELEASE)).toBe(49)
  expect(attribute({ branch: 'spec/36-pr-agent-views' }, WITH_RELEASE)).toBe(49)
  expect(attribute({ branch: 'dev' }, WITH_RELEASE)).toBeNull()
})

test('the first #N of the description decides, whatever branches the transcript lines carry', () => {
  const a = { sessionId: 's', agentId: 'x', branch: 'worktree-agent-x' }
  const later = JSON.stringify({ ...JSON.parse(assistantLine(a, { id: 'm1' })), gitBranch: 'feature/41-card' })
  const { roll } = feed(emptyRollup(), jsonl([userLine(a), later]))
  expect(attribute({ desc: 'op.med · #42 transcript history', branch: roll.gitBranch }, WITH_RELEASE)).toBe(49)
  expect(attribute({ desc: 'so.low · 合入 #43 到集成分支', branch: 'dev' }, WITH_RELEASE)).toBe(49)
  expect(attribute({ desc: 'Spec review #38', branch: 'dev' }, WITH_RELEASE)).toBe(39)
})

test('a #N that is a PR number goes to that PR', () => {
  expect(attribute({ desc: 'review PR #49 once more', branch: 'dev' }, WITH_RELEASE)).toBe(49)
})

test('no #N, or one that matches nothing: the branch rule decides', () => {
  expect(attribute({ desc: 'sleep test', branch: 'dev' }, WITH_RELEASE)).toBeNull()
  expect(attribute({ desc: 'look around', branch: 'feature/43-pr-mode' }, WITH_RELEASE)).toBe(49)
  expect(attribute({ desc: 'check #999', branch: 'feature/43-pr-mode' }, WITH_RELEASE)).toBe(49)
})

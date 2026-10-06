// Attribution rule tests (spec #36): which PR a subagent's first-line branch belongs to.
import { expect, test } from 'claude-code/testing'

import { assistantLine, jsonl, userLine } from '../tests/transcripts'
import { attribute } from './attribution'
import type { PrEntry } from './prindex'
import { emptyRollup, feed } from './transcript'

const pr = (number: number, head: string, closes: number[], state: PrEntry['state'] = 'OPEN'): PrEntry => ({ number, title: `PR ${number}`, state, head, closes })
const INDEX: PrEntry[] = [
  pr(49, 'spec/36-pr-agent-views', [40, 41, 42, 43]),
  pr(38, 'feature/38-pass-next', [38], 'MERGED'),
  pr(7, 'feature/7-old', [7], 'MERGED'),
  pr(12, 'feature/7-redo', [7]),
]

test('a ticket branch goes to the PR that closes its ticket', () => {
  expect(attribute('feature/43-pr-mode', INDEX)).toBe(49)
  expect(attribute('fix/41-x', INDEX)).toBe(49)
})

test('a branch that is a PR head (the spec integration branch) goes to that PR', () => {
  expect(attribute('spec/36-pr-agent-views', INDEX)).toBe(49)
})

test('a zero-padded ticket number counts without its zeros', () => {
  expect(attribute('feature/0043-x', INDEX)).toBe(49)
  expect(attribute('feature/007-x', [pr(12, 'feature/7-redo', [7])])).toBe(12)
})

test('HEAD, dev, main and exploration branches go to no PR', () => {
  for (const b of ['HEAD', 'dev', 'main', 'explore-cache', 'feature/99-nobody', '', undefined]) expect(attribute(b, INDEX)).toBeNull()
})

test('a merged PR still takes its branches; of two PRs closing one ticket, the open one wins', () => {
  expect(attribute('feature/38-pass-next', INDEX)).toBe(38)
  expect(attribute('feature/7-anything', INDEX)).toBe(12)
  expect(attribute('feature/7-anything', INDEX.filter(p => p.number !== 12))).toBe(7)
})

test('the first transcript line\'s branch holds, whatever later lines say', () => {
  const a = { sessionId: 's', agentId: 'x', branch: 'dev' }
  const later = JSON.stringify({ ...JSON.parse(assistantLine(a, { id: 'm1' })), gitBranch: 'feature/43-pr-mode' })
  const { roll } = feed(emptyRollup(), jsonl([userLine(a), later]))
  expect(attribute(roll.gitBranch, INDEX)).toBeNull()
  expect(attribute(feed(emptyRollup(), jsonl([userLine({ ...a, branch: 'feature/43-pr-mode' })])).roll.gitBranch, INDEX)).toBe(49)
})

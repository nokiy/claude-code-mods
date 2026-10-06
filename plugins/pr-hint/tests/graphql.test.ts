// Tests the GraphQL unwrapping (PR node, closing issues, labels, CI contexts, by-number issues) on answers shaped like GitHub's, and that the parsers read the result as `gh pr view` was read.
import { expect, test } from 'claude-code/testing';
import { PR_ARGS, PR_QUERY, branchHead, isCurrentPr, issuesQuery, parseGraphql, parseIssues, splitIssues } from '../hooks/graphql';
import { closingNumbers, parsePr, prHead } from '../hooks/parse';

const issue = (number: number, labels: string[] = []) => ({
  number, title: `t${number}`, state: 'OPEN', body: '', labels: { nodes: labels.map(name => ({ name })) },
});
const answer = (over: object = {}) => JSON.stringify({
  data: {
    repository: {
      pullRequests: {
        nodes: [{
          number: 444, title: 'gateway', state: 'OPEN', isDraft: true, baseRefName: 'dev', headRefName: 'spec/428-gateway', url: 'u', body: '',
          commits: { nodes: [{ commit: { messageHeadline: 'feat(#429): a' } }, { commit: { messageHeadline: 'Merge x/430-y' } }] },
          statusCheckRollup: { contexts: { nodes: [{ status: 'COMPLETED', conclusion: 'SKIPPED' }, { state: 'FAILURE' }] } },
          closingIssuesReferences: { nodes: [issue(428, ['enhancement', 'spec']), issue(429)] },
          ...over,
        }],
      },
    },
  },
});

const W = { cwd: '/tmp/x', root: '/tmp/x', branch: 'b' };
// The unwrapped PR of a usable answer (null: usable, no PR of ours).
const prOf = (text: string) => {
  const a = parseGraphql(text);
  if (!a.ok) throw new Error('answer not usable');
  return a.pr;
};

test('the PR node reads like gh pr view: CI, headlines, head, closing issues', () => {
  const json = prOf(answer())!;
  const pr = parsePr(json, W, []);
  expect(pr).toMatchObject({ number: 444, isDraft: true, base: 'dev', head: 'spec/428-gateway', url: 'u', ci: { ok: 1, fail: 1, pending: 0, total: 2 } });
  expect(prHead(json)).toEqual({ headRef: 'spec/428-gateway', headlines: ['feat(#429): a', 'Merge x/430-y'] });
  expect(closingNumbers(json)).toEqual([428, 429]);
});

test('the Spec is the issue labelled spec; the rest are tickets', () => {
  const { raw, spec } = splitIssues(prOf(answer())!.closingIssuesReferences);
  expect(spec).toEqual({ number: 428, title: 't428' });
  expect(raw.map(t => t.number)).toEqual([429]);
});

test('no PR: nothing, a CLOSED PR, a PR from a fork; a null rollup reads as no CI', () => {
  expect(prOf('{"data":{"repository":{"pullRequests":{"nodes":[]}}}}')).toBeNull();
  expect(prOf(answer({ state: 'CLOSED' }))).toBeNull();
  expect(prOf(answer({ isCrossRepository: true }))).toBeNull();
  expect(parsePr(prOf(answer({ statusCheckRollup: null }))!, W, []).ci.total).toBe(0);
});

test('the OPEN PR wins; without one, the latest MERGED PR of the branch is shown', () => {
  const nodes = JSON.parse(answer()).data.repository.pullRequests.nodes;
  const list = (...prs: object[]) => JSON.stringify({ data: { repository: { pullRequests: { nodes: prs } } } });
  const merged = (number: number) => ({ ...nodes[0], number, state: 'MERGED' });
  expect(prOf(list(merged(1), { ...nodes[0], number: 2 }))?.number).toBe(2);
  expect(prOf(list(merged(3), merged(1)))?.number).toBe(3);
  expect(prOf(list({ ...nodes[0], number: 4, state: 'CLOSED' }, merged(1)))?.number).toBe(1);
});

test('a fork PR of the same branch name does not hide our own PR behind it', () => {
  const nodes = JSON.parse(answer()).data.repository.pullRequests.nodes;
  const both = { data: { repository: { pullRequests: { nodes: [{ ...nodes[0], number: 1, isCrossRepository: true }, { ...nodes[0], number: 2, isCrossRepository: false }] } } } };
  expect(prOf(JSON.stringify(both))?.number).toBe(2);
});

test('an unusable answer is not "no PR": bad JSON, GraphQL errors, no repository', () => {
  expect(parseGraphql('not json')).toEqual({ ok: false });
  expect(parseGraphql('{"errors":[{"message":"rate limited"}]}')).toEqual({ ok: false });
  expect(parseGraphql('{"data":{"repository":{"pullRequests":{"nodes":[]}}},"errors":[{}]}')).toEqual({ ok: false });
  expect(parseGraphql('{"data":{"repository":null}}')).toEqual({ ok: false });
  expect(parseGraphql('{"data":null}')).toEqual({ ok: false });
});

test('a PR with no linked issue falls back to the body; issues come back by number', () => {
  const json = prOf(answer({ closingIssuesReferences: { nodes: [] }, body: 'Closes #22\nCloses #23' }))!;
  expect(closingNumbers(json)).toEqual([22, 23]);
  expect(issuesQuery([22, 23])).toContain('i22:issue(number:22){');
  const text = JSON.stringify({ data: { repository: { i22: issue(22, ['spec']), i23: null } } });
  expect(splitIssues(parseIssues(text))).toEqual({ raw: [], spec: { number: 22, title: 't22' } });
});

test('gh fills the repository and branch itself', () => {
  expect(PR_ARGS).toEqual(['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-F', 'branch={branch}']);
  expect(PR_QUERY).toContain('pullRequests(headRefName:$branch,states:[OPEN,MERGED],first:10,orderBy:{field:UPDATED_AT,direction:DESC})');
  expect(PR_QUERY).toContain('isCrossRepository');
  // headRefOid is back (dropped in #22 as unused): it tells whether a merged PR is still the branch's.
  expect(PR_QUERY).toContain('headRefOid');
});

test('a MERGED PR is current only while the branch sits on its merged commit; an OPEN one always is', () => {
  const refs = 'refs/heads/dev d2\nrefs/heads/feat/9-x f9\nrefs/remotes/origin/dev d1\n';
  expect(branchHead(refs, 'dev')).toBe('d2');
  expect(branchHead(refs, 'main')).toBeNull();
  expect(branchHead(null, 'dev')).toBeNull();
  // A feature branch right after its merge: still on the merged commit → Merged shows.
  expect(isCurrentPr({ state: 'MERGED', headRefOid: 'f9' }, refs, 'feat/9-x')).toBe(true);
  // dev after a dev → main release plus newer work: the old release PR is history.
  expect(isCurrentPr({ state: 'MERGED', headRefOid: 'd1' }, refs, 'dev')).toBe(false);
  // No local branch to compare (detached HEAD, git failed): hidden rather than guessed.
  expect(isCurrentPr({ state: 'MERGED', headRefOid: 'd2' }, null, 'dev')).toBe(false);
  expect(isCurrentPr({ state: 'OPEN', headRefOid: 'zz' }, refs, 'dev')).toBe(true);
});

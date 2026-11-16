// Tests the GraphQL unwrapping (PR node, closing issues, labels, CI contexts, by-number issues) on answers shaped like GitHub's, and that the parsers read the result as `gh pr view` was read.
import { expect, test } from 'claude-code/testing';
import { PR_ARGS, PR_QUERY, branchHead, isCurrentPr, issuesQuery, parseGraphql, parseIssues, splitIssues } from '../hooks/graphql';
import { closingNumbers, mergedByCommits, parsePr, prHead } from '../hooks/parse';

const issue = (number: number, labels: string[] = []) => ({
  number, title: `t${number}`, state: 'OPEN', body: '', labels: { nodes: labels.map(name => ({ name })) },
});
const answer = (over: object = {}) => JSON.stringify({
  data: {
    repository: {
      pullRequests: {
        nodes: [{
          number: 444, title: 'gateway', state: 'OPEN', isDraft: true, baseRefName: 'dev', headRefName: 'spec/428-gateway', url: 'u', body: '',
          commits: { nodes: [{ commit: { message: 'feat(#429): a\n\nbody' } }, { commit: { message: 'Merge x/430-y' } }] },
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

const commitsOf = (...messages: string[]) => ({ commits: { nodes: messages.map(message => ({ commit: { message } })) } });
test('a commit title over 70 characters still names its ticket; the query never asks the cut messageHeadline', () => {
  const long = 'feat(pr-hint): card line 2 shows subagent cost, tokens, time and refusals from agent-monitor (#45)';
  const merge = "Merge remote-tracking branch 'origin/spec/36-pr-agent-views' into feature/46-alert-timeline";
  expect(long.length).toBeGreaterThan(70);
  expect(merge.length).toBeGreaterThan(70);
  const json = prOf(answer(commitsOf(`${long}\n\nRefs #41`, `${merge}\r\n\n# Conflicts:\n#\tplugins/x`)))!;
  const { headlines } = prHead(json);
  expect(headlines).toEqual([long, merge]);
  expect([...mergedByCommits(headlines, [45, 46])].sort((a, b) => a - b)).toEqual([45, 46]);
  expect(PR_QUERY).toContain('commit{message}');
  expect(PR_QUERY).not.toContain('messageHeadline');
});

test('a commit body never counts: a body ending (#47) or a Merge body naming /48- leaves both unmerged', () => {
  const json = prOf(answer(commitsOf('chore: tidy\n\nsee feat(x): y (#47)', "Merge branch 'dev' into spec/1-x\n\n# Conflicts:\n#\tfeature/48-x/a.ts")))!;
  expect(prHead(json).headlines).toEqual(['chore: tidy', "Merge branch 'dev' into spec/1-x"]);
  expect(mergedByCommits(prHead(json).headlines, [47, 48]).size).toBe(0);
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

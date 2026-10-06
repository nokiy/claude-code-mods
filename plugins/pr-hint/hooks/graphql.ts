// The GraphQL side of one fetch: query text and `gh api graphql` arguments, plus the unwrapping of its answers into the shape parse.ts reads. Pure; no engine calls.
import type { PrData, PrTicket } from '../types';
import { isSpecIssue, parseJson, parseTicket } from './parse';

type Json = Record<string, unknown>;

// The one request per fetch: the current branch's PRs (open or merged, latest first) with their CI, commit headlines
// and closing issues.
// `gh` fills {owner}, {repo} and {branch} from the session directory's repository and checked-out branch.
export const REPO_ARGS = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}'];
export const PR_ARGS = [...REPO_ARGS, '-F', 'branch={branch}'];
const ISSUE_FIELDS = 'number title state body labels(first:10){nodes{name}}';
export const PR_QUERY =
  'query($owner:String!,$name:String!,$branch:String!){repository(owner:$owner,name:$name){pullRequests(headRefName:$branch,states:[OPEN,MERGED],first:10,orderBy:{field:UPDATED_AT,direction:DESC}){nodes{' +
  'number title state isDraft isCrossRepository baseRefName headRefName url body ' +
  'commits(first:100){nodes{commit{messageHeadline}}} ' +
  'statusCheckRollup{contexts(first:100){nodes{... on CheckRun{status conclusion} ... on StatusContext{state}}}} ' +
  `closingIssuesReferences(first:50){nodes{${ISSUE_FIELDS}}}}}}}`;

/** The second request, only when GitHub links no closing issue but the PR body says `Closes #N`: those issues by number. */
export function issuesQuery(nums: readonly number[]): string {
  return `query($owner:String!,$name:String!){repository(owner:$owner,name:$name){${nums.map(n => `i${n}:issue(number:${n}){${ISSUE_FIELDS}}`).join(' ')}}}`;
}

const nodes = (v: unknown): Json[] => {
  const n = v !== null && typeof v === 'object' ? (v as Json).nodes : null;
  return Array.isArray(n) ? (n as Json[]) : [];
};
const flatIssue = (i: Json): Json => ({ ...i, labels: nodes(i.labels) });

/** The unwrapped PR node; `closingIssuesReferences` is already a plain array. */
export type PrJson = Json & { closingIssuesReferences: Json[] };
/** ok:false = no usable answer (bad JSON, GraphQL `errors`, no repository): the caller keeps what it had. ok:true with pr:null = GitHub says there is no PR of ours. */
export type PrAnswer = { ok: false } | { ok: true; pr: PrJson | null };

/**
 * Unwraps the GraphQL answer into the shape the parsers read (what `gh pr view --json` gave):
 * commits, statusCheckRollup, closingIssuesReferences and labels become plain arrays.
 * The PR is the first OPEN one whose head lives in this repository (a fork's PR of the same branch name is skipped),
 * else the first (latest) MERGED one; a CLOSED PR is never shown.
 */
export function parseGraphql(text: string): PrAnswer {
  const root = parseJson(text) as { data?: { repository?: { pullRequests?: unknown } | null }; errors?: unknown } | null;
  const repo = root?.data?.repository;
  if (!root || root.errors || !repo) return { ok: false };
  const ours = nodes(repo.pullRequests).filter(n => n.isCrossRepository !== true);
  const pr = ours.find(n => n.state === 'OPEN') ?? ours.find(n => n.state === 'MERGED');
  if (!pr) return { ok: true, pr: null };
  const rollup = pr.statusCheckRollup as Json | null | undefined;
  return {
    ok: true,
    pr: {
      ...pr,
      commits: nodes(pr.commits).map(n => n.commit),
      statusCheckRollup: nodes(rollup?.contexts),
      closingIssuesReferences: nodes(pr.closingIssuesReferences).map(flatIssue),
    },
  };
}

/** The issues of an `issuesQuery` answer (a missing issue is skipped). */
export function parseIssues(text: string): Json[] {
  const root = parseJson(text) as { data?: { repository?: Json } } | null;
  return Object.values(root?.data?.repository ?? {}).filter((v): v is Json => v !== null && typeof v === 'object').map(flatIssue);
}

/** Splits issues into tickets and the Spec (the one labelled `spec`). */
export function splitIssues(issues: readonly Json[]): { raw: PrTicket[]; spec: PrData['spec'] } {
  const spec = issues.find(isSpecIssue);
  return {
    raw: issues.filter(i => !isSpecIssue(i)).map(parseTicket),
    spec: spec ? { number: Number(spec.number), title: String(spec.title ?? '') } : null,
  };
}

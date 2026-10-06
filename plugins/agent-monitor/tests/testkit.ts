// The register-level harness of agent-monitor: the engine beneath the plugin answered from memory (session, settings, agent list,
// conversation, and the file system and `tail` process through the fake fs of transcripts.ts), plus mount helpers. The test kit has
// no fs or process mock, so `wire` hooks those events on the test's `on`, as pr-hint's testkit does for `process.run`.
import { mock, test } from 'claude-code/testing'

import { fakeFs } from './transcripts'
import type { FakeFs } from './transcripts'

export const HOME = '/home/u'
/** The session's project root and cwd; its transcripts live in PROJECT. */
export const ROOT = '/work/repo'
export const PROJECT = `${HOME}/.claude/projects/-work-repo`
/** Another project's transcript directory on the same machine. */
export const OTHER = `${HOME}/.claude/projects/-work-other`
export const done = { isStdoutTruncated: false, isStderrTruncated: false }

type On = Parameters<typeof mock.env>[0]
export type Dollar = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
export type ListAgent = { id: string; type: string; status: string; description: string }

/**
 * Mutable answers: the session id `$.session.id()` gives, what `$.agent.list()` lists, the branch `git rev-parse --abbrev-ref HEAD`
 * prints, what `gh pr list` prints (null: gh fails, exit 1), the usage a model step answers with. `ghCalls` counts gh runs. Reset by wire().
 */
export const st = { session: 'cur', agents: [] as ListAgent[], branch: 'dev', gh: '[]' as string | null, ghCalls: 0, usage: {} as Record<string, number> }

/** One row of `gh pr list --json number,title,state,headRefName,closingIssuesReferences,body`; `closes` go into the body as `Closes #N` lines. */
export const ghPr = (number: number, title: string, headRefName: string, closes: number[] = [], state = 'OPEN') =>
  ({ number, title, state, headRefName, closingIssuesReferences: [], body: `Summary\n\n${closes.map(n => `Closes #${n}`).join('\n')}` })

/**
 * Answer every engine call agent-monitor makes, from memory: English UI, HOME, the session at ROOT, an empty conversation, `st`'s
 * session id and agent list, and the file system `fs` (`$.fs.list` / `$.fs.read`; `$.process.run(['tail', '-c', '+N', path])`).
 * Returns the fake fs, whose `tally` counts reads, tails and listings.
 */
export function wire(on: On, fs: FakeFs = fakeFs()): FakeFs {
  Object.assign(st, { session: 'cur', agents: [], branch: 'dev', gh: '[]', ghCalls: 0, usage: {} })
  mock.env(on, { HOME })
  on('settings.read', async () => ({ value: {} }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('command.register', async () => ({ value: undefined }) as never)
  on('command.run', async () => ({}) as never)
  on('ui.panes', async () => ({ value: [] }))
  on('ui.open', async () => ({ value: {} }) as never)
  on('ui.close', async () => ({ value: undefined }))
  on('ui.toast', async () => ({ value: undefined }))
  on('session.cwd', async () => ({ value: ROOT }))
  on('session.root', async () => ({ value: ROOT }))
  on('session.id', async () => ({ value: st.session }))
  on('session.messages', async () => ({ value: [] }) as never)
  on('agent.list', async () => ({ value: st.agents }) as never)
  // The engine's own band draws nothing; a model step answers with `st.usage` (set by `step`).
  on('ui.render', { component: 'AbovePrompt' }, async () => ({ type: 'Box', props: {}, children: [] }) as never)
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: st.usage } as never
  })
  on('fs.list', async (_$, e) => ({ value: fs.list(e.path) }))
  on('fs.read', async (_$, e) => ({ value: fs.read(e.path) }))
  on('process.run', async (_$, e) => {
    const [cmd, , from, path] = e.argv
    if (cmd === 'git' && e.argv.join(' ') === 'git rev-parse --abbrev-ref HEAD') return { value: { exitCode: 0, stdout: `${st.branch}\n`, stderr: '', ...done } }
    if (cmd === 'gh') {
      st.ghCalls++
      return { value: st.gh === null ? { exitCode: 1, stdout: '', stderr: 'HTTP 502', ...done } : { exitCode: 0, stdout: st.gh, stderr: '', ...done } }
    }
    if (cmd !== 'tail' || !path || !from) return { value: { exitCode: 1, stdout: '', stderr: 'unexpected command', ...done } }
    return { value: { exitCode: 0, stdout: fs.tail(path, Number(from.slice(1)) - 1), stderr: '', ...done } }
  })
  return fs
}

/** The /sub pane as the terminal docks it. */
export const mountPane = ($: Dollar, bodyColumns = 120) =>
  $.ui.mount({ plugin: 'agent-monitor', surface: 'terminal', component: 'Pane', requestId: 'sub', props: { title: 'Subagents', isFocused: true, bodyColumns, placement: 'dock' } as never, viewport: { columns: 160, rows: 50 } })

/** The band above the prompt, 100 columns wide. */
export const mountBand = ($: Dollar, bodyColumns = 100) =>
  $.ui.mount({ plugin: 'agent-monitor', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 20, bodyColumns } as never, viewport: { columns: 160, rows: 50 } })

export type StepUsage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

/** One model step of subagent `agentId` on `model`, answered beneath every plugin with `usage`: what `turn.step` brings the mod. */
export async function step($: Dollar, agentId: string, model: string, usage: StepUsage, effort?: 'low' | 'medium' | 'high') {
  st.usage = { cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...usage }
  const s = $.turn.step({ turnId: `t-${agentId}`, index: 0, model, effort, agentId, messageCount: 1 } as never)
  for await (const _ of s) void _
}

/** The table's rows, one Button each keyed `row:<agentId>`, in drawn order. */
export const rowKeys = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('row:'))

/** The PR-mode list in drawn order: group rows (`group:pr:<n>`, `group:other`) and agent rows (`row:<agentId>`). */
export const listKeys = async (ui: { findAll: (q: { type: string }) => Promise<{ key: string | undefined }[]> }) =>
  (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '').filter(k => k.startsWith('row:') || k.startsWith('group:'))

/** The text of every Text element drawn, joined: what a person reads off the pane. */
export const shown = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

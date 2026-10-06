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

/** Mutable answers: the session id `$.session.id()` gives, what `$.agent.list()` lists. Reset by wire(). */
export const st = { session: 'cur', agents: [] as ListAgent[] }

/**
 * Answer every engine call agent-monitor makes, from memory: English UI, HOME, the session at ROOT, an empty conversation, `st`'s
 * session id and agent list, and the file system `fs` (`$.fs.list` / `$.fs.read`; `$.process.run(['tail', '-c', '+N', path])`).
 * Returns the fake fs, whose `tally` counts reads, tails and listings.
 */
export function wire(on: On, fs: FakeFs = fakeFs()): FakeFs {
  st.session = 'cur'
  st.agents = []
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
  on('fs.list', async (_$, e) => ({ value: fs.list(e.path) }))
  on('fs.read', async (_$, e) => ({ value: fs.read(e.path) }))
  on('process.run', async (_$, e) => {
    const [cmd, , from, path] = e.argv
    if (cmd !== 'tail' || !path || !from) return { value: { exitCode: 1, stdout: '', stderr: 'unexpected command', ...done } }
    return { value: { exitCode: 0, stdout: fs.tail(path, Number(from.slice(1)) - 1), stderr: '', ...done } }
  })
  return fs
}

/** The /sub pane as the terminal docks it. */
export const mountPane = ($: Dollar, bodyColumns = 120) =>
  $.ui.mount({ plugin: 'agent-monitor', surface: 'terminal', component: 'Pane', requestId: 'sub', props: { title: 'Subagents', isFocused: true, bodyColumns, placement: 'dock' } as never, viewport: { columns: 160, rows: 50 } })

/** The text of every Text element drawn, joined: what a person reads off the pane. */
export const shown = async (ui: { findAll: (q: { type: string }) => Promise<{ text: string }[]> }) => (await ui.findAll({ type: 'Text' })).map(t => t.text).join('\n')

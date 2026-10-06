// Fake subagent transcripts as Claude Code writes them under ~/.claude/projects/<slug>/<sessionId>/subagents/: one jsonl
// (`agent-<agentId>.jsonl`, first line a user line carrying sessionId / agentId / gitBranch) plus its meta file. Pure; shared by
// the transcript unit tests and the register-level suite (testkit.ts).
import { utf8Bytes } from '../hooks/transcript'

export type FakeUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
/** One assistant message: `id` repeats across lines of a streamed message, the last line holding the final usage. */
export type FakeStep = { id: string; model?: string; usage?: FakeUsage; at?: string }
export type FakeAgent = {
  sessionId: string
  agentId: string
  type?: string
  desc?: string
  branch?: string
  cwd?: string
  prompt?: string
  model?: string
  at?: string
  steps?: FakeStep[]
  /** Hook refusals: tool_result text of a line carrying `toolDenialKind`. */
  denials?: string[]
}

const ids = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>) => ({ sessionId: a.sessionId, agentId: a.agentId, isSidechain: true, userType: 'external', version: '2.1.291' })
const usage = (u: FakeUsage = {}) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...u })

export const userLine = (a: FakeAgent) =>
  JSON.stringify({ ...ids(a), parentUuid: null, type: 'user', timestamp: a.at ?? '2026-10-01T10:00:00.000Z', cwd: a.cwd ?? '/work/repo', gitBranch: a.branch ?? 'dev', message: { role: 'user', content: a.prompt ?? 'do the task' } })

export const assistantLine = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>, s: FakeStep, model = 'claude-opus-4-5') =>
  JSON.stringify({ ...ids(a), type: 'assistant', timestamp: s.at ?? '2026-10-01T10:01:00.000Z', message: { id: s.id, role: 'assistant', model: s.model ?? model, usage: usage(s.usage), content: [{ type: 'text', text: 'ok' }] } })

export const denialLine = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>, text: string, at = '2026-10-01T10:02:00.000Z', kind = 'permission-rule') =>
  JSON.stringify({ ...ids(a), type: 'user', timestamp: at, toolDenialKind: kind, message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: text, tool_use_id: 'toolu_x' }] } })

export const attachmentLine = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>) =>
  JSON.stringify({ ...ids(a), type: 'attachment', timestamp: '2026-10-01T10:00:30.000Z', attachment: { type: 'hook_success' } })

/** Lines joined as a jsonl file: each line ends with a newline. */
export const jsonl = (lines: readonly string[]) => lines.map(l => `${l}\n`).join('')

/** The whole transcript of one agent: its first user line, its steps, then its refusals. */
export const agentTranscript = (a: FakeAgent) =>
  jsonl([userLine(a), ...(a.steps ?? [{ id: 'm1', usage: { input_tokens: 10, output_tokens: 5 } }]).map(s => assistantLine(a, s, a.model)), ...(a.denials ?? []).map(d => denialLine(a, d))])

export const agentMeta = (a: FakeAgent) =>
  JSON.stringify({ agentType: a.type ?? 'worker', description: a.desc ?? 'do the task', toolUseId: `toolu_${a.agentId}`, spawnDepth: 1, requestShape: 'background', requestNonInteractive: true })

/** Paths of an agent's two files under a project directory. */
export const agentPaths = (projectDir: string, a: Pick<FakeAgent, 'sessionId' | 'agentId'>) => {
  const base = `${projectDir}/${a.sessionId}/subagents/agent-${a.agentId}`
  return { jsonl: `${base}.jsonl`, meta: `${base}.meta.json` }
}

/** Both files of an agent, keyed by absolute path, as a fake file system holds them. */
export const agentFiles = (projectDir: string, a: FakeAgent): Record<string, string> => {
  const p = agentPaths(projectDir, a)
  return { [p.jsonl]: agentTranscript(a), [p.meta]: agentMeta(a) }
}

/**
 * A file system in memory: absolute path -> text, with an optional `size` that stands for a file too large to build (keep such a
 * file ASCII: `tail` slices by character). `mtime` bumps on every write. `tally` counts whole reads, `tail` calls and listings per path.
 */
export function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map<string, { text: string; size?: number; mtimeMs: number }>()
  let clock = 1_000
  const tally = { reads: new Map<string, number>(), tails: [] as { path: string; from: number }[], lists: [] as string[] }
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const byteSize = (f: { text: string; size?: number }) => f.size ?? utf8Bytes(f.text)
  const fs = {
    files,
    tally,
    write(path: string, text: string, size?: number) { files.set(path, { text, size, mtimeMs: ++clock }) },
    append(path: string, text: string, grow?: number) {
      const f = files.get(path)
      files.set(path, { text: (f?.text ?? '') + text, size: f?.size === undefined ? undefined : f.size + (grow ?? text.length), mtimeMs: ++clock })
    },
    add(entries: Record<string, string>) { for (const [p, t] of Object.entries(entries)) fs.write(p, t) },
    reset() { tally.reads.clear(); tally.tails.length = 0; tally.lists.length = 0 },
    /** Entries directly under `dir` (files and the directories that lead to deeper files); rejects when nothing is there. */
    list(dir: string) {
      tally.lists.push(dir)
      const pre = `${dir.replace(/\/$/, '')}/`
      const out = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
      for (const [p, f] of files) {
        if (!p.startsWith(pre)) continue
        const [name, ...deeper] = p.slice(pre.length).split('/')
        if (!name) continue
        out.set(name, deeper.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: byteSize(f), mtimeMs: f.mtimeMs, isLink: false })
      }
      if (out.size === 0) throw new Error(`ENOENT: ${dir}`)
      return [...out.values()]
    },
    read(path: string) {
      bump(tally.reads, path)
      const f = files.get(path)
      if (!f) throw new Error(`ENOENT: ${path}`)
      if (byteSize(f) > 4 * 1024 * 1024) throw new Error(`too large: ${path}`)
      return f.text
    },
    /** `tail -c +<from+1>`: the bytes from `from` on (characters: ASCII files only). */
    tail(path: string, from: number) {
      tally.tails.push({ path, from })
      const f = files.get(path)
      if (!f) throw new Error(`ENOENT: ${path}`)
      return f.text.slice(from)
    },
  }
  fs.add(initial)
  return fs
}
export type FakeFs = ReturnType<typeof fakeFs>

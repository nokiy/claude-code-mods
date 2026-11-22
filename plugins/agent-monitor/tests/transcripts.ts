// Fake subagent transcripts as Claude Code writes them under ~/.claude/projects/<slug>/<sessionId>/subagents/: one jsonl
// (`agent-<agentId>.jsonl`, first line a user line carrying sessionId / agentId / gitBranch) plus its meta file. Pure; shared by
// the transcript unit tests and the register-level suite (testkit.ts).
import { utf8Bytes } from '../hooks/transcript'

export type FakeUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
/** One assistant message: `id` repeats across lines of a streamed message, the last line holding the final usage; `effort` (top-level on the line) only when given. */
export type FakeStep = { id: string; model?: string; usage?: FakeUsage; at?: string; effort?: string }
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
  /** Hook refusals: tool_result text of a line carrying `toolDenialKind`, at `deniedAt` (10:02 by default). */
  denials?: string[]
  deniedAt?: string
  /** Errored tool results (`is_error`, no `toolDenialKind`): their text, at `erroredAt` (10:01:30 by default, before the refusals). */
  errors?: string[]
  erroredAt?: string
  /** Edit results (`toolUseResult` with `filePath` and the patch's lines), after the steps. */
  edits?: FakeEdit[]
}
/** One Edit tool result: the path and its patch lines (`+x`, `-y`, ` ctx`). */
export type FakeEdit = { path: string; lines: string[] }

const ids = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>) => ({ sessionId: a.sessionId, agentId: a.agentId, isSidechain: true, userType: 'external', version: '2.1.291' })
const usage = (u: FakeUsage = {}) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...u })

export const userLine = (a: FakeAgent) =>
  JSON.stringify({
    ...ids(a), parentUuid: null, type: 'user', timestamp: a.at ?? '2026-10-01T10:00:00.000Z', cwd: a.cwd ?? '/work/repo', gitBranch: a.branch ?? 'dev',
    message: { role: 'user', content: a.prompt ?? 'do the task' },
  })

export const assistantLine = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>, s: FakeStep, model = 'claude-opus-4-5') =>
  JSON.stringify({
    ...ids(a), type: 'assistant', timestamp: s.at ?? '2026-10-01T10:01:00.000Z', ...(s.effort === undefined ? {} : { effort: s.effort }),
    message: { id: s.id, role: 'assistant', model: s.model ?? model, usage: usage(s.usage), content: [{ type: 'text', text: 'ok' }] },
  })

export const denialLine = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>, text: string, at = '2026-10-01T10:02:00.000Z', kind = 'permission-rule') =>
  JSON.stringify({ ...ids(a), type: 'user', timestamp: at, toolDenialKind: kind, message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: text, tool_use_id: 'toolu_x' }] } })

export const errorLine = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>, text: string, at = '2026-10-01T10:01:30.000Z') =>
  JSON.stringify({ ...ids(a), type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', is_error: true, content: text, tool_use_id: 'toolu_e' }] } })

export const editLine = (a: Pick<FakeAgent, 'sessionId' | 'agentId'>, e: FakeEdit, at = '2026-10-01T10:01:10.000Z') =>
  JSON.stringify({
    ...ids(a), type: 'user', timestamp: at,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_d', content: 'The file has been updated.', is_error: false }] },
    toolUseResult: { type: 'update', filePath: e.path, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: e.lines }], originalFile: '', userModified: false },
  })

export const attachmentLine =(a: Pick<FakeAgent, 'sessionId' | 'agentId'>) =>
  JSON.stringify({ ...ids(a), type: 'attachment', timestamp: '2026-10-01T10:00:30.000Z', attachment: { type: 'hook_success' } })

/** Lines joined as a jsonl file: each line ends with a newline. */
export const jsonl = (lines: readonly string[]) => lines.map(l => `${l}\n`).join('')

/** The whole transcript of one agent: its first user line, its steps, its edit results, its errored results, then its refusals. */
export const agentTranscript = (a: FakeAgent) =>
  jsonl([
    userLine(a),
    ...(a.steps ?? [{ id: 'm1', usage: { input_tokens: 10, output_tokens: 5 } }]).map(s => assistantLine(a, s, a.model)),
    ...(a.edits ?? []).map(e => editLine(a, e)),
    ...(a.errors ?? []).map(e => errorLine(a, e, a.erroredAt)),
    ...(a.denials ?? []).map(d => denialLine(a, d, a.deniedAt)),
  ])

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

/** The most bytes one `$.fs.read` answers. */
export const MAX_READ = 4 * 1024 * 1024

/**
 * A transcript past one read: `before` steps, a filler line whose 3-byte character straddles the 4 MiB mark, a line longer than 4 MiB
 * (4-byte characters, the read that ends in it cutting one after its first byte), then `after` steps. The two long lines carry no timestamp, so a rollup of
 * the whole text gets nothing from them.
 */
export function bigTranscript(a: FakeAgent, before: readonly FakeStep[], after: readonly FakeStep[]): string {
  const head = jsonl([userLine(a), ...before.map(s => assistantLine(a, s, a.model))])
  const pre = '{"type":"progress","data":"'
  const pad = MAX_READ - utf8Bytes(head) - pre.length - 1 // the first 中 starts one byte before the mark
  const filler = `${pre}${'a'.repeat(pad)}${'中'.repeat(10)}"}`
  const long = `${pre}${'😀'.repeat(1_200_000)}"}`
  return head + jsonl([filler, long, ...after.map(s => assistantLine(a, s, a.model))])
}

/** A file's bytes `[offset, offset + length)` read as UTF-8 text: a character cut at either edge reads as U+FFFD, as the engine's. */
export type Range = { offset: number; length: number }

/**
 * A file system in memory: absolute path -> text, held as its UTF-8 bytes too. `mtime` bumps on every write. `tally` counts reads per
 * path, every ranged read, listings, and the most reads in flight at once (`wire` holds each read on `gate` while it is set).
 */
export function fakeFs(initial: Record<string, string> = {}) {
  const files = new Map<string, { text: string; bytes: Uint8Array; mtimeMs: number }>()
  let clock = 1_000
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const tally = { reads: new Map<string, number>(), ranges: [] as ({ path: string } & Range)[], lists: [] as string[], inFlight: 0, peak: 0 }
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1)
  const fs = {
    files,
    tally,
    /** While set, every read through `wire` waits for it. */
    gate: null as Promise<unknown> | null,
    write(path: string, text: string) { files.set(path, { text, bytes: enc.encode(text), mtimeMs: ++clock }) },
    append(path: string, text: string) { fs.write(path, (files.get(path)?.text ?? '') + text) },
    add(entries: Record<string, string>) { for (const [p, t] of Object.entries(entries)) fs.write(p, t) },
    reset() { Object.assign(tally, { inFlight: 0, peak: 0 }); tally.reads.clear(); tally.ranges.length = 0; tally.lists.length = 0 },
    /** Entries directly under `dir` (files and the directories that lead to deeper files); rejects when nothing is there. */
    list(dir: string) {
      tally.lists.push(dir)
      const pre = `${dir.replace(/\/$/, '')}/`
      const out = new Map<string, { name: string; kind: 'file' | 'dir'; size: number; mtimeMs: number; isLink: boolean }>()
      for (const [p, f] of files) {
        if (!p.startsWith(pre)) continue
        const [name, ...deeper] = p.slice(pre.length).split('/')
        if (!name) continue
        out.set(name, deeper.length ? { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false } : { name, kind: 'file', size: f.bytes.length, mtimeMs: f.mtimeMs, isLink: false })
      }
      if (out.size === 0) throw new Error(`ENOENT: ${dir}`)
      return [...out.values()]
    },
    /** `$.fs.read`: the whole text (refused past 4 MiB), or the text of a byte range (its length at most 4 MiB). */
    read(path: string, range?: Range) {
      bump(tally.reads, path)
      const f = files.get(path)
      if (!f) throw new Error(`ENOENT: ${path}`)
      if (!range) {
        if (f.bytes.length > MAX_READ) throw new Error(`too large: ${path}`)
        return f.text
      }
      tally.ranges.push({ path, ...range })
      if (range.length > MAX_READ) throw new Error(`range over 4 MiB: ${path}`)
      return dec.decode(f.bytes.subarray(range.offset, range.offset + range.length))
    },
  }
  fs.add(initial)
  return fs
}
export type FakeFs = ReturnType<typeof fakeFs>

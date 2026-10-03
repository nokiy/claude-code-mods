// Backfill for agent-monitor: agents the mod never saw spawn (dispatched before it loaded, or while a reload had the hooks down)
// are recovered from the main conversation: each Agent tool use names the agent, each task notification says how it ended.
// Pure; tested in backfill.test.ts.
import type { AgentMonitorRec } from '../types'
import { MAX_PROMPT, RESULT_LINES, clean, contentText } from './patches'
import type { AgentResult } from './patches'
import { clip, countsFromStats, firstLines, parseDescription } from './logic'

export type MsgUse = { tool: string; input: Record<string, unknown>; result?: unknown; isError?: true; agentId?: string }
export type Msg = { role: string; text: string; toolUses?: readonly MsgUse[] }
type Recs = Record<string, AgentMonitorRec>

const BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g
const tag = (s: string, t: string) => new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(s)?.[1]?.trim()
const num = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : undefined)

// One record per Agent tool use that started an agent, ended by the last task notification that names it.
export function recsFromMessages(msgs: readonly Msg[]): Recs {
  const out: Recs = {}
  for (const m of msgs) {
    for (const u of m.toolUses ?? []) {
      if (u.tool !== 'Agent') continue
      const res = (u.result && typeof u.result === 'object' ? u.result : {}) as AgentResult & { agentId?: string }
      const id = u.agentId ?? res.agentId
      if (!id) continue
      const desc = String(u.input.description ?? '')
      out[id] = clean({
        type: String(u.input.subagent_type ?? 'general-purpose'),
        desc,
        task: parseDescription(desc).task,
        prompt: typeof u.input.prompt === 'string' ? clip(u.input.prompt, MAX_PROMPT) : undefined,
        model: res.resolvedModel,
        steps: 0,
        watched: false,
        context: 0,
        output: 0,
        status: u.isError ? 'failed' : res.status === 'completed' ? 'done' : 'running',
        tokens: res.totalTokens,
        spent: res.usage ? { input: res.usage.input_tokens ?? 0, output: res.usage.output_tokens ?? 0, cacheRead: res.usage.cache_read_input_tokens ?? 0, cacheWrite: res.usage.cache_creation_input_tokens ?? 0 } : undefined,
        durationMs: res.totalDurationMs,
        editCount: res.toolStats?.editFileCount,
        toolCounts: res.toolStats ? countsFromStats(res.toolStats) : undefined,
        result: res.status === 'completed' ? firstLines(contentText(res.content), RESULT_LINES) || undefined : undefined,
      })
    }
    if (m.role !== 'user') continue
    for (const b of m.text.matchAll(BLOCK)) {
      const block = b[1] ?? ''
      const id = tag(block, 'task-id')
      const rec = id ? out[id] : undefined
      if (!id || !rec) continue
      const st = tag(block, 'status')
      const usage = block.slice(block.lastIndexOf('</result>')) // the result text may quote tags of its own
      const status = st === 'completed' ? 'done' : st === 'failed' || st === 'killed' || st === 'error' ? 'failed' : undefined
      const report = firstLines(block.slice(block.indexOf('<result>') + 8, Math.max(0, block.lastIndexOf('</result>'))), RESULT_LINES)
      if (status) out[id] = clean({ ...rec, status, tokens: num(tag(usage, 'subagent_tokens')) ?? rec.tokens, durationMs: num(tag(usage, 'duration_ms')) ?? rec.durationMs, result: report || rec.result })
    }
  }
  return out
}

// Add what the state lacks; let an end the conversation knows settle a record still running or unknown. Same object when nothing changed.
export function mergeBackfill(recs: Recs, found: Recs): Recs {
  let next: Recs | undefined
  for (const [id, f] of Object.entries(found)) {
    const r = recs[id]
    if (!r) (next ??= { ...recs })[id] = f
    else if ((r.status === 'running' || r.status === 'unknown') && (f.status === 'done' || f.status === 'failed')) {
      (next ??= { ...recs })[id] = clean({ ...r, status: f.status, tokens: r.tokens ?? f.tokens, spent: r.spent ?? f.spent, durationMs: r.durationMs ?? f.durationMs, editCount: r.editCount ?? f.editCount, toolCounts: r.toolCounts ?? f.toolCounts, prompt: r.prompt ?? f.prompt, result: r.result ?? f.result })
    }
  }
  return next ?? recs
}

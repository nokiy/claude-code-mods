// The hooks module of agent-monitor: tracks subagents from the engine's events, keeps the session state, and draws the band above the prompt and the /sub pane. The engine's `$` and the state atoms stay in this file (a validator follows them nowhere else); the decisions live in nav.ts, settings.ts and patches.ts.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentMonitorDraft, AgentMonitorRec, MainEdit, PrStat } from '../types'
import { alertLines, dueToasts } from './alertlines'
import { MAX_MAIN, editedPath, normPath, reasonOf } from './alerts'
import { DEFAULTS, readConfig, type Config } from './config'
import { groupByPr, statsByPr } from './groups'
import { historyRecs, projectDir, refreshProject, withHistory, type TxEntry } from './history'
import { inScope } from './logic'
import { CLOSED, pageStr, parseElementKey, parsePage, ringKeyOf, siteFlags, subEffects, type NavPatch, type Placement } from './nav'
import { agentLaunched, blank, clean, editDelta, onAgentResult, onComplete, onSpawn, onStep, onStepEnd, onToolEnd, onToolStart } from './patches'
import type { Mode } from './pages'
import { bandTree, panel } from './render'
import { configKey, draftFromConfig, saveEffects, toggleDraft, type SettingKey } from './settings'
import { refreshIndex, type PrCache, type PrIndex, type PrView } from './prindex'
import { pickLang, strings, type Strings } from './strings'
import { parseSubArg } from './subarg'
import { mergeBackfill, recsFromMessages } from './backfill'
import { buildViews, reconcile, seedRec, settled, withoutGhosts, type Board } from './views'

const PANE = 'sub'

// State in the session (`$.state`, typed by ../types/index.d.ts), so a hot reload keeps it: the records, the main loop's edits, and the panel's flags, page, focus ring, settings draft, placement, mode and open groups.
const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, {} as Record<string, AgentMonitorRec>)
const mainEdits = atom({ plugin: 'agent-monitor', key: 'mainEdits' } as const, [] as MainEdit[])
const historyOpen = atom({ plugin: 'agent-monitor', key: 'historyOpen' } as const, false)
const paneOpen = atom({ plugin: 'agent-monitor', key: 'paneOpen' } as const, false)
const view = atom({ plugin: 'agent-monitor', key: 'view' } as const, 'list')
const focusKey = atom({ plugin: 'agent-monitor', key: 'focusKey' } as const, null as string | null)
const ringKey = atom({ plugin: 'agent-monitor', key: 'ringKey' } as const, null as string | null)
const draft = atom({ plugin: 'agent-monitor', key: 'draft' } as const, null as AgentMonitorDraft | null)
const sessionPlacement = atom({ plugin: 'agent-monitor', key: 'sessionPlacement' } as const, null as Placement | null)
const mode = atom({ plugin: 'agent-monitor', key: 'mode' } as const, 'pr' as Mode)
const expanded = atom({ plugin: 'agent-monitor', key: 'expanded' } as const, {} as Record<string, boolean>)
const prStats = atom({ plugin: 'agent-monitor', key: 'prStats' } as const, {} as Record<string, PrStat>)

type Recs = Record<string, AgentMonitorRec>
let cfg: Config = DEFAULTS // the settings (plugin.json userConfig); a change in /config or on the settings page reloads the module, so register() sets it afresh
// The UI strings: the language option is read once per load (it needs the session's settings and LANG), English until then.
let langOption: unknown = 'auto'
let t: Strings = strings('en')
let langLoad: Promise<void> | undefined
const ensureLang = ($: EngineInterface) => (langLoad ??= (async () => {
  t = strings(pickLang(langOption, (await $.settings.read()).language, await $.env.get('LANG')))
})())

async function readNav($: EngineInterface) {
  const [v, f, r, d, band, pane, session, m, open] = await Promise.all([read($, view), read($, focusKey), read($, ringKey), read($, draft), read($, historyOpen), read($, paneOpen), read($, sessionPlacement), read($, mode), read($, expanded)])
  return { page: parsePage(v), focusKey: f, ringKey: r, draft: d, band, pane, session, mode: m, expanded: open }
}

async function writeNav($: EngineInterface, p: NavPatch) {
  if (p.page !== undefined) await update($, view, () => p.page ?? 'list')
  if (p.focusKey !== undefined) await update($, focusKey, () => p.focusKey ?? null)
  if (p.ringKey !== undefined) await update($, ringKey, () => p.ringKey ?? null)
  if (p.draft !== undefined) await update($, draft, () => p.draft ?? null)
  if (p.band !== undefined) await update($, historyOpen, () => p.band ?? false)
  if (p.pane !== undefined) await update($, paneOpen, () => p.pane ?? false)
  if (p.session !== undefined) await update($, sessionPlacement, () => p.session ?? null)
}

// Read-modify-write one record. An agent with no record yet starts one only when `$.agent.list()` names it or `spawned` says the engine just started it (an engine fork or workflow agent is no subagent: no row). Returns whether a record was written.
async function track($: EngineInterface, id: string, fn: (r: AgentMonitorRec) => AgentMonitorRec, spawned = false): Promise<boolean> {
  const known = (await read($, agents))[id] !== undefined
  const seed = known || spawned ? undefined : seedRec((await $.agent.list()).find(a => a.id === id))
  if (!known && !spawned && !seed) return false
  await update($, agents, (all: Recs) => ({ ...all, [id]: clean(fn({ ...(all[id] ?? seed ?? blank()) })) }))
  return true
}

async function loadBoard($: EngineInterface): Promise<Board> {
  const views = buildViews(withHistory(await read($, agents), history), await $.agent.list(), await $.clock.now(), { stallMs: cfg.stallMs, main: await read($, mainEdits), prices: cfg.prices })
  return { views, cwd: await $.session.cwd(), cfg, t, prs: prView }
}

// A main-loop edit takes part in conflicts only while a subagent runs, so it is kept only then.
async function noteMainEdit($: EngineInterface, path: string, now: number) {
  if (!Object.values(await read($, agents)).some(r => r.status === 'running')) return
  await update($, mainEdits, (m: MainEdit[]) => [...m, { path, at: now }].slice(-MAX_MAIN))
}

// Persist the end of records the engine no longer runs (a stale `running` would keep the timer alive); drop undescribed leftovers.
async function settleStale($: EngineInterface) {
  const recs = await read($, agents)
  const stale = reconcile(recs, await $.agent.list())
  if (stale.length === 0 && withoutGhosts(recs) === recs) return
  const now = await $.clock.now()
  await update($, agents, (all: Recs) => settled(all, new Map(stale), now))
}

// Subagents of every session of this project come from their transcripts (history.ts): the entries live in this load and, with their read positions, in the store. `current`: only this session's folder (the 1 s tick), else the whole project directory.
const txCache = new Map<string, TxEntry>()
let history: Recs = {}
async function readHistory($: EngineInterface, current = false) {
  try {
    const project = projectDir((await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${await $.env.get('HOME')}/.claude`, await $.session.root())
    const tail = async (path: string, from: number) => ((r) => ({ text: r.stdout, truncated: r.isStdoutTruncated }))(await $.process.run(['tail', '-c', `+${from + 1}`, path]))
    const io = { list: (p: string) => $.fs.list(p), read: (p: string) => $.fs.read(p), tail, load: (k: string) => $.store.get(k), save: (k: string, v: TxEntry) => $.store.set(k, v) }
    if (!(await refreshProject(io, project, txCache, current ? await $.session.id() : undefined))) return
    history = historyRecs(txCache)
    $.ui.invalidate('ui.render')
  } catch { /* no transcript readable now: the live records still stand */ }
}

const prCache: PrCache = {} // the PR index (prindex.ts: `gh pr list` on an interval, last good kept in the store) and the session's branch, for the PR mode
let prView: PrView = { prs: [] }
async function refreshPrs($: EngineInterface) {
  const io = { run: (a: string[]) => $.process.run(a), load: (k: string) => $.store.get(k), save: (k: string, v: PrIndex) => $.store.set(k, v) }
  prView = await refreshIndex(io, prCache, await $.clock.now())
  await publish($)
  $.ui.invalidate('ui.render')
}

// The per-PR subagent totals other mods read (docs/adr/0001-cross-mod-state.md), written only when they change: each write redraws the readers.
async function publish($: EngineInterface, views?: Board['views']) {
  const next = statsByPr(groupByPr(views ?? (await loadBoard($)).views, prView.prs))
  if (JSON.stringify(next) !== JSON.stringify(await read($, prStats))) await update($, prStats, () => next)
}

// Agents the mod never saw spawn come back from the main conversation (its Agent tool uses and task notifications), earlier ones from the transcripts.
async function backfill($: EngineInterface) {
  await Promise.all([readHistory($), refreshPrs($)])
  try {
    const found = recsFromMessages(await $.session.messages())
    const recs = await read($, agents)
    if (mergeBackfill(recs, found) !== recs) await update($, agents, (all: Record<string, AgentMonitorRec>) => mergeBackfill(all, found))
  } catch { /* the conversation is not readable now: the live records still stand */ }
  await publish($)
}

// One tick a second while an agent runs; one toast per agent per conflict / stall (`warned:<agentId>:<kind>` in the store, `told` its memory in this load).
const told = new Set<string>()
async function warn($: EngineInterface, board: Board) {
  for (const d of cfg.toasts ? dueToasts(alertLines(board.views, board.cwd, t), told) : []) {
    const seen = (await Promise.all(d.keys.map(k => $.store.get(k)))).every(Boolean)
    if (!seen) await Promise.all(d.keys.map(k => $.store.set(k, true)))
    for (const k of d.keys) told.add(k)
    if (!seen) $.ui.toast(d.text, { timeoutMs: 8000 })
  }
}

let timer:{ cancel: () => void } | undefined
function stopTimer() {
  try {
    timer?.cancel()
  } catch { /* already gone */ }
  timer = undefined
}

function ensureTimer($: EngineInterface) {
  timer ??= $.clock.every(1000, async () => {
    try {
      await Promise.all([settleStale($), readHistory($, true)])
      const board = await loadBoard($)
      await Promise.all([warn($, board), publish($, board.views)])
      if (!board.views.some(v => v.status === 'running')) stopTimer()
      $.ui.invalidate('ui.render')
    } catch { stopTimer() } // a later event starts a fresh timer
  })
}

// The /sub command (`/subs` if the host refuses the first) and the panel's buttons; the decisions are nav.ts's and settings.ts's.
let commandName: string | undefined
async function ensureCommand($: EngineInterface) {
  for (const name of commandName ? [] : ['sub', 'subs']) {
    try {
      await $.command.register({ name, description: t.commandDescription, argumentHint: 'top | right | set', immediate: true })
      commandName = name
      return
    } catch { /* name refused: try the next */ }
  }
}

const paneUp =async ($: EngineInterface) => (await $.ui.panes()).some(p => p.id === PANE)
const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: t.paneTitle, focus: true, closeOnEscape: true })

// Put the panel at `where` (`right`: the pane, `top`: the band above the prompt; null: down), taking it from the other place.
async function setSite($: EngineInterface, where: Placement | null) {
  await writeNav($, siteFlags(where))
  if (where === 'right') await openPane($)
  else if (await paneUp($)) await $.ui.close({ id: PANE })
}

// `/sub` shows the panel (or steps back to the table, or closes it), `/sub top|right` places it, `/sub set` opens the settings page.
async function runSub($: EngineInterface, args: string): Promise<{ text?: string }> {
  const nav = await readNav($)
  const fx = subEffects(parseSubArg(args), { ...nav, pane: await paneUp($), last: await $.store.get('lastPlacement'), mode: cfg.placement, cfg })
  if (fx.text) return { text: fx.text }
  if (fx.close) await setSite($, null)
  else {
    await backfill($)
    if (fx.last) await $.store.set('lastPlacement', fx.last)
    await writeNav($, fx.nav)
    if (fx.move) await setSite($, fx.move)
  }
  return {}
}

// Write the draft's changed rows to the settings in one go (the module reloads with them), the state first: the reload may cut what follows.
async function saveSettings($: EngineInterface) {
  const fx = saveEffects((await readNav($)).draft, cfg)
  await writeNav($, fx.nav)
  if (fx.writes.length === 0) return
  const rows = await $.config.list()
  const done = await Promise.all(fx.writes.map(w => $.config.set({ key: configKey(rows, w.field), value: w.value }).catch((e: unknown) => ({ deny: String(e) }))))
  const denied = done.find(r => r.deny !== undefined)
  if (denied?.deny) $.ui.toast(t.notSaved(denied.deny), { timeoutMs: 8000 })
}

function actsOf($: EngineInterface) {
  return {
    open: (id: string) => void writeNav($, { page: pageStr({ kind: 'detail', id }) }),
    back: () => void writeNav($, { page: 'list', draft: null }),
    settings: () => void writeNav($, { page: 'settings', draft: draftFromConfig(cfg) }),
    close: () => void setSite($, null),
    toggle: (key: SettingKey) => void update($, draft, (d: AgentMonitorDraft | null) => (d ? toggleDraft(d, key) : d)),
    save: () => void saveSettings($),
    mode: (m: Mode) => void update($, mode, () => m),
    fold: (key: string, open: boolean) => void update($, expanded, (x: Record<string, boolean>) => ({ ...x, [key]: open })),
  }
}

// What a site draws from; a running agent keeps the timer going.
async function screen($: EngineInterface) {
  const [nav, board] = await Promise.all([readNav($), loadBoard($)])
  if (board.views.some(v => v.status === 'running')) ensureTimer($)
  return { nav, board }
}

// The mod acts everywhere, or only when the session cwd is inside the `scope` setting (session.start says, else the first hook asks). Every hook goes through `active`, so the language is read before anything is drawn.
let scoped: boolean | undefined
const active = async ($: EngineInterface) => {
  await ensureLang($)
  return (scoped ??= inScope(await $.session.cwd(), cfg.scope))
}

let backfilled = false
let priceToasted = false
export const register: Register = (on, options) => {
  cfg = readConfig(options)
  langOption = options.language
  langLoad = undefined
  t = strings('en')
  on('session.start', async ($, e, next) => {
    await ensureLang($)
    scoped = inScope(e.cwd, cfg.scope)
    if (scoped) {
      await ensureCommand($)
      if ((await $.store.get('placement')) != null) await $.store.delete('placement') // the old remembered placement: `lastPlacement` replaces it
      if (await read($, paneOpen)) { // a reload: the pane the state says is open comes back holding the keyboard, the ring where it was
        await openPane($)
        const key = await read($, focusKey)
        if (key) await $.ui.focus({ requestId: PANE, key }).catch(() => ({}))
      }
    }
    return next(e)
  })
  on('turn.start', async ($, e, next) => {
    if (await active($)) {
      await ensureCommand($) // a hot reload may have dropped it
      void (backfilled ? refreshPrs($) : backfill($)) // backfill once per load, not holding the turn (a first scan reads every transcript); /sub backfills again; later turns refresh the PR index when due
      backfilled = true
      if (cfg.pricesBad && !priceToasted) { priceToasted = true; $.ui.toast(t.pricesBad, { timeoutMs: 8000 }) }
    }
    return next(e)
  })
  on('session.end', async ($, e, next) => {
    if (!(await active($))) return next(e)
    stopTimer()
    if (e.reason === 'clear') {
      await Promise.all([update($, agents, () => ({})), update($, mainEdits, () => []), writeNav($, { ...CLOSED, session: null })])
      told.clear()
      for (const k of await $.store.keys()) if (k.startsWith('warned:')) await $.store.delete(k)
    }
    return next(e)
  })
  for (const command of ['sub', 'subs']) on('command.run', { command }, async ($, e, next) => ((await active($)) ? runSub($, e.args) : next(e)))
  // The ring moved onto a row's or group's Button: remembered (focusKey), so a page change can put it back. Every move in our pane or band, onto any element or off all of them, is written to ringKey, which drives the selected-row highlight.
  on('ui.focus', async ($, e, next) => {
    const kind = parseElementKey(e.element)?.kind
    if ((kind === 'row' || kind === 'group') && (await read($, focusKey)) !== e.element) await update($, focusKey, () => e.element ?? null)
    if (e.requestId === PANE || e.component === 'AbovePrompt') {
      const key = ringKeyOf(e)
      if ((await read($, ringKey)) !== key) {
        await update($, ringKey, () => key)
        $.ui.invalidate('ui.render')
      }
    }
    return next(e)
  })
  on('ui.close', async ($, e, next) => (e.id === PANE && e.origin.kind !== 'unload' && (await Promise.all([update($, paneOpen, () => false), update($, ringKey, () => null)])), next(e)))
  // agent.spawn resolves with the new agentId: the id every later turn.step / tool.call carries.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (!(await active($)) || !r.agentId) return r
    const now = await $.clock.now()
    await track($, r.agentId, p => onSpawn(p, e, r.model, now), true)
    ensureTimer($)
    $.ui.invalidate('ui.render')
    return r
  })
  // Model, effort and token usage come from a subagent's own steps (agentId is absent on main).
  on('turn.step', async function* ($, e, next) {
    if (!(await active($))) return yield* next(e)
    const id = e.agentId
    const now = await $.clock.now()
    const tracked = id ? await track($, id, p => onStep(p, e, now)) : false
    if (tracked) ensureTimer($)
    const result = yield* next(e)
    if (id && tracked) {
      const u = result.usage
      const done = await $.clock.now()
      await track($, id, p => onStepEnd(p, u ?? undefined, done))
    }
    return result
  })
  on('tool.call', async ($, e, next) => {
    if (!(await active($))) return next(e)
    const id = e.agentId
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const path = editedPath(tool, input)
    const file = path ? normPath(path, await $.session.cwd()) : undefined
    const now = await $.clock.now()
    if (!id && file) await noteMainEdit($, file, now)
    // pendingTool is set before the call runs and cleared once it returns (or throws); the result says whether it was refused.
    const tracked = id ? await track($, id, p => onToolStart(p, tool, input, file, now, t)) : false
    let r: Awaited<ReturnType<typeof next>> | undefined
    try {
      r = await next(e)
    } finally {
      if (id && tracked) {
        const done = await $.clock.now()
        const hookDenied = (r as { deny?: string } | undefined)?.deny !== undefined
        await track($, id, p => onToolEnd(p, tool, reasonOf(r), done, editDelta(file, r), hookDenied))
      }
    }
    const launched = agentLaunched(e, r as { result?: unknown; isError?: boolean })
    if (launched) {
      const at = await $.clock.now()
      await track($, launched.res.agentId, p => onAgentResult(p, launched.call, launched.res, at), true)
      $.ui.invalidate('ui.render')
    }
    return r
  })
  on('turn.complete', async ($, e, next) => {
    if (!(await active($)) || !e.agentId) return next(e) // the main loop's turn ends no subagent
    const now = await $.clock.now()
    if (await track($, e.agentId, p => onComplete(p, e.reason, now))) $.ui.invalidate('ui.render')
    return next(e)
  })
  // The band above the prompt: the panel while `/sub top` is open, else the running agents, one row each.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!(await active($)) || e.props.hasSurvey) return next(e)
    const { nav, board } = await screen($)
    const rest = await next(e) // whatever the rest of the chain draws (e.g. usage-band) goes under our rows
    return bandTree($.ui.resolve(e), board, e.props, nav.band, { ...nav, esc: false }, actsOf($), rest) ?? rest
  })
  // The /sub pane (`/sub right`): the same panel, docked by the engine.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (!(await active($))) return next(e)
    const { nav, board } = await screen($)
    return panel($.ui.resolve(e), board, { ...nav, esc: true }, e.props.bodyColumns, actsOf($))
  })
}

/**
 * dsh-refine — host half.
 *
 * UX layer over the dsh-continual-harness engine (optional at runtime):
 * - `/refine` human command: status / list / history / rollback / trigger.
 * - `refineUx` Typert Remote namespace (`data` / `rollback`) for the client panel.
 * - Reads the engine's ESP files (harness_state.json, refinements.jsonl,
 *   reviews.jsonl) under dshHomePath('harness'); triggers refinement by
 *   dispatching the engine-registered `harness_refine` tool. The engine not
 *   being mounted degrades every trigger path to an actionable message.
 * - Reader compat: registers the engine's `harness/refinement` session event
 *   in the host reader's known-type vocabulary (see `./compat.js`), or every
 *   session that commits a refinement becomes unreadable (history/resume
 *   refuse with SessionFormatUnsupportedError on stock dsh).
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { engineEventCompat, registerKnownSessionEventTypes } from './compat.js'

// Register before this plugin (and the persistence reader) serves anything:
// awaited at module load so no session-log read can race the registration.
await registerKnownSessionEventTypes()

/**
 * Apply one `@Remote(method)` marker without decorator syntax: the shim
 * mimics the decorator context `addMarkerInitializer` expects, and the
 * initializer marks the prototype exactly like a real decorator would.
 */
function markRemoteMethod(prototype, method) {
  const decorator = Remote(method)
  decorator(undefined, {
    name: method,
    private: false,
    static: false,
    addInitializer(fn) { fn.call(Object.create(prototype)) },
  })
}

export const REFINE_UX_VERSION = '0.1.0'
const KINDS = ['prompt', 'memory', 'skill', 'subagent']

export function apply(ctx) {
  const commands = ctx.get('commands')
  const fs = ctx.get('fs')
  const tools = ctx.get('tools')
  const HARNESS_ROOT = dshHomePath('harness')
  let seq = 0
  if (!engineEventCompat.registered) {
    try {
      ctx.logger('refine').warn('engine session-event compat not registered: ' + engineEventCompat.reason)
    } catch { /* logger unavailable in minimal hosts */ }
  }

  async function readJson(rel) {
    if (fs === undefined) return undefined
    try {
      const target = await fs.resolve(HARNESS_ROOT + rel)
      return JSON.parse(await fs.readText(target))
    } catch { return undefined }
  }

  async function readJsonl(rel, limit) {
    if (fs === undefined) return []
    try {
      const target = await fs.resolve(HARNESS_ROOT + rel)
      const text = await fs.readText(target)
      const out = []
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try { out.push(JSON.parse(line)) } catch { /* 坏行跳过，与引擎一致 */ }
      }
      return limit === undefined ? out : out.slice(-limit)
    } catch { return [] }
  }

  function entrySummary(e) {
    if (e === null || typeof e !== 'object') return null
    return {
      id: typeof e.id === 'string' ? e.id : '?',
      kind: typeof e.kind === 'string' ? e.kind : '?',
      title: typeof e.title === 'string' ? e.title : (typeof e.id === 'string' ? e.id : '?'),
      version: typeof e.version === 'number' ? e.version : 1,
      scope: e.scope === 'local' ? 'local' : 'global',
      pinned: !!(e.metadata && e.metadata.pinned === true),
      archived: !!(e.metadata && e.metadata.lifecycleState === 'archived'),
      updatedAt: typeof e.updatedAt === 'string' ? e.updatedAt : '',
      content: typeof e.content === 'string' ? e.content.slice(0, 400) : '',
    }
  }

  async function collectData() {
    const state = await readJson('/harness_state.json')
    const history = await readJsonl('/refinements.jsonl')
    const reviews = await readJsonl('/reviews.jsonl', 30)
    const entries = { prompt: [], memory: [], skill: [], subagent: [] }
    if (state !== undefined && state !== null && typeof state === 'object'
      && state.entries && typeof state.entries === 'object') {
      for (const kind of KINDS) {
        const records = state.entries[kind]
        if (records === null || typeof records !== 'object') continue
        for (const id of Object.keys(records)) {
          const s = entrySummary(records[id])
          if (s !== null) entries[kind].push(s)
        }
      }
      for (const kind of KINDS) entries[kind].sort((a, b) => (a.id < b.id ? -1 : 1))
    }
    let engineActive = false
    try { engineActive = tools !== undefined && tools.get('harness_refine') !== undefined } catch { engineActive = false }
    return {
      engineActive,
      hasState: state !== undefined,
      root: HARNESS_ROOT,
      uxVersion: REFINE_UX_VERSION,
      entries,
      history: history.slice(-20).reverse().map((r) => {
        if (r === null || typeof r !== 'object') return null
        const edits = Array.isArray(r.appliedEdits) ? r.appliedEdits : []
        const out = {
          id: typeof r.id === 'string' ? r.id : '?',
          summary: typeof r.summary === 'string' ? r.summary.slice(0, 200) : '',
          scope: r.scope === 'global' ? 'global' : 'local',
          applied: edits.filter((x) => x && x.applied === true).length,
          total: edits.length,
          committedAt: typeof r.committedAt === 'string' ? r.committedAt : '',
        }
        // Omitted rather than set to undefined: the Typert Gateway rejects a
        // business result carrying an own property whose value is undefined.
        if (typeof r.rollbackOf === 'string') out.rollbackOf = r.rollbackOf
        return out
      }).filter((x) => x !== null),
      reviews: reviews.slice(-10).reverse().map((r) => {
        if (r === null || typeof r !== 'object') return null
        return {
          at: typeof r.timestamp === 'string' ? r.timestamp : '',
          trigger: typeof r.trigger === 'string' ? r.trigger : '',
          outcome: typeof r.outcome === 'string' ? r.outcome : '?',
          rationale: typeof r.rationale === 'string' ? r.rationale.slice(0, 160) : '',
        }
      }).filter((x) => x !== null),
    }
  }

  function safeDetail(result) {
    if (result === null || typeof result !== 'object') return String(result)
    const out = {}
    for (const k of ['ok', 'value', 'result', 'error', 'summary', 'refinement_id', 'applied', 'failed', 'scope']) {
      const v = result[k]
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v
    }
    return out
  }

  /**
   * Dispatch one engine tool call. `signal` threads the caller's cancellation
   * (the command invocation's signal); the tools registry reads
   * `exec.signal.aborted` unguarded (callerCancelled), so a missing signal
   * rejects with `Cannot read properties of undefined (reading 'aborted')` -
   * callers without a signal get a fresh never-aborted one.
   */
  /** Engine-not-mounted refusal shared by every dispatch path. */
  function engineMissingError() {
    return { ok: false, error: '引擎未挂载：把 dsh-continual-harness 装入本 profile 并重启 dsh（面板见 设置 → 精炼 Harness）' }
  }

  /** Resolve the active agent for engine dispatch; undefined when none. */
  function resolveAgent() {
    // Resolved per call: `agents` may register after this plugin applies.
    try {
      const agents = ctx.get('agents')
      if (agents !== undefined) { const roots = agents.roots(); return roots.length > 0 ? roots[0] : undefined }
    } catch { /* agents service unavailable */ }
    return undefined
  }

  /**
   * Dispatch one engine tool call. `signal` threads the caller's cancellation
   * (the command invocation's signal); the tools registry reads
   * `exec.signal.aborted` unguarded (callerCancelled), so a missing signal
   * rejects with `Cannot read properties of undefined (reading 'aborted')` -
   * callers without a signal get a fresh never-aborted one.
   */
  async function runEngine(args, signal) {
    if (tools === undefined || tools.get('harness_refine') === undefined) return engineMissingError()
    const agent = resolveAgent()
    if (agent === undefined) return { ok: false, error: '没有活跃的 agent 会话' }
    try {
      const result = await tools.execute({
        callId: 'dsh-refine-' + Date.now() + '-' + (++seq),
        name: 'harness_refine',
        arguments: args,
        agent,
        signal: signal ?? new AbortController().signal,
      })
      return { ok: true, detail: safeDetail(result) }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  /**
   * Fire-and-forget engine trigger for `/refine <instructions>`.
   *
   * The refinement runs an LLM planner and easily takes minutes; awaiting it
   * inside the command handler froze the composer's submit transaction (the
   * input box could not clear or be edited until command/done landed). This
   * path validates synchronously, dispatches in the background, and acks
   * immediately - the outcome lands in the panel history timeline and
   * `/refine history`. The background call deliberately owns a FRESH
   * never-aborted signal: the invocation's request signal may abort once the
   * RPC response completes, which would cancel the in-flight refinement.
   */
  function triggerEngine(args) {
    if (tools === undefined || tools.get('harness_refine') === undefined) return engineMissingError()
    const agent = resolveAgent()
    if (agent === undefined) return { ok: false, error: '没有活跃的 agent 会话' }
    void (async () => {
      try {
        const result = await tools.execute({
          callId: 'dsh-refine-' + Date.now() + '-' + (++seq),
          name: 'harness_refine',
          arguments: args,
          agent,
          signal: new AbortController().signal,
        })
        if (result !== null && typeof result === 'object' && result.isError === true) {
          logWarn('后台精炼返回错误: ' + resultText(result))
        }
      } catch (e) {
        logWarn('后台精炼失败: ' + String((e && e.message) || e))
      }
    })()
    return { ok: true }
  }

  /** Best-effort warn through the host logger; never throws. */
  function logWarn(text) {
    try { ctx.logger('refine').warn(text) } catch { /* logger unavailable in minimal hosts */ }
  }

  /** Flatten one tool result into a short loggable string. */
  function resultText(result) {
    const error = result && typeof result === 'object' ? result.error : undefined
    if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
    const content = result && typeof result === 'object' ? result.content : undefined
    if (Array.isArray(content) && content.length > 0 && typeof content[0].text === 'string') return content[0].text
    return String(result)
  }

  /**
   * `refineUx` Remote namespace consumed by the settings panel over the
   * client Connection RPC carrier (`/api`, endpoint `refineUx/<method>`).
   * Source-mode descriptors: one JSON `request` parameter per method.
   */
  class RefineUxRemote extends TypertRemoteService {
    constructor(c) { super(c, 'refineUx') }

    async data(request) {
      return collectData()
    }

    async rollback(request) {
      const r = request === null || typeof request !== 'object' ? {} : request
      const id = typeof r.id === 'string' ? r.id : ''
      if (!id) return { ok: false, error: 'missing id' }
      return runEngine({ rollback_id: id })
    }
  }
  for (const m of ['data', 'rollback']) markRemoteMethod(RefineUxRemote.prototype, m)
  new RefineUxRemote(ctx)

  async function statusText() {
    const d = await collectData()
    const counts = KINDS.map((k) => k + ':' + d.entries[k].length).join('  ')
    const last = d.history[0]
    const lines = [
      'Continual Harness 状态（' + (d.engineActive ? '引擎已挂载' : '引擎未挂载') + '）',
      '条目  ' + counts,
      '精炼历史  ' + d.history.length + ' 条（/refine history 查看）',
      last ? '最近  ' + last.id + ' ' + last.summary + '（' + last.applied + '/' + last.total + ' 应用）' : '最近  （无）',
      '状态目录  ' + d.root,
      '',
      '用法  /refine <instructions> 触发 · /refine list [kind] · /refine history [n] · /refine rollback <id>',
      '面板  设置 → 精炼 Harness（条目浏览 / 历史时间线 / 一键回滚）',
    ]
    return { kind: 'success', text: lines.join('\n') }
  }

  async function listText(kind) {
    if (kind && KINDS.indexOf(kind) === -1) return { kind: 'error', text: '未知 kind: ' + kind + '（可选 ' + KINDS.join('/') + '）' }
    const d = await collectData()
    const kinds = kind ? [kind] : KINDS
    const lines = []
    for (const k of kinds) {
      const list = d.entries[k]
      lines.push('[' + k + '] ' + list.length + ' 条')
      for (const e of list.slice(0, 12)) {
        lines.push('  ' + (e.scope === 'local' ? 'local:' : 'global:') + e.id + '  v' + e.version
          + (e.pinned ? ' 📌' : '') + (e.archived ? ' [归档]' : '') + '  ' + (e.title || ''))
      }
      if (list.length > 12) lines.push('  …共 ' + list.length + ' 条')
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  async function historyText(n) {
    const d = await collectData()
    if (d.history.length === 0) return { kind: 'success', text: '暂无精炼记录' }
    const lines = []
    for (const h of d.history.slice(0, n)) {
      lines.push(h.id + '  ' + (h.scope || '') + '  ' + h.applied + '/' + h.total + ' 应用'
        + (h.rollbackOf ? '  rollback→' + h.rollbackOf : ''))
      lines.push('  ' + (h.summary || ''))
      lines.push('  ' + (h.committedAt || ''))
    }
    return { kind: 'success', text: lines.join('\n') }
  }

  if (commands !== undefined) {
    ctx.effect(() => commands.register({
      name: 'refine',
      description: '查看/触发 continual harness 精炼（dsh-refine）',
      input: { hint: '[status|list [kind]|history [n]|rollback <id>|<instructions>]' },
      handler: async (inv) => {
        const raw = typeof inv.rawInput === 'string' ? inv.rawInput.trim() : ''
        const lower = raw.toLowerCase()
        // `inv.signal` is the UI request's cancellation; the engine tool call
        // inherits it so an aborted command also aborts its refinement.
        const signal = inv.signal
        try {
          if (raw === '' || lower === 'status' || lower === 'help') return statusText()
          if (lower === 'list' || lower.indexOf('list ') === 0) {
            return listText(raw.slice(4).trim().toLowerCase())
          }
          if (lower === 'history' || lower.indexOf('history ') === 0) {
            const n = parseInt(raw.slice(7).trim(), 10)
            return historyText(Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 10)
          }
          if (lower.indexOf('rollback') === 0) {
            const id = raw.slice(8).trim()
            if (!id) return { kind: 'error', text: '用法: /refine rollback <refinement-id>（id 见 /refine history）' }
            // Rollback applies stored edits with no LLM round-trip - fast
            // enough to stay synchronous so its outcome is the command result.
            const r = await runEngine({ rollback_id: id }, signal)
            if (!r.ok) return { kind: 'error', text: r.error }
            return { kind: 'success', text: '已回滚 ' + id + '。' }
          }
          // A trigger runs the planner LLM (minutes); it is dispatched in the
          // background so the composer's submit transaction - which freezes
          // the input until command/done - settles immediately.
          const r = triggerEngine({ instructions: raw })
          if (!r.ok) return { kind: 'error', text: r.error }
          return { kind: 'success', text: '已触发精炼（后台运行中，结果见 设置 → 精炼 Harness 或 /refine history）：' + raw }
        } catch (e) {
          return { kind: 'error', text: '/refine 失败: ' + String((e && e.message) || e) }
        }
      },
    }))
  }
}

/**
 * Wait for the host services this plugin reads before apply() runs. Without
 * this, apply() executes during boot before `commands`/`tools` exist and the
 * `/refine` command plus the Remote namespace would silently never register.
 * `agents` stays out of the list and is resolved per call, so a profile that
 * registers it later still drives the engine.
 */
export const inject = ['fs', 'commands', 'tools']

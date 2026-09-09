/**
 * dsh-refine — host half.
 *
 * UX layer over the dsh-continual-harness engine (optional at runtime):
 * - `/refine` human command: status / list / history / rollback / trigger.
 *   The engine owns `/refine` since dsh-continual-harness 0.3.0 (it registers
 *   the same name itself); when it is mounted we defer the command to it and
 *   keep the settings panel as the wrapper's value-add.
 * - `refineUx` Typert Remote namespace (`data` / `rollback`) for the client panel.
 * - Reads the engine's ESP files (harness_state.json, refinements.jsonl,
 *   reviews.jsonl) under dshHomePath('harness'); triggers refinement by
 *   dispatching the engine-registered `harness_refine` tool. The engine not
 *   being mounted degrades every trigger path to an actionable message.
 * - Reader compat: registers the engine's `harness/refinement` session event
 *   in the host reader's known-type vocabulary (see `./compat.js`) so sessions
 *   committed by older engine builds stay readable. As of 0.3.0 the engine no
 *   longer writes that event and registers the type itself; dsh-refine's
 *   registration is kept as an idempotent defensive fallback.
 */
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  engineEventCompat,
  installSessionEventsShim,
  registerKnownSessionEventTypes,
  sessionEventsCompat,
} from './compat.js'
import { engineMountStatus, mountEngine } from './engine.js'

// Register before this plugin (and the persistence reader) serves anything:
// awaited at module load so no session-log read can race the registration, and
// the engine's `session.events` projection read is bridged before any turn.
await Promise.all([
  registerKnownSessionEventTypes(),
  installSessionEventsShim(),
])

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

export const REFINE_UX_VERSION = '0.2.0'
const KINDS = ['prompt', 'memory', 'skill', 'subagent']

export function apply(ctx, config) {
  const commands = ctx.get('commands')
  const fs = ctx.get('fs')
  const tools = ctx.get('tools')
  const cfg = config !== null && typeof config === 'object' ? config : {}
  // Engine row config, passed straight through to dsh-continual-harness and
  // validated by its own schema when Cordis starts it.
  const engineConfig = typeof cfg.engine === 'object' && cfg.engine !== null ? cfg.engine : {}
  // Opt out of the shell's own engine mount. Defaults to on (the 套壳 layout);
  // set false in a legacy profile that still lists `dsh-continual-harness` as
  // its own bundle row, or to run this package as a pure read-only panel.
  const shouldMountEngine = cfg.mountEngine !== false
  const HARNESS_ROOT = dshHomePath('harness')
  let seq = 0
  if (!engineEventCompat.registered) {
    try {
      ctx.logger('refine').warn('engine session-event compat not registered: ' + engineEventCompat.reason)
    } catch { /* logger unavailable in minimal hosts */ }
  }
  if (sessionEventsCompat.shimmed === false && sessionEventsCompat.reason !== 'host Session already exposes events') {
    try {
      ctx.logger('refine').warn('engine session.events shim not installed: ' + sessionEventsCompat.reason)
    } catch { /* logger unavailable in minimal hosts */ }
  }

  // The shell mounts its own engine (see ./engine.js): `commands` is isolated
  // for the child so the engine's built-in /refine adapter stays unregistered
  // and this package keeps the command. Awaited nowhere — a slow or missing
  // engine must not delay the panel or the command registration, and every
  // dispatch path already probes `harness_refine` before using it.
  if (shouldMountEngine) {
    void mountEngine(ctx, { config: engineConfig, tools, warn: logWarn })
  } else {
    engineMountStatus.reason = 'mountEngine disabled by config'
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
    const engineActive = engineMounted()
    return {
      engineActive,
      // True when this wrapper started the engine itself (the 套壳 layout);
      // false means a legacy profile still mounts it as its own bundle row.
      engineOwned: engineMountStatus.mounted === true,
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

  /** True when the engine's model tool is mounted on this profile. */
  function engineMounted() {
    try { return tools !== undefined && tools.get('harness_refine') !== undefined } catch { return false }
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

    // SRC-mode wire contract: the gateway maps the *parameter name* to the
    // wire field, so it must stay exactly `request` — an `_`-prefixed unused
    // parameter renames the field and the panel's `{ request: null }` envelope
    // fails with "unexpected request" at the arguments boundary.
    async data(request) {
      void request
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
      'Continual Harness 状态（' + (d.engineActive
        ? '引擎已挂载' + (d.engineOwned ? '，由 dsh-refine 托管' : '，由 profile 单独挂载')
        : '引擎未挂载' + (engineMountStatus.reason ? '：' + engineMountStatus.reason : '')) + '）',
      '条目  ' + counts,
      '精炼历史  ' + d.history.length + ' 条（/refine history 查看）',
      last ? '最近  ' + last.id + ' ' + last.summary + '（' + last.applied + '/' + last.total + ' 应用）' : '最近  （无）',
      '状态目录  ' + d.root,
      '',
      '用法  /refine <instructions> [--global|--local] 触发 · /refine list [kind] · /refine history [n] · /refine rollback <id> [--global|--local]',
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

  /**
   * Split the engine's scope flags out of a raw command tail.
   *
   * The engine's own `/refine` accepts `--global` / `--local` on both plan and
   * rollback, and its `harness_refine` tool takes the same choice as a boolean
   * `global`. Neither flag present leaves `global` unset, which the tool
   * documents as "the deployment default" — so the shell must omit the key
   * rather than guess a value.
   * @param {string} raw - the command tail after `/refine <verb>`.
   * @returns {{ rest: string, global?: boolean, error?: string }} the tail with
   *   flags removed, plus the resolved scope.
   */
  function parseScope(raw) {
    const kept = []
    let global
    for (const token of raw.split(/\s+/).filter((t) => t !== '')) {
      if (token === '--global' || token === '--local') {
        const wanted = token === '--global'
        if (global !== undefined && global !== wanted) return { rest: '', error: '不能同时指定 --global 和 --local' }
        global = wanted
      } else if (token.startsWith('--')) {
        return { rest: '', error: '未知参数 ' + token + '（可选 --global / --local）' }
      } else {
        kept.push(token)
      }
    }
    const out = { rest: kept.join(' ') }
    if (global !== undefined) out.global = global
    return out
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
    ctx.effect(() => {
      // This wrapper owns `/refine`. The engine registers a `/refine` of its
      // own (plan + rollback only) whenever its context exposes `commands`,
      // and the host registry rejects a duplicate name — so `mountEngine()`
      // starts it under `ctx.isolate('commands')`, where that adapter stays
      // unregistered. The shell therefore keeps the full surface
      // (status / list / history) and forwards the engine's own grammar,
      // `--global` / `--local` flags included, to `harness_refine`.
      //
      // The try/catch below stays as a safety net: a legacy profile that
      // still lists `dsh-continual-harness` as its own bundle row has the
      // engine's adapter registered first (`mountEngine()` then skips), and
      // losing our richer command is far better than failing the tree.
      try {
        commands.register({
          name: 'refine',
          description: '查看/触发 continual harness 精炼（dsh-refine）',
          input: { hint: '[status|list [kind]|history [n]|rollback <id> [--global|--local]|<instructions> [--global|--local]]' },
          handler: async (inv) => {
            const raw = typeof inv.rawInput === 'string' ? inv.rawInput.trim() : ''
            const lower = raw.toLowerCase()
            // `inv.signal` is the UI request's cancellation; the engine tool
            // call inherits it so an aborted command also aborts its refine.
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
                const parsed = parseScope(raw.slice(8))
                if (parsed.error !== undefined) return { kind: 'error', text: parsed.error }
                const id = parsed.rest
                if (!id) return { kind: 'error', text: '用法: /refine rollback <refinement-id> [--global|--local]（id 见 /refine history）' }
                // Rollback applies stored edits with no LLM round-trip - fast
                // enough to stay synchronous so its outcome is the result.
                const args = { rollback_id: id }
                if (parsed.global !== undefined) args.global = parsed.global
                const r = await runEngine(args, signal)
                if (!r.ok) return { kind: 'error', text: r.error }
                return { kind: 'success', text: '已回滚 ' + id + '。' }
              }
              // A trigger runs the planner LLM (minutes); it is dispatched in
              // the background so the composer's submit transaction - which
              // freezes the input until command/done - settles immediately.
              const parsed = parseScope(raw)
              if (parsed.error !== undefined) return { kind: 'error', text: parsed.error }
              const args = {}
              if (parsed.rest !== '') args.instructions = parsed.rest
              if (parsed.global !== undefined) args.global = parsed.global
              const r = triggerEngine(args)
              if (!r.ok) return { kind: 'error', text: r.error }
              const scopeNote = parsed.global === undefined ? '' : parsed.global ? '（global）' : '（local）'
              return { kind: 'success', text: '已触发精炼' + scopeNote + '（后台运行中，结果见 设置 → 精炼 Harness 或 /refine history）：' + (parsed.rest || '(无指令)') }
            } catch (e) {
              return { kind: 'error', text: '/refine 失败: ' + String((e && e.message) || e) }
            }
          },
        })
      } catch (registerError) {
        logWarn('跳过 /refine 注册（已被引擎或其他插件占用；把 dsh-continual-harness 从 profile 的 bundles 移除即可让 dsh-refine 接管）: '
          + String((registerError && registerError.message) || registerError))
      }
    })
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

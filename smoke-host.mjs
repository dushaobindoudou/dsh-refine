// Runtime smoke test for dsh-refine lib/index.js (host half).
// Mounts the plugin on a real cordis root with faked host services, runs it
// against the real demo ESP files, then asserts the `/refine` command handler
// and both `refineUx` Remote methods behave.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(join(here, 'lib', 'index.js'))

const HARNESS_FIXTURE = join(process.env.HOME || '/Users/liepin', '.dsh', 'harness')
const fsSvc = {
  resolve: async (p) => p,
  readText: async (p) => readFile(p, 'utf8'),
}

/**
 * Mirror of the Typert Gateway's `assertJsonValue` boundary check: a business
 * result carrying `undefined`, a non-plain object, or a symbol key is rejected
 * before it reaches the client, so the panel would see a gateway error.
 */
function assertJsonSafe(value, where) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), `${where}: non-finite number is not JSON-safe`)
    return
  }
  assert.equal(typeof value, 'object', `${where}: ${typeof value} is not JSON-safe`)
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertJsonSafe(item, `${where}[${i}]`))
    return
  }
  const proto = Object.getPrototypeOf(value)
  assert.ok(proto === null || proto === Object.prototype, `${where}: non-plain object is not JSON-safe`)
  assert.equal(Object.getOwnPropertySymbols(value).length, 0, `${where}: symbol property is not JSON-safe`)
  for (const key of Object.keys(value)) assertJsonSafe(value[key], `${where}.${key}`)
}

/** Mount the plugin on a fresh root with the given tools/agents fakes. */
async function mount(toolsSvc, agentsSvc) {
  const root = new Context()
  const registered = []
  for (const [key, value] of [
    ['fs', fsSvc],
    ['commands', { register: (def) => { registered.push(def); return () => {} } }],
    ['tools', toolsSvc],
    ['agents', agentsSvc],
  ]) {
    root.provide(key)
    if (value !== undefined) root.set(key, value)
  }
  const fiber = root.plugin(mod)
  await fiber
  const remote = root.get('refineUx')
  assert.ok(remote !== undefined, 'refineUx Remote service registered')
  return { root, registered, remote }
}

// --- engine absent: every trigger path degrades --------------------------------
const absent = await mount({ get: () => undefined }, undefined)

const exported = remoteMethods(absent.remote).map((m) => m.exportName ?? m.method).sort()
assert.deepEqual(exported, ['data', 'rollback'], 'both methods carry Remote markers')
assert.equal(absent.remote.typertRemote.namespace, 'refineUx', 'wire namespace is refineUx')

// Snapshot the live fixture first: the store is shared with the real engine
// and mutates whenever a refinement lands, so expected counts are derived
// from the files instead of hardcoded demo numbers.
const stateRaw = JSON.parse(await readFile(join(HARNESS_FIXTURE, 'harness_state.json'), 'utf8'))
const expectedCounts = {}
for (const k of ['prompt', 'memory', 'skill', 'subagent']) {
  expectedCounts[k] = Object.keys(stateRaw.entries?.[k] ?? {}).length
}
const jsonlLines = async (name) => (await readFile(join(HARNESS_FIXTURE, name), 'utf8'))
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l))
const historyAll = await jsonlLines('refinements.jsonl')
const reviewsAll = await jsonlLines('reviews.jsonl')
const expectedHistory = Math.min(historyAll.length, 20)
const expectedReviews = Math.min(reviewsAll.length, 10)
const newestHistoryId = historyAll.length > 0 ? historyAll[historyAll.length - 1].id : null

const data = await absent.remote.data(null)
assertJsonSafe(data, 'refineUx/data')
assert.equal(data.engineActive, false, 'engine absent -> engineActive false')
assert.equal(data.hasState, true, 'demo state file found')
for (const k of ['prompt', 'memory', 'skill', 'subagent']) {
  assert.equal(data.entries[k].length, expectedCounts[k], `${k} count matches fixture snapshot`)
}
assert.equal(data.history.length, expectedHistory, 'history matches fixture snapshot (capped at 20)')
const rollbackRecords = historyAll.filter((r) => typeof r.rollbackOf === 'string')
if (rollbackRecords.length > 0) {
  assert.ok(data.history.some((h) => h.rollbackOf), 'rollback records surfaced')
}
assert.equal(data.reviews.length, expectedReviews, 'reviews match fixture snapshot (capped at 10)')

assert.equal(absent.registered.length, 1, 'one command registered')
assert.equal(absent.registered[0].name, 'refine')
const cmd = absent.registered[0]

const status = await cmd.handler({ rawInput: '' })
assert.equal(status.kind, 'success')
assert.ok(status.text.includes('引擎未挂载'), 'status mentions degraded engine')
assert.ok(status.text.includes(`memory:${expectedCounts.memory}`), 'status counts memory entries')

const list = await cmd.handler({ rawInput: 'list skill' })
assert.ok(list.text.includes('[skill] 1 条'))
assert.ok(list.text.includes('draft-release-notes'))

const badKind = await cmd.handler({ rawInput: 'list nope' })
assert.equal(badKind.kind, 'error')

const hist = await cmd.handler({ rawInput: 'history 2' })
if (newestHistoryId !== null) {
  assert.ok(hist.text.includes(newestHistoryId), 'newest refinement id appears in history')
}

const triggerNoEngine = await cmd.handler({ rawInput: '记住要跑 pnpm install' })
assert.equal(triggerNoEngine.kind, 'error')
assert.ok(triggerNoEngine.text.includes('引擎未挂载'), 'trigger degrades gracefully')

const rbNoEngine = await absent.remote.rollback({ id: 'refine-20260820-01' })
assertJsonSafe(rbNoEngine, 'refineUx/rollback')
assert.equal(rbNoEngine.ok, false)
assert.ok(String(rbNoEngine.error).includes('引擎未挂载'))

for (const bad of [null, {}, { id: 42 }]) {
  const r = await absent.remote.rollback(bad)
  assert.equal(r.ok, false, 'missing id rejected')
}

// --- engine present: the execute path is taken ----------------------------------
let executed = null
const present = await mount({
  get: (n) => (n === 'harness_refine' ? { name: n } : undefined),
  // Faithful mirror of the real ToolRuntime seam the GUI hit (dsh-tools):
  // createExecution stores callerSignal = exec.signal and callerCancelled()
  // reads state.callerSignal.aborted UNGUARDED (index.js:3144), so a missing
  // exec.signal rejects with exactly the TypeError the command surfaced.
  execute: async (exec) => {
    if (exec.signal === undefined) {
      throw new TypeError("Cannot read properties of undefined (reading 'aborted')")
    }
    executed = exec
    return { ok: true, applied: 1 }
  },
}, { roots: () => [{ id: 'a1' }] })

const data2 = await present.remote.data(null)
assertJsonSafe(data2, 'refineUx/data')
assert.equal(data2.engineActive, true, 'engine detected via tools registry')

const rb = await present.remote.rollback({ id: 'refine-20260820-01' })
assertJsonSafe(rb, 'refineUx/rollback')
assert.equal(rb.ok, true)
assert.equal(executed.name, 'harness_refine')
assert.equal(executed.arguments.rollback_id, 'refine-20260820-01')
assert.ok(executed.agent && executed.agent.id === 'a1')

// Rollback is synchronous and threads the invocation signal through to
// tools.execute (an aborted UI request also aborts its rollback).
const invSignal = new AbortController().signal
const rbCmd = await present.registered[0].handler({ rawInput: 'rollback refine-20260820-01', signal: invSignal })
assert.equal(rbCmd.kind, 'success')
assert.equal(executed.name, 'harness_refine')
assert.equal(executed.arguments.rollback_id, 'refine-20260820-01')
assert.equal(executed.signal, invSignal, 'rollback threads the invocation signal into tools.execute')

// The trigger path is fire-and-forget: the ack must NOT wait for the engine.
// A never-settling execute proves the handler resolves without awaiting it
// (and still reaches the registry's exec.signal read via a fresh signal).
let bgExecuted = null
const bg = await mount({
  get: (n) => (n === 'harness_refine' ? { name: n } : undefined),
  execute: (exec) => {
    if (exec.signal === undefined) {
      throw new TypeError("Cannot read properties of undefined (reading 'aborted')")
    }
    bgExecuted = exec
    return new Promise(() => {}) // never settles: a synchronous ack is required
  },
}, { roots: () => [{ id: 'a2' }] })
const trigger = await bg.registered[0].handler({ rawInput: '记住要跑 pnpm install' })
assert.equal(trigger.kind, 'success', 'trigger acks immediately despite in-flight engine work')
assert.ok(String(trigger.text).includes('后台'), 'ack explains the refinement runs in the background')
assert.ok(bgExecuted !== null, 'engine tool dispatch was launched')
assert.equal(bgExecuted.name, 'harness_refine')
assert.equal(bgExecuted.arguments.instructions, '记住要跑 pnpm install')
assert.ok(bgExecuted.agent && bgExecuted.agent.id === 'a2')
assert.ok(bgExecuted.signal !== undefined && typeof bgExecuted.signal.aborted === 'boolean',
  'background dispatch still supplies an AbortSignal (registry reads exec.signal.aborted)')

// --- reader compat: engine session-event registration (lib/compat.js) ---------
//
// The engine appends a `harness/refinement` session event per commit; the
// stock reader refuses logs containing types outside KNOWN_SESSION_EVENT_TYPES
// (assertEventsSupported), making every refining session unreadable. dsh-refine
// registers the type into the HOST reader's Set - same instance the reader
// consults - resolved from the dsh CLI entry.
const compat = await import(join(here, 'lib', 'compat.js'))

// Graceful degradation: an undiscoverable entry is captured, never thrown.
const degraded = await compat.registerKnownSessionEventTypes({ entry: '/nonexistent/dsh-bin.js' })
assert.equal(degraded.registered, false, 'bogus entry degrades to captured status')
assert.ok(typeof degraded.reason === 'string' && degraded.reason.length > 0, 'failure carries a reason')
assert.equal((await compat.registerKnownSessionEventTypes({ entry: '/nonexistent/dsh-bin.js' })).registered, false, 'repeatable')

// Effective registration against the real host install, entered through the
// dsh bin symlink - exactly the process.argv[1] the host sees under `dsh web`.
let dshEntry = null
try {
  dshEntry = execFileSync('sh', ['-c', 'command -v dsh'], { encoding: 'utf8' }).trim() || null
} catch { /* dsh not on PATH: skip the live-registration assertions */ }
if (dshEntry !== null && existsSync(dshEntry)) {
  const status = await compat.registerKnownSessionEventTypes({ entry: dshEntry })
  assert.equal(status.registered, true, `registration succeeds from ${dshEntry}`)
  assert.ok(Array.isArray(status.added), 'status lists added types')
  assert.ok(typeof status.module === 'string' && status.module.includes('dsh-session'), 'status names the host module')
  // The exact production seam: the Set instance the persistence reader imports.
  const hostSession = await import(pathToFileURL(compat.resolveHostSessionModule(dshEntry)).href)
  assert.ok(hostSession.KNOWN_SESSION_EVENT_TYPES.has('harness/refinement'), 'host reader Set knows the engine event type')
  // Idempotent: a second registration adds nothing.
  const again = await compat.registerKnownSessionEventTypes({ entry: dshEntry })
  assert.deepEqual(again.added, [], 'second registration is a no-op')
} else {
  console.log('smoke-host: dsh not on PATH - skipped live host-registration assertions')
}

console.log('smoke-host: all assertions passed ✓  (fixtures:', HARNESS_FIXTURE + ')')

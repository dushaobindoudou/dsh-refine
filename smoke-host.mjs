// Runtime smoke test for dsh-refine lib/index.js (host half).
// Mounts the plugin on a real cordis root with faked host services, runs it
// against the real demo ESP files, then asserts the `/refine` command handler
// (deferred to the engine when it is mounted), both `refineUx` Remote methods,
// and the compat registration against the live host.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

const here = dirname(fileURLToPath(import.meta.url))
const mod = await import(join(here, 'lib', 'index.js'))

// Same resolution the plugin uses internally, so fixture reads always agree
// with what lib/index.js sees (honours $DSH_HOME, else ~/.dsh).
const HARNESS_FIXTURE = dshHomePath('harness')

// CI bootstrap: a fresh runner has no engine ESP files. Create minimal empty
// ones so the snapshot assertions stay deterministic (counts = 0); a local run
// with real engine files leaves them untouched. lib/index.js already degrades
// to undefined/[] when the files are missing - this keeps the test itself
// hermetic without weakening the local live-fixture coverage.
if (!existsSync(join(HARNESS_FIXTURE, 'harness_state.json'))) {
  await mkdir(HARNESS_FIXTURE, { recursive: true })
  await writeFile(join(HARNESS_FIXTURE, 'harness_state.json'), JSON.stringify({ version: 1, entries: {} }, null, 2))
  await writeFile(join(HARNESS_FIXTURE, 'refinements.jsonl'), '')
  await writeFile(join(HARNESS_FIXTURE, 'reviews.jsonl'), '')
}
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
  // The shell mounts the real engine by default; these scenarios drive the
  // tools seam with fakes instead, so the mount is opted out of here. The
  // 套壳 mount path has its own case at the end of this file.
  const fiber = root.plugin(mod, { mountEngine: false })
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
assert.ok(list.text.includes(`[skill] ${expectedCounts.skill} 条`), 'list shows the skill count from the fixture snapshot')
const skillEntries = Object.values(stateRaw.entries?.skill ?? {})
const firstSkillId = skillEntries.length > 0 ? (skillEntries[0].id ?? null) : null
if (firstSkillId !== null) {
  assert.ok(list.text.includes(firstSkillId), 'first skill entry id appears in the list')
}

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
let executed
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

// dsh-refine is the shell: it owns `/refine` whether or not the engine is
// reachable. The engine's own adapter never registers because `mountEngine()`
// starts it under `ctx.isolate('commands')`, so there is no duplicate name to
// collide - and the shell keeps status/list/history, which the engine's
// two-mode command does not offer.
assert.equal(present.registered.length, 1, '/refine owned by the shell when the engine is mounted')
const refineCmd = present.registered[0]
assert.equal(refineCmd.name, 'refine')
assert.ok(refineCmd.input.hint.includes('--global'), 'hint advertises the engine scope flags')

// Scope flags are parsed by the shell and forwarded to the engine tool as the
// boolean `global` the tool documents; omitting both leaves the key unset so
// the engine applies its deployment default.
const invoke = (rawInput) => refineCmd.handler({
  rawInput,
  signal: new AbortController().signal,
  commandId: 'c1',
  agent: { id: 'a1' },
  attachments: [],
})

executed = null
const rbLocal = await invoke('rollback refine-1 --local')
assert.equal(rbLocal.kind, 'success', 'scoped rollback succeeds')
assert.equal(executed.arguments.rollback_id, 'refine-1')
assert.equal(executed.arguments.global, false, '--local maps to global:false')

executed = null
const rbBare = await invoke('rollback refine-2')
assert.equal(rbBare.kind, 'success')
assert.equal('global' in executed.arguments, false, 'no flag leaves global unset')

const bothFlags = await invoke('rollback refine-3 --local --global')
assert.equal(bothFlags.kind, 'error', 'conflicting scope flags rejected')

const unknownFlag = await invoke('rollback refine-4 --nope')
assert.equal(unknownFlag.kind, 'error', 'unknown flag rejected')

const statusResult = await invoke('')
assert.equal(statusResult.kind, 'success', 'status still answered by the shell')
assert.ok(statusResult.text.includes('引擎已挂载'), 'status reports the engine')

const rb = await present.remote.rollback({ id: 'refine-20260820-01' })
assertJsonSafe(rb, 'refineUx/rollback')
assert.equal(rb.ok, true)
assert.equal(executed.name, 'harness_refine')
assert.equal(executed.arguments.rollback_id, 'refine-20260820-01')
assert.ok(executed.agent && executed.agent.id === 'a1')
assert.ok(executed.signal !== undefined && typeof executed.signal.aborted === 'boolean',
  'remote rollback supplies an AbortSignal (registry reads exec.signal.aborted unguarded)')

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

// Engine 0.3.0 reads `session.events` (an array) in its pre-step projection.
// Recent dsh hosts drop the public `events` array (they expose `surface` +
// `snapshotEvents()`), so dsh-refine installs a guarded `events` getter
// aliasing `snapshotEvents()`. Degrade + live checks mirror the event-type
// registration above.
const shimDegraded = await compat.installSessionEventsShim({ entry: '/nonexistent/dsh-bin.js' })
assert.equal(shimDegraded.shimmed, false, 'bogus entry degrades to captured status')
assert.ok(typeof shimDegraded.reason === 'string' && shimDegraded.reason.length > 0, 'failure carries a reason')
if (dshEntry !== null && existsSync(dshEntry)) {
  const shim = await compat.installSessionEventsShim({ entry: dshEntry })
  const hostSession = await import(pathToFileURL(compat.resolveHostSessionModule(dshEntry)).href)
  const desc = Object.getOwnPropertyDescriptor(hostSession.Session.prototype, 'events')
  assert.ok(desc !== undefined, 'host Session.prototype exposes an events descriptor after the shim')
  if (shim.shimmed === true) {
    assert.ok(typeof desc.get === 'function', 'events is a getter when the shim installs it')
    assert.equal(desc.enumerable, false, 'events getter is non-enumerable')
  } else {
    assert.equal(shim.reason, 'host Session already exposes events', 'already-exposing hosts are an expected no-op')
  }
  await compat.installSessionEventsShim({ entry: dshEntry }) // idempotent, never throws
} else {
  console.log('smoke-host: dsh not on PATH - skipped live session-events shim assertions')
}

// --- the 套壳 mount: the shell starts the engine and keeps /refine ------------
//
// `mountEngine()` starts dsh-continual-harness under `ctx.isolate('commands')`.
// The isolated scope is what stops the engine's own `/refine` adapter from
// registering, so the two commands can never collide: the assertion below is
// that after a real mount the host registry saw exactly ONE `refine`, ours.
const engineMod = await import(join(here, 'lib', 'engine.js'))

// Skip guard: a profile that already mounted the engine must not get a second
// copy of the harness_refine tool.
const skipped = await engineMod.mountEngine(new Context(), {
  tools: { get: (n) => (n === 'harness_refine' ? { name: n } : undefined) },
})
assert.equal(skipped.mounted, false, 'existing engine is not mounted twice')
assert.ok(String(skipped.reason).includes('already mounted'), 'skip reason names the cause')

// A missing/broken engine degrades to a captured status, never a throw.
assert.equal(typeof engineMod.engineMountStatus, 'object', 'mount status is always an object')
assert.equal(engineMod.ENGINE_TOOL, 'harness_refine')

// Real mount: the engine injects `agents` + `tools`, so provide both.
const mountRoot = new Context()
const mountRegistered = []
const hostTools = new Map()
for (const [key, value] of [
  ['fs', fsSvc],
  ['commands', { register: (def) => { mountRegistered.push(def); return () => {} } }],
  ['tools', {
    get: (n) => hostTools.get(n),
    register: (def) => { hostTools.set(def.name, def); return () => hostTools.delete(def.name) },
    execute: async () => ({ ok: true }),
  }],
  ['agents', { roots: () => [{ id: 'a1' }] }],
]) {
  mountRoot.provide(key)
  mountRoot.set(key, value)
}
await mountRoot.plugin(mod, {})
// The mount is fire-and-forget; give its dynamic import a turn to settle.
for (let i = 0; i < 50 && engineMod.engineMountStatus.reason === 'not attempted'; i++) {
  await new Promise((r) => setTimeout(r, 20))
}
const refineNames = mountRegistered.filter((d) => d.name === 'refine')
assert.equal(refineNames.length, 1, 'exactly one /refine registered (the shell keeps it)')
assert.ok(refineNames[0].input.hint.includes('history'),
  'the surviving /refine is the shell\'s full-surface one, not the engine two-mode adapter')

console.log('smoke-host: all assertions passed ✓  (fixtures:', HARNESS_FIXTURE + ')')

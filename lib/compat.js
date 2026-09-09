/**
 * Reader compatibility for the engine's durable session events.
 *
 * Up to the 0.1.x series, `dsh-continual-harness` committed every refinement
 * by appending a `harness/refinement` event to the session log. The stock dsh
 * reader only accepts event types listed in `KNOWN_SESSION_EVENT_TYPES` (an
 * in-repo vocabulary: out-of-repo plugin events are outside it by
 * construction and the registration surface is deferred upstream), or events
 * carrying the envelope `ignorable` marker - which `Session.append()` offers
 * no way to set. Any session that committed a refinement then became
 * unreadable afterwards (history load and resume both refuse with
 * `SessionFormatUnsupportedError`).
 *
 * dsh-refine bridges the gap by registering the engine's event types into the
 * HOST reader's `KNOWN_SESSION_EVENT_TYPES` instance at plugin load. The host
 * module is resolved from the running dsh CLI entry (`process.argv[1]`), so
 * the mutated Set is the exact instance the persistence reader consults; a
 * bare `import '@deepseek-ai/dsh-session'` from this package would resolve to
 * the profile's own copy and mutate nothing. Registration is idempotent,
 * never throws, and degrades to a captured status when the host layout is not
 * discoverable - in that case behavior stays exactly as without dsh-refine.
 *
 * As of engine 0.3.0 the `harness/refinement` type is legacy: the engine no
 * longer writes it (it mounts a scoped `harness/refined` event and a
 * `harness-state` message source instead) and self-registers the legacy type
 * for old logs via its own `registerSessionEventType()`. This registration is
 * therefore redundant against a 0.3.0+ engine, but is kept as an idempotent
 * defensive fallback so dsh-refine stays compatible across engine versions
 * (0.1.x logs remain readable even when the engine does not perform the
 * registration itself).
 *
 * Engine 0.3.0 additionally reads `session.events` (an array) in its
 * `agent/pre-step` projection and planner-route detection. Recent dsh hosts
 * expose an equivalent FULL snapshot through `Session#snapshotEvents()` and no
 * public `events` array, so the engine's `session.events.length` throws
 * `Cannot read properties of undefined (reading 'length')` on every turn.
 * dsh-refine bridges that gap by installing a non-enumerable, configurable
 * `events` getter on the host `Session.prototype` that returns the log
 * snapshot - guarded (no-op on hosts that already expose `events`), idempotent
 * and captured into {@link sessionEventsCompat} rather than thrown.
 * @module dsh-refine/compat
 */
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Durable session event types the engine writes (mirrors HARNESS_REFINEMENT_EVENT). */
export const ENGINE_SESSION_EVENT_TYPES = ['harness/refinement']

/** Outcome of the last registration attempt; replaced by each call. */
export let engineEventCompat = { registered: false, reason: 'not attempted' }

/** Outcome of the last host session `events` shim; replaced by each call. */
export let sessionEventsCompat = { shimmed: false, reason: 'not attempted' }

const require = createRequire(import.meta.url)

/**
 * Resolve the host's `@deepseek-ai/dsh-session` main module from the running
 * dsh CLI entry.
 *
 * The entry is resolved to its real path first: global installs expose the CLI
 * through a bin symlink (nvm: `<prefix>/bin/dsh` ->
 * `<prefix>/lib/node_modules/@deepseek-ai/dsh/lib/bin.js`) and `argv[1]`
 * carries the symlink path, whose directory tree does not contain the
 * package's dependencies.
 * @param {string} [entry] - the CLI entry file to resolve from
 *   (defaults to `process.argv[1]`).
 * @returns {string} the resolved main-module path.
 */
export function resolveHostSessionModule(entry) {
  const base = entry ?? (typeof process !== 'undefined' && process.argv && process.argv[1])
  if (typeof base !== 'string' || base === '') {
    throw new Error('no dsh CLI entry to resolve the host install from')
  }
  const candidates = []
  try { candidates.push(realpathSync(base)) } catch { /* entry not on disk */ }
  candidates.push(base)
  let failure
  for (const candidate of candidates) {
    try {
      return require.resolve('@deepseek-ai/dsh-session', { paths: [dirname(candidate)] })
    } catch (error) {
      failure = error
    }
  }
  throw failure
}

/**
 * Register the engine's session event types in the host reader's known-type
 * Set. Safe to call repeatedly and from any context: every failure mode is
 * captured into {@link engineEventCompat} instead of thrown.
 * @param {{ entry?: string }} [options] - explicit CLI entry override (tests).
 * @returns {{ registered: boolean, reason?: string, module?: string, added?: string[] }}
 *   the same object stored in {@link engineEventCompat}.
 */
export async function registerKnownSessionEventTypes(options = {}) {
  try {
    const resolved = resolveHostSessionModule(options.entry)
    const hostSession = await import(pathToFileURL(resolved).href)
    const known = hostSession.KNOWN_SESSION_EVENT_TYPES
    if (known === undefined || typeof known.add !== 'function' || typeof known.has !== 'function') {
      throw new Error('host dsh-session does not export a mutable KNOWN_SESSION_EVENT_TYPES')
    }
    const added = []
    for (const type of ENGINE_SESSION_EVENT_TYPES) {
      if (!known.has(type)) {
        known.add(type)
        added.push(type)
      }
    }
    engineEventCompat = { registered: true, module: resolved, added }
    return engineEventCompat
  } catch (error) {
    engineEventCompat = { registered: false, reason: String((error && error.message) || error) }
    return engineEventCompat
  }
}

/**
 * Ensure the host `Session` exposes a public `events` array for the engine's
 * projection/coordinate reads. On hosts where `Session.prototype.events` is
 * absent we define a read-only getter aliasing `snapshotEvents()`; on hosts
 * that already ship `events` (the engine's original target layout) this is a
 * no-op. Every failure mode is captured into {@link sessionEventsCompat}.
 * @param {{ entry?: string }} [options] - explicit CLI entry override (tests).
 * @returns {{ shimmed: boolean, reason?: string, module?: string }} the same
 *   object stored in {@link sessionEventsCompat}.
 */
export async function installSessionEventsShim(options = {}) {
  try {
    const resolved = resolveHostSessionModule(options.entry)
    const hostSession = await import(pathToFileURL(resolved).href)
    const Session = hostSession.Session
    if (Session === undefined || typeof Session !== 'function' || !Session.prototype) {
      throw new Error('host dsh-session does not export a Session class')
    }
    if (Object.getOwnPropertyDescriptor(Session.prototype, 'events') !== undefined) {
      sessionEventsCompat = { shimmed: false, reason: 'host Session already exposes events', module: resolved }
      return sessionEventsCompat
    }
    if (typeof Session.prototype.snapshotEvents !== 'function') {
      throw new Error('host Session exposes no snapshotEvents() to back the events shim')
    }
    Object.defineProperty(Session.prototype, 'events', {
      configurable: true,
      enumerable: false,
      get() { return this.snapshotEvents() },
    })
    sessionEventsCompat = { shimmed: true, module: resolved }
    return sessionEventsCompat
  } catch (error) {
    sessionEventsCompat = { shimmed: false, reason: String((error && error.message) || error) }
    return sessionEventsCompat
  }
}

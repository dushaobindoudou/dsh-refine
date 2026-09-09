/**
 * Engine mounting — the wrapper half of dsh-refine.
 *
 * dsh-refine is a shell around `dsh-continual-harness`: the engine does the
 * refinement work, this package owns the human surface (`/refine` and the
 * settings panel). Since engine 0.3.0 the engine registers its own `/refine`
 * command whenever its context exposes a `commands` capability, and the host
 * registry rejects a duplicate name outright — two rows mounting side by side
 * in one profile fail the whole plugin tree with
 * `command "refine" is already registered`.
 *
 * So the wrapper stops being a sibling and becomes the owner: it mounts the
 * engine itself, under `ctx.isolate('commands')`. Below an isolated context
 * the `commands` service resolves in a fresh scope that nothing provides, so
 * the engine's `ctx.get('commands')` is `undefined`, it logs exactly one
 * "commands capability not available" warning (its documented degraded path),
 * and skips its own command adapter. Everything else the engine needs —
 * `agents`, `tools`, `fs`, the session log — is untouched and still shared,
 * so its `harness_refine` tool lands in the same registry this package
 * dispatches through.
 *
 * Two guards keep older layouts working:
 *
 *  - A profile still listing `dsh-continual-harness` as its own bundle row
 *    has the engine mounted already; mounting a second copy would duplicate
 *    the `harness_refine` tool. `alreadyMounted()` detects that and skips.
 *  - The engine's schema makes `defaultGlobal` required with no default (its
 *    own shipped patch row supplies `true`), so mounting with a bare `{}`
 *    fails validation. {@link ENGINE_DEFAULTS} restates exactly that row's
 *    value and the caller's `engine` config overrides it key by key.
 *  - A missing or broken engine install must degrade, not crash the tree:
 *    the import is dynamic and every failure is captured into
 *    {@link engineMountStatus} rather than thrown, which keeps the package's
 *    original "engine optional at runtime" behaviour — every trigger path
 *    then answers with the actionable engine-missing message.
 *
 * @module dsh-refine/engine
 */

/** Tool name the engine registers; also the wrapper's engine-present probe. */
export const ENGINE_TOOL = 'harness_refine'

/** Package this wrapper mounts. */
export const ENGINE_PACKAGE = 'dsh-continual-harness'

/**
 * Config the engine cannot start without. `defaultGlobal` is
 * `z.boolean().required()` in its schema — no default — and the engine's own
 * `cordis.patch.yml` row sets it to `true`; a bare `{}` rejects with
 * `ValidationError: invalid config`. Everything else in that schema has a
 * default, so this is the whole floor.
 */
export const ENGINE_DEFAULTS = Object.freeze({ defaultGlobal: true })

/** Outcome of the last mount attempt; replaced by each call. */
export let engineMountStatus = { mounted: false, reason: 'not attempted' }

/**
 * Mount the continual-harness engine as a child plugin of this wrapper.
 *
 * @param {object} ctx - the wrapper's own Cordis context.
 * @param {object} [options] - mount options.
 * @param {object} [options.config] - engine row config, validated by the
 *   engine's own Schemastery `Config` when Cordis starts the plugin.
 * @param {object} [options.tools] - the host tool registry, used to detect an
 *   engine already mounted by a separate bundle row.
 * @param {(text: string) => void} [options.warn] - best-effort logger.
 * @returns {Promise<{ mounted: boolean, reason?: string, version?: string }>}
 *   the same object stored in {@link engineMountStatus}.
 */
export async function mountEngine(ctx, options = {}) {
  const { config = {}, tools, warn } = options
  try {
    if (alreadyMounted(tools)) {
      engineMountStatus = { mounted: false, reason: 'engine already mounted by another row' }
      return engineMountStatus
    }
    const engine = await import(ENGINE_PACKAGE)
    const plugin = enginePlugin(engine)
    if (plugin === undefined) {
      throw new Error(`${ENGINE_PACKAGE} exports no Cordis plugin (no apply/default)`)
    }
    // `commands` isolated, everything else shared: the engine keeps agents,
    // tools and the session log, and loses only its own /refine adapter.
    const fiber = ctx.isolate('commands').plugin(plugin, { ...ENGINE_DEFAULTS, ...config })
    engineMountStatus = { mounted: true, version: readVersion(engine) }
    // A rejected fiber (bad config, unmet inject) would otherwise be silent:
    // `plugin()` returns before the engine starts, so an optimistic status
    // would keep claiming a mount that never happened and `/refine` would
    // report a live engine while every dispatch fell through.
    Promise.resolve(fiber).catch((error) => {
      const reason = String((error && error.message) || error)
      engineMountStatus = { mounted: false, reason }
      if (typeof warn === 'function') {
        warn(`${ENGINE_PACKAGE} 挂载失败（/refine 降级为提示，面板只读）: ${reason}`)
      }
    })
    return engineMountStatus
  } catch (error) {
    const reason = String((error && error.message) || error)
    engineMountStatus = { mounted: false, reason }
    if (typeof warn === 'function') {
      warn(`${ENGINE_PACKAGE} 未挂载（/refine 降级为提示，面板只读）: ${reason}`)
    }
    return engineMountStatus
  }
}

/**
 * Whether some other row already mounted the engine into this profile.
 * @param {object} [tools] - the host tool registry.
 * @returns {boolean} true when the engine's tool is already registered.
 */
export function alreadyMounted(tools) {
  try { return tools !== undefined && tools.get(ENGINE_TOOL) !== undefined } catch { return false }
}

/**
 * Pick the Cordis plugin object out of the engine's module namespace. Cordis
 * accepts either a functional plugin or an object carrying `apply`; the engine
 * ships named `apply`/`Config`/`inject` exports, so the namespace itself is a
 * valid plugin object — but a default export wins when present.
 * @param {object} engine - the imported module namespace.
 * @returns {object | undefined} the plugin to hand to `ctx.plugin()`.
 */
function enginePlugin(engine) {
  if (engine === null || typeof engine !== 'object') return undefined
  const fallback = engine.default
  if (fallback !== undefined && (typeof fallback === 'function' || typeof fallback.apply === 'function')) {
    return fallback
  }
  return typeof engine.apply === 'function' ? engine : undefined
}

/**
 * Best-effort engine version for status surfaces; never throws.
 * @param {object} engine - the imported module namespace.
 * @returns {string | undefined} the engine version when discoverable.
 */
function readVersion(engine) {
  const value = engine && engine.PLUGIN_VERSION
  return typeof value === 'string' ? value : undefined
}

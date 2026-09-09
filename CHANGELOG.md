# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-09-09

### Added

- **dsh-refine now mounts the engine itself** — the shell owns the whole
  arrangement instead of sitting beside it. `lib/engine.js` starts
  `dsh-continual-harness` as a child plugin under `ctx.isolate('commands')`:
  below an isolated context the `commands` service resolves in a fresh scope
  nothing provides, so the engine's own `/refine` adapter never registers
  (its documented "commands capability not available" degraded path), while
  `agents`, `tools`, `fs` and the session log stay shared — its
  `harness_refine` tool lands in the same registry this package dispatches
  through. `dsh-continual-harness` is therefore a real dependency (`^0.3.0`)
  rather than something the profile mounts separately.
- `/refine` accepts the engine's scope grammar: `--global` / `--local` on both
  triggers and rollback, forwarded to `harness_refine` as the boolean `global`
  it documents. Passing neither leaves the key unset so the engine applies its
  deployment default; conflicting or unknown flags are rejected up front.
- `mountEngine` row config (default `true`) opts out of the built-in mount, for
  a legacy profile that still lists `dsh-continual-harness` as its own bundle
  row or to run this package as a read-only panel. Engine row config passes
  through unchanged as `engine`.
- `./engine` subpath export, and `engineOwned` in the `refineUx/data` payload
  so the panel can tell a shell-hosted engine from a separately mounted one.

### Changed

- **Reverted 1.1.0's deferral: the shell owns `/refine` again.** Deferring
  handed the command to the engine's two-mode adapter (plan + rollback) and
  silently dropped `status`, `list` and `history` — the browse and timeline
  surface that is this package's reason to exist. Isolating `commands` for the
  engine removes the name collision at its source, so no one has to give the
  command up. The `try/catch` around registration stays as a safety net for a
  legacy profile that still mounts the engine as its own row.

### Migration

Remove `dsh-continual-harness` from the profile's `dsh.profile.bundles`; keep
`dsh-refine` there and it starts the engine for you. A profile that keeps both
rows still works — the shell detects the already-registered `harness_refine`
tool, skips its own mount, and falls back to the engine's `/refine`.

## [1.1.0] - 2026-09-09

### Changed

- Upgrade to the aligned `0.1.2-rc.1` peer series (`@deepseek-ai/dsh-home-paths`,
  `@deepseek-ai/dsh-typert-protocol`) so the plugin resolves against the current
  dsh host and the `refineUx` panel talks the exact Typert protocol the host
  ships. Transitive `@deepseek-ai/cordis` peer now resolves to `^4.0.2`.
- Client settings panel redesigned as a native settings section: renamed to
  **Refine Harness / 精炼 Harness**, localized the full UI via the host `locale`
  model (Simplified Chinese + English dictionaries, auto-switching), themed
  solely with `--dsw-alias-*` design tokens (dark/light adapts automatically),
  and restructured into an Overview card (engine / state path / entry counts /
  plugin version) plus Entries, History, and Auto-gate sections consistent with
  dsh's native settings interactions.
- Defer `/refine` to the engine when it is mounted: `dsh-continual-harness@0.3.0`
  registers the same command itself, and the host commands registry rejects the
  duplicate ("command \"refine\" is already registered") and would break plugin
  startup depending on load order. dsh-refine now detects the engine's
  `harness_refine` tool at effect-run time and skips its own `/refine`
  registration, keeping the settings panel (browse / timeline / rollback /
  audit) as the wrapper's value-add. Without an engine the `/refine` command
  still ships (degraded status/list/history/rollback/trigger views).

### Fixed

- Redundant-but-defensive: `lib/compat.js` stays compatible across engine
  versions. The 0.3.0 engine no longer writes `harness/refinement` and
  self-registers the legacy event type; dsh-refine keeps registering it so
  logs from older 0.1.x engine builds remain readable.
- Bridge a host/engine API gap so turns stop crashing: engine 0.3.0 reads
  `session.events` in its `agent/pre-step` projection, but current dsh hosts
  expose only `surface` + `snapshotEvents()` (no public `events` array), which
  surfaced as `Cannot read properties of undefined (reading 'length')` on every
  turn (including ACP). dsh-refine now installs a guarded, non-enumerable,
  idempotent `events` getter on the host `Session.prototype` aliasing
  `snapshotEvents()` (`installSessionEventsShim` in `lib/compat.js`), so the
  engine's projection/planner reads work on the `0.1.2-rc.1` host series.

---
## [1.0.3] - 2026-08-21

### Changed

- Republish with updated npm search metadata (the 1.0.2 tarball shipped the
  pre-revision keywords/description): description leads with "DeepSeek
  Harness (dsh) plugin", keywords aligned with the ecosystem (`dsh-plugin`,
  `plugin`, `cordis`, `cordis-plugin`, `refinement`, …).

## [1.0.2] - 2026-08-21

### Added

- Community health files: `CONTRIBUTING.md` (dev setup, commit style, release
  process), `SECURITY.md` (private vulnerability reporting policy), bug/feature
  issue templates, PR template, `CODEOWNERS`, and `.editorconfig`.
- Bilingual docs: English `README.md` (primary) plus `README.zh-CN.md`,
  cross-linked; both shipped in the npm tarball.
- ESLint 10 flat config (`eslint.config.js`) with `lint` / `lint:fix` scripts;
  `prepublishOnly` now lints before testing. Dev-only tooling — the package
  still ships zero runtime dependencies.

### Changed

- npm search metadata: description now leads with "DeepSeek Harness (dsh)
  plugin" and keywords align with the ecosystem (`dsh-plugin`, `plugin`,
  `cordis`, `cordis-plugin`, `refinement`, …); repository description,
  homepage, and topics configured via `gh api`.
- CI: dedicated `lint` job; all workflows install with `npm ci` (lockfile is
  now committed for reproducible installs).
- Publish workflow additionally creates the GitHub Release with the changelog
  notes for the tagged version.

### Fixed

- Minor lint findings with no behavior change: unused `fileURLToPath` import
  in `lib/compat.js`, a dead `engineActive` initialization, and an unused
  parameter name in `RefineUxRemote.data`.

## [1.0.1] - 2026-08-20

### Fixed

- Peer range `>=0.0.1-rc.3` let `npm install` resolve `dsh-home-paths` to
  `0.1.0-rc.8`, whose `dsh-invariants` peer regressed to `^0.0.1-rc.3` —
  incompatible with `dsh-typert-protocol@0.1.0-rc.6`'s `^0.1.0-rc.6`, so a
  fresh install failed with `ERESOLVE`. Both peers are now pinned to the
  aligned `0.1.0-rc.6` series the dsh host ships.
- Smoke test now hermetic for CI: fixture path derives from
  `dshHomePath('harness')`, missing engine ESP files are bootstrapped, and
  hardcoded demo-content assertions derive counts/ids from the snapshot.
  Added CI (Node 18/20/22) and npm-publish-with-provenance workflows.

## [1.0.0] - 2026-08-20

First stable release. Replaces the placeholder `0.0.1` registration with the
full implementation.

### Added

- `/refine` human command: `status`, `list [kind]`, `history [n]`, `rollback <id>`,
  and free-text instruction triggers.
- Settings panel Remote (`refineUx`): entry browsing, refinement history timeline,
  one-click rollback, auto-gate audit.
- Session-history compatibility: `harness/refinement` session events written by
  the `dsh-continual-harness` engine are registered into the host reader's known
  event-type set so refining sessions stay loadable (engine-optional at runtime).

### Fixed

- `Cannot read properties of undefined (reading 'aborted')` on `/refine <text>`:
  the tools registry reads `exec.signal.aborted` unguarded, so the engine call
  now always receives an `AbortSignal` (the command invocation's signal, or a
  fresh never-aborted one for signal-less callers).
- Input box freezing for up to ~90 s on `/refine <text>`: instruction triggers
  are now dispatched fire-and-forget in the host (own never-aborted signal, so
  request completion cannot cancel the refinement); rollback stays synchronous
  because it applies stored edits without an LLM round-trip.

[1.0.3]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.3
[1.0.2]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.2
[1.0.1]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.1
[1.0.0]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.0

# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[1.0.2]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.2
[1.0.1]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.1
[1.0.0]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.0

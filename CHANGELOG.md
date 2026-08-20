# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[1.0.0]: https://github.com/dushaobindoudou/dsh-refine/releases/tag/v1.0.0

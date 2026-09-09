# dsh-refine

**English** | [简体中文](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/dsh-refine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-refine)
[![npm downloads](https://img.shields.io/npm/dm/dsh-refine.svg?style=flat-square)](https://www.npmjs.com/package/dsh-refine)
[![License](https://img.shields.io/npm/l/dsh-refine.svg?style=flat-square)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/dushaobindoudou/dsh-refine/ci.yml?branch=main&style=flat-square&label=ci)](https://github.com/dushaobindoudou/dsh-refine/actions/workflows/ci.yml)

A refinement **UX layer** for the DeepSeek Harness (dsh): the `/refine` human
command plus a settings panel with entry browsing, a refinement history
timeline, one-click rollback, and auto-gate audit. It drives the
[`dsh-continual-harness`](https://github.com/jasen215/dsh-continual-harness)
engine, which is **optional at runtime** — when the engine is not mounted,
every operation degrades into an actionable instruction instead of an error.

The plugin is the **shell**, and since 1.2.0 it mounts the engine itself:
`dsh-continual-harness` starts as a child plugin under `ctx.isolate('commands')`,
so the engine's own `/refine` adapter never registers and dsh-refine keeps the
full command surface (`status` / `list` / `history` / `rollback` / triggers)
while forwarding the engine's `--global` / `--local` grammar to it. List only
`dsh-refine` in your profile's `dsh.profile.bundles`; a profile that still
mounts `dsh-continual-harness` as its own row keeps working — the shell detects
the already-registered engine, skips its own mount, and falls back to the
engine's `/refine`.

This project is a port and practical adaptation of the
[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) `/refine` idea
for the dsh ecosystem.

## Features

- **`/refine` command** — `status` / `list [kind]` / `history [n]` /
  `rollback <id>`, plus free-text refinement instructions (owned by the engine
  when it is mounted; provided by dsh-refine otherwise)
- **Settings panel** — harness timeline, entry browsing, one-click rollback,
  auto-gate audit
- **Bilingual & themed** — the panel reads the host locale (Simplified Chinese
  / English) and adapts to the dark and light themes through dsh design tokens
  with no hardcoded colors
- **Session-history compatibility** — the `harness/refinement` session event
  written by older engine builds is registered into the host reader so legacy
  refined-session logs stay loadable (the 0.3.0 engine self-registers and no
  longer writes it; dsh-refine keeps an idempotent defensive registration)
- **Host gap bridging** — where the installed engine's turn-time code reads
  `session.events` but the dsh host only exposes `snapshotEvents()`, dsh-refine
  installs a guarded `events` getter so the engine's projection/planner stops
  crashing with `Cannot read properties of undefined (reading 'length')`
- **Engine optional** — without the engine you get actionable setup guidance;
  nothing errors out, nothing pollutes the session

## Requirements

- Node.js ≥ 18
- dsh 0.1.2-rc.1+ (aligned `@deepseek-ai/dsh-home-paths` and
  `@deepseek-ai/dsh-typert-protocol`)

## Installation

Mount this package and the engine in your dsh profile (e.g.
`~/.dsh/profiles/web/cordis.yml`):

```yaml
plugins:
  - dsh-continual-harness   # the engine (optional, but required to actually trigger refinements)
  - dsh-refine              # this UX layer (required)
```

Or point at a local checkout with `link:` during development:

```yaml
plugins:
  - link:/path/to/dsh-refine
```

Restart `dsh web` to apply (host-side changes need a restart; client panel
changes hot-reload while `pnpm run dev:web` is running).

## Usage

### Command

| Input | Description |
| ----- | ----------- |
| `/refine status` | Overview of engine/rollback state |
| `/refine list [kind]` | List current entries (filter by `prompt`/`memory`/`skill`/`subagent`) |
| `/refine history [n]` | Recent refinement history (default 10, max 50) |
| `/refine rollback <id>` | Roll back one committed refinement (ids from `history`) |
| `/refine <any text>` | Trigger an engine refinement; returns immediately, results appear later in the panel / `history` |

> `/refine <text>` treats the text as a **refinement instruction** handed to
> the engine's planner. For ordinary chat, just type in the input box without
> the `/` prefix. When `dsh-continual-harness@0.3.0+` is mounted it owns
> `/refine` (plan + rollback); the panel below still offers the browse /
> timeline / one-click-rollback views.

### Panel

Settings → **Refine Harness**: a settings-style overview of engine and state
path, browse `prompt` / `memory` / `skill` / `subagent` entries, inspect the
history timeline and roll back with one click, and audit auto-gate decisions.

## How it works

```
engine mounted (dsh-continual-harness@0.3.0+):
  /refine  ──► engine's own /refine ──► coordinator ──► harness_state.json / refinements.jsonl

engine absent:
  /refine  ──► dsh-refine /refine ──► tools.execute('harness_refine') ──► actionable setup instruction

panel (always): 设置 → 精炼 Harness ──► refineUx data/rollback ──► ESP files + harness_refine
```

- Instruction triggers are **background fire-and-forget**: the engine and agent
  are validated synchronously, then the command acks immediately so the input
  box is never frozen for a planner round-trip; engine results land in the
  panel timeline and `/refine history`.
- Rollback is synchronous: it applies the stored inverse edits only, with no
  LLM round-trip.
- Session-event compatibility: `lib/compat.js` registers `harness/refinement`
  into the host reader's known event-type set (`KNOWN_SESSION_EVENT_TYPES`) —
  one registration keeps logs from older engine builds loadable; as of 0.3.0
  the engine no longer writes the event and self-registers the type itself.

## Development

```bash
npm install
npm run lint    # ESLint (lib/ + smoke-host.mjs)
npm test        # smoke suite — no engine required; extra host-registration
                # assertions run when dsh is on PATH
```

The smoke suite is hermetic: minimal engine ESP fixtures are bootstrapped
automatically when `~/.dsh/harness` lacks them, and it also exercises the real
dsh install paths for compatibility regression (skipped gracefully when `dsh`
is not on `PATH`). Run `DSH_HOME=/tmp/fresh npm test` to reproduce the CI
environment in a clean directory.

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit style, changelog policy, and
the release process; see [SECURITY.md](SECURITY.md) for reporting
vulnerabilities.

## License

[MIT](LICENSE) © dushaobindoudou

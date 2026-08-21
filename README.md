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

This project is a port and practical adaptation of the
[prime-agent](https://github.com/PrimeIntellect-ai/prime-agent) `/refine` idea
for the dsh ecosystem.

## Features

- **`/refine` command** — `status` / `list [kind]` / `history [n]` /
  `rollback <id>`, plus free-text refinement instructions
- **Settings panel** — harness timeline, entry browsing, one-click rollback,
  auto-gate audit
- **Session-history compatibility** — `harness/refinement` session events
  written by the engine are registered into the host reader, so refined session
  logs stay loadable (no data migration involved)
- **Engine optional** — without the engine you get actionable setup guidance;
  nothing errors out, nothing pollutes the session

## Requirements

- Node.js ≥ 18
- dsh 0.1.0-rc.6+ (with `@deepseek-ai/dsh-home-paths` and
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
> the `/` prefix.

### Panel

Settings → **Refine Harness**: browse entries, inspect the history timeline,
roll back with one click, and audit auto-gate decisions.

## How it works

```
/refine command ──► dsh-commands ──► dsh-refine (lib/index.js)
                      │                     │
                      │              tools.execute('harness_refine', {signal})
                      ▼                     ▼
               command/run+done      dsh-continual-harness engine
                      │                     │
                      └── harness/refinement session events
```

- Instruction triggers are **background fire-and-forget**: the engine and agent
  are validated synchronously, then the command acks immediately so the input
  box is never frozen for a planner round-trip; engine results land in the
  panel timeline and `/refine history`.
- Rollback is synchronous: it applies the stored inverse edits only, with no
  LLM round-trip.
- Session-event compatibility: `lib/compat.js` registers `harness/refinement`
  into the host reader's known event-type set (`KNOWN_SESSION_EVENT_TYPES`) —
  one registration heals both old logs and future writes.

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

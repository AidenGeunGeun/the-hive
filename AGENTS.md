# The Hive — Agent Rules

## Project Overview

Multi-agent deliberation system. Produces architectural proposals through structured agent discussion. No code generation — deliberation only. See ARCHITECTURE.md for full design.

## Setup

```bash
bun install          # Install all dependencies
bun run build        # Build all packages (turbo handles dependency order)
```

## Commands

```bash
bun run build        # Build all packages
bun run check        # Lint + format check (biome)
bun run check:fix    # Lint + format fix
bun run typecheck    # TypeScript type checking across all packages
bun run test         # Run all tests
bun run test:pkg <name>  # Run tests for a specific package
```

From a package directory:
```bash
bun run build        # Build this package only
bun test             # Run this package's tests only
```

## Code Style

- TypeScript strict mode. No `any` unless absolutely necessary.
- Biome for lint + format. Run `bun run check:fix` after changes.
- No inline imports. No `await import()`. Top-level imports only.
- No default exports. Named exports only.
- Prefer `interface` over `type` for object shapes.
- Prefer `readonly` for properties that should not be mutated.
- Error handling: explicit error types, no bare `throw new Error()`.

## Testing

- Vitest for all packages.
- Run the specific package test after changes: `bun run test:pkg <name>`.
- If you modify a test file, run it and iterate until it passes.
- Integration tests live in `test/eval/`. Do not run these without asking.

## Architecture — Hard Boundary Rules

These are inviolable. Breaking any of these is a structural defect.

### Package Dependency Rules

```
protocol    <- (no deps — base package)
config      <- protocol
context     <- protocol
providers   <- protocol (+ pi-ai as external)
room        <- protocol
workflow    <- protocol
storage     <- protocol
server      <- protocol, workflow, storage, config, providers, room, context
cli         <- protocol/wire ONLY
```

- **No package imports `server`.** Server is the composition root.
- **`cli` imports from `protocol/wire` only.** Never `protocol/engine`. Never any other package. Enforced by CI.
- **`room` receives agents, policies, and context as runtime arguments.** It does not import config, context, providers, workflow, storage, or server.
- **`workflow` has zero side effects.** Pure function: `apply(command, state) -> { newState, events, jobs }`. No I/O, no persistence, no network.
- **Only `storage` touches SQLite.** No other package reads or writes to the database.
- **Only `providers` imports provider SDKs** (including `@mariozechner/pi-ai`).
- **Only `server` writes to storage.** All other packages emit events or jobs.

### Protocol Wire vs Engine

- `@the-hive/protocol/wire` — stable public API. Breaking changes require major version bump.
- `@the-hive/protocol/engine` — internal shared contracts. Can change freely.
- If you are working on `cli`, you may ONLY import from `protocol/wire`.
- When adding types, decide: does this cross a process boundary (server <-> CLI)? If yes, it goes in `wire`. If no, it goes in `engine`.

### Persistence Authority

- Workflow event log = authoritative for task state.
- Ledger store = authoritative for decisions.
- Turn trace store = audit only. Not consumed during normal operation.
- Snapshots = recovery optimization. Derived, not authoritative.

### Sealed Agent Boundary

Agents in deliberation rooms can ONLY:
- Read their immutable ContextBundle
- Emit structured turns (typed actions)

Agents CANNOT: read files, write files, execute commands, auto-discover extensions, access the network. The Hive does NOT use pi-mono's agent runtime. Only `pi-ai` for provider abstraction.

## Git Rules

- Do not commit unless asked.
- Use `git add <specific-files>` only. Never `git add -A` or `git add .`.
- Commit message format: `type(scope): description` (e.g., `feat(room): add ledger implementation`).
- Scopes: `protocol`, `config`, `context`, `providers`, `room`, `workflow`, `storage`, `server`, `cli`, `docs`, `ci`.
- Do not force push. Do not use `--no-verify`.

## Critical Rules

- **Read ARCHITECTURE.md** before making structural changes.
- **Never add filesystem/shell/network tools to deliberation agents.** This violates the sealed boundary.
- **Never import `server` from any other package.**
- **Never import `protocol/engine` from `cli`.**
- **Never write to SQLite from outside `storage`.**
- **Never add side effects to `workflow`.** It is a pure reducer.
- **Always run `bun run check` after code changes.** Fix all errors before committing.

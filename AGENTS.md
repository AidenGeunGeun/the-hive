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
bun run test:pkg @the-hive/<name>  # Run tests for a specific package
bun run smoke        # End-to-end smoke test
bun run smoke:debug  # Smoke test with debug output
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

- Vitest for all packages (except server and storage which use `bun test` for bun:sqlite compatibility).
- Run all tests: `bun run test`.
- Run one package's tests: `bun run test:pkg @the-hive/<name>` (e.g., `bun run test:pkg @the-hive/room`).
- From a package directory: `bun test`.
- If you modify a test file, run it and iterate until it passes.

### Evaluation Tests

`test/eval/` contains integration-level evaluation tests: golden tasks, single-agent baselines, artifact scoring, cost/latency metrics. These are expensive (real LLM calls, real cost). Do not run these without asking.

## Architecture — Hard Boundary Rules

These are inviolable. Breaking any of these is a structural defect.

### Package Dependency Rules

```
protocol       <- (no deps — base package)
config         <- protocol
context        <- protocol
providers      <- protocol (+ pi-ai as external)
agent-runtime  <- protocol, providers
room           <- protocol
workflow       <- protocol
storage        <- protocol
server         <- protocol, workflow, storage, config, providers, agent-runtime, room, context
cli            <- protocol/wire ONLY
```

- **No package imports `server`.** Server is the composition root.
- **`cli` imports from `protocol/wire` only.** Never `protocol/engine`. Never any other package. Enforced by CI.
- **`room` receives agent runtimes, policies, and context refs as runtime arguments.** It does not import config, context, providers, agent-runtime, workflow, storage, or server.
- **`workflow` has zero side effects.** Pure function: `apply(command, state) -> { newState, events, jobs }`. No I/O, no persistence, no network.
- **Only `storage` touches SQLite.** No other package reads or writes to the database.
- **Only `providers` and `agent-runtime` import pi-ai.**
- **Only `server` writes to storage.** All other packages emit events or jobs.

### Protocol Wire vs Engine

- `@the-hive/protocol/wire` — stable public API. Breaking changes require major version bump.
- `@the-hive/protocol/engine` — internal shared contracts. Can change freely.
- If you are working on `cli`, you may ONLY import from `protocol/wire`.
- When adding types, decide: does this cross a process boundary (server <-> CLI)? If yes, it goes in `wire`. If no, it goes in `engine`.

### Persistence Authority

- Workflow event log = authoritative for task state.
- Room summaries = authoritative for decisions (extracted from transcripts).
- Room transcripts = evidence base. Summaries reference them.
- Turn traces = deep audit (agent loop internals). Not consumed during normal operation.
- Snapshots = recovery optimization. Derived, not authoritative.
- Pi session state is NOT authoritative. Treat as cache/optimization only.

### Agent Boundary

Deliberation agents run as Pi-powered agentic loops with **read-only** repo access:

Agents CAN:
- Read files in the repository (scoped to their domain by path policy)
- List directories
- Read the conversation transcript

Agents CANNOT:
- Write or modify files
- Execute shell commands
- Access the network
- Write to storage or any persistent state

The Hive uses `pi-ai` for model API abstraction. The `agent-runtime` package manages the agentic loop with read-only tools. All durable state is owned by the server.

## Prompts

`prompts/` contains system prompts for deliberation agents. These are injected at room start, not at build time.

- `prompts/room-base.md` — Base adversarial rules shared by all deliberation agents.
- `prompts/personas/*.md` — Domain-specific focus areas (frontend, backend, database, etc.).
- `prompts/team-lead.md` — Synthesis room rules for cross-domain integration.

When modifying prompts: these directly affect agent behavior in rooms. Changes here are design decisions, not code changes.

## Git Rules

- Do not commit unless asked.
- Use `git add <specific-files>` only. Never `git add -A` or `git add .`.
- Commit message format: `type(scope): description` (e.g., `feat(room): add agent runtime`).
- Scopes: `protocol`, `config`, `context`, `providers`, `agent-runtime`, `room`, `workflow`, `storage`, `server`, `cli`, `docs`, `ci`.
- Do not force push. Do not use `--no-verify`.

## Critical Rules

- **Read ARCHITECTURE.md** before making structural changes.
- **Never give agents write/shell/network access.** Read-only repo access only.
- **Never import `server` from any other package.**
- **Never import `protocol/engine` from `cli`.**
- **Never write to SQLite from outside `storage`.**
- **Never add side effects to `workflow`.** It is a pure reducer.
- **Never treat Pi session state as authoritative.** Own all durable state in storage.
- **Always run `bun run check` after code changes.** Fix all errors before committing.

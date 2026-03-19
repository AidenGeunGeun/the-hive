# The Hive — Architecture

## What This Is

The Hive is a multi-agent deliberation system. It produces architectural proposals through structured discussion between LLM agents. No code is written until a human approves the output. Implementation happens in a separate system.

## Core Philosophy

- Deliberation and implementation are separate systems. The Hive only deliberates.
- Agents reason from curated documentation (ContextBundles), never raw code.
- Human approval gates all implementation.
- The output is a structured decision ledger and rendered proposal artifact, not code.

## Architecture Overview

Two deliberation stages + human gate.

### Stage 1: Domain Rooms

3-5 agents per room, domain-scoped (frontend, backend, database, infra, etc.).

- Single-provider by default. Multi-provider is opt-in.
- Agents receive an immutable ContextBundle. No filesystem, no shell, no network, no auto-discovery.
- Agent tools are structured deliberation actions (see Ledger Action Vocabulary).
- Adversarial system prompts: agents must find flaws before agreeing, no empty agreement.
- Output: structured issue/decision ledger, rendered as report.md.

### Stage 2: Synthesis Room

One stronger model per domain.

- Input: ledgers from Stage 1 rooms.
- Focus: cross-system integration, API contracts, data flow, shared infrastructure.
- Can issue `query_room` jobs to Stage 1 rooms for targeted clarification (see Query-Back).
- Same kernel, different policies.
- Output: synthesis ledger, rendered as review packet with final_proposal.md.

### Human Gate

The human receives a review packet containing:

- Proposal artifact (final_proposal.md)
- Unresolved issues
- Dissent (risk_proposed items for human decision)
- Context gaps flagged by agents (request_context items)
- Evidence trace links
- Diff from prior version (if rerun)

The human approves, rejects with feedback, or cancels. Rejection loops back to Stage 1 with feedback injected. Max iteration cap prevents infinite deliberation.

The human gate is NOT a deliberation tier. It is an approval checkpoint.

## Room: Kernel + Policy

The room is split into a shared kernel and pluggable policies.

### Kernel (invariant across all room types)

- Deterministic turn sequencing (replayable)
- Append-only ledger management
- Raw turn trace capture (separate from ledger)
- Agent lifecycle (spawn, context injection, turn collection, teardown)
- Max_rounds enforcement
- Room health monitoring (active agent count vs minHealthyAgents)
- Semantic action validation (beyond schema: target issue exists, closure is legal, duplicate suppression, repeated closure cooldown)

### Policies (pluggable per room type)

**TurnPolicy** — who speaks next.
v1: deterministic round-robin.

**StopPolicy** — when is the room done.
v1: all issues resolved/deferred/risk_proposed AND no open objections from healthy agents, OR max_rounds, OR room health below quorum.

Closure mechanic: any agent can `propose_closure`. Closure finalizes only when no healthy agent has an open objection. Repeated identical closure proposals are rejected unless ledger state has changed since the last attempt.

**MemoryPolicy** — what context each agent sees per turn.
v1 default: unresolved-issue-scoped.
- Full ledger status (all issue titles + current states)
- Detailed history for unresolved issues only
- Resolved issues appear as status-only summaries
- System prompt + context bundle always included

**FailurePolicy** — what happens on agent error.
v1: retry once, then mark agent as failed. If active agents drop below minHealthyAgents, terminate room with `inconclusive_due_to_health`.

**ArtifactPolicy** — output structure.
Domain rooms: ledger rendered as report.md.
Synthesis room: ledger rendered as review packet with final_proposal.md.

## Structured Issue/Decision Ledger

The ledger is the truth source for decisions. Reports are deterministic renders.

### Action Vocabulary (v1 — 8 actions)

```
create_issue(title, description, assumptions?)
  Opens a new issue. Creator attributed. Optional assumptions recorded inline.

challenge(targetIssueId, argument, evidence?)
  Counterargument targeting a specific issue. Voids any pending propose_closure on that issue.

propose_resolution(targetIssueId, proposal, evidence?)
  Concrete solution for an issue.

propose_closure(targetIssueId, rationale, closureType: "resolved" | "deferred" | "risk_proposed")
  Any agent can propose closing an issue.
  Closure finalizes when no healthy agent has an open objection.
  "risk_proposed" means the agent proposes accepting the risk. Only human review
  can transition this to "risk_accepted."
  Repeated identical proposals are rejected unless ledger state changed.

reopen_issue(targetIssueId, reason, newEvidence?)
  Reopen a previously closed issue with new information.

request_context(description, justification)
  Agent explicitly signals missing context. Logged in ledger.
  Surfaced in review packet as a context gap.

record_decision(targetIssueId?, decision, rationale, rejectedAlternatives?)
  Records a design decision with rationale and rejected alternatives.

link_issues(sourceId, targetId, relation: "blocks" | "depends_on" | "duplicates")
  Establishes a relationship between issues.
```

### Issue Lifecycle

```
open -> challenged -> proposed_resolution -> closure_proposed -> resolved / deferred / risk_proposed
```

Any state can return to `open` via `challenge` or `reopen_issue`.

`risk_proposed` is an agent-side terminal state. Only the human review flow may transition it to `risk_accepted`.

### Multiple Actions Per Turn

A turn is a typed object. Multiple actions per turn are allowed (e.g., challenge + counterproposal + evidence in one turn). No artificial bandwidth limitation.

## Query-Back from Synthesis

When the synthesis room identifies a cross-domain conflict it cannot resolve from ledgers alone:

1. Synthesis agent emits `query_room(targetRoomId, question, relevantIssueIds)`.
2. Workflow transitions internal phase: `synthesis` -> `query_back`.
3. Server dispatches: creates a bounded mini-cycle in the target source room.
   - Same agents, same context, plus the targeted question.
   - StopPolicy: answer the question, max 3 rounds.
4. Source room produces a focused answer as a **versioned QueryResponseArtifact** linked to the source room and issue IDs. This is NOT appended to the original source ledger.
5. Answer returns to synthesis room's context.
6. Workflow transitions: `query_back` -> `synthesis`.

Bounded: max query-backs per synthesis session is configurable (default 3).

## Sealed Agent Boundary

Agents in the Hive can:
- Read their immutable ContextBundle
- Emit structured turns (typed actions appended to the ledger)

Agents in the Hive cannot:
- Read arbitrary files
- Write files
- Execute shell commands
- Auto-discover extensions, prompts, or project-local files
- Access the network

The Hive does NOT use pi-mono's agent-core or coding-agent runtime. It uses `pi-ai` only for model API normalization. The deliberation agent wrapper is purpose-built: context bundle in, typed actions out.

## Context Bundles

Agents consume immutable, versioned ContextBundles. Not repos.

A ContextBundle may include:
- AGENTS.md content (per domain)
- API schemas (OpenAPI, GraphQL)
- Dependency manifests (package.json, go.mod, Cargo.toml)
- DB schemas
- Architecture docs
- Staleness metadata (last-verified timestamps per section)

Built by `@the-hive/context` at task start. Immutable for the duration of a deliberation cycle. Staleness is visible to agents. If agents identify missing context, they emit `request_context` actions.

## Workflow: Pure Reducer

```
apply(command, state) -> { newState, events, jobs }
```

- Zero side effects.
- Does not touch persistence.
- Does not dispatch jobs.
- Does not own authoritative state.
- Fully testable without server, database, or network.

The server calls `apply()`, persists state via storage, dispatches jobs, and broadcasts events.

## Task Lifecycle

### External States (visible to CLI/UI)

```
submitted -> running -> awaiting_review -> approved / rejected / failed / cancelled
```

### Internal Phases (inside "running")

```
mini_rooms -> synthesis -> query_back -> synthesis -> rendering -> rerun
```

Rejection loops `running -> awaiting_review` with max iteration cap.

## Protocol: Wire vs Engine

One package, two entrypoints, **enforced** separation.

### `@the-hive/protocol/wire` (stable — breaking changes require major version bump)

What crosses process boundaries (server <-> CLI/UI):
- Task DTOs (external lifecycle states)
- Commands (submit_task, approve, reject, cancel)
- Events (task_state_changed, room_started, room_completed)
- Review packet schema (rendered ledger view, proposal, context gaps, dissent)
- Error codes
- Protocol version and compatibility

### `@the-hive/protocol/engine` (internal — can change freely)

Shared internal contracts:
- Agent interface
- Policy interfaces (TurnPolicy, StopPolicy, MemoryPolicy, FailurePolicy, ArtifactPolicy)
- Full ledger schema (internal detail, includes raw issue graph)
- Context bundle types
- Room kernel types
- Turn and action type definitions
- Room health types
- QueryResponseArtifact type

Enforcement: package.json exports restrict what can be imported. CI checks (grep-based boundary validation in `.github/workflows/ci.yml`) verify that cli only imports from `protocol/wire` and no package imports server. Documented in AGENTS.md.

## Persistence

### Authority Model

| Store | Authoritative for | Package |
|-------|-------------------|---------|
| Workflow event log | Task state and lifecycle transitions | storage |
| Ledger store | Decisions, issues, resolutions, evidence | storage |
| Turn trace store | Raw model outputs, parse results, timing, token usage | storage |
| Snapshots | Recovery optimization (derived from event log) | storage |

- Workflow event log is the authority for "what state is this task in."
- Ledger is the authority for "what decisions were made."
- Turn traces are audit-only. Not consumed by other system components during normal operation.
- Snapshots are a recovery optimization, derived from the event log. Not authoritative.

### Hard Rules

- All stores are append-only.
- Only the `storage` package touches SQLite.
- Only the `server` writes to storage. All other packages emit events or jobs.
- Server is the single SQLite writer (no concurrent write contention by design).

## Package Structure

9 packages + 1 non-package test directory. Each has one responsibility.

### Dependency Graph

```
protocol (base — no deps)
  ^
  |-- config
  |-- context
  |-- providers (+ pi-ai)
  |-- room
  |-- workflow
  |-- storage
  |-- cli (wire entrypoint only)
  |
  server (protocol + workflow + storage + config + providers + room + context)
```

### Hard Boundary Rules

- No package except `storage` touches SQLite.
- No package except `providers` imports provider SDKs (including pi-ai).
- No package imports `server`.
- `workflow` has zero side effects.
- `cli` imports from `protocol/wire` only. Enforced by lint + CI.
- `room` receives agents, policies, and context as runtime arguments. It does not import config, context, providers, workflow, storage, or server.
- Contributors: `protocol/wire` is public API. `protocol/engine` is internal.

### Package Responsibilities

**@the-hive/protocol** — Types, interfaces, schemas. Two entrypoints: wire (stable) and engine (internal). No logic, no side effects.

**@the-hive/config** — Config loading, validation, defaults. Team/room/provider/policy definitions. Deps: protocol.

**@the-hive/context** — Builds immutable ContextBundles from docs, schemas, manifests. Staleness detection. Deps: protocol.

**@the-hive/providers** — Model/provider adapters over pi-ai. Capability matrix (structured output support, tool calling, context limits, cost). Structured-output normalization. Retry and rate-limit handling. Only package that imports pi-ai or provider SDKs. Deps: protocol.

**@the-hive/room** — Room kernel + built-in policy implementations. Turn sequencing, ledger management, room health monitoring, raw turn trace capture, semantic action validation. Receives agents, policies, context as runtime arguments. Deps: protocol.

**@the-hive/workflow** — Pure state machine reducer. Task lifecycle. Escalation logic. Query-back job emission. Zero side effects, zero persistence. Deps: protocol.

**@the-hive/storage** — SQLite schema, migrations, repositories, ledger store, turn trace store, workflow event log, snapshots. Only package that touches SQLite. Deps: protocol.

**@the-hive/server** — Runtime host. Authoritative state writes. Job dispatch (receives jobs from workflow, dispatches to rooms). WebSocket API (protocol/wire messages only). Headless mode. Composition root: wires all packages together. Deps: protocol, workflow, storage, config, providers, room, context.

**@the-hive/cli** — Stateless WebSocket client. Terminal UI. Approve/reject flow. Zero server imports. Deps: protocol/wire.

**test/eval** (non-package) — Golden tasks, single-agent baselines, replay from turn traces, artifact scoring, cost/latency metrics. Evaluation gate: Hive must beat a single-agent role-play baseline on golden tasks at acceptable cost and latency before multi-agent features expand.

## Evaluation Requirements

The product hypothesis (structured multi-agent deliberation produces better architectural proposals than a single strong agent) must be empirically validated.

### Eval Gate

Before expanding multi-agent features:
1. Hive must produce measurably better proposals than a single strong agent with the same ContextBundle and role-play prompt.
2. Cost multiplier no greater than 5x the single-agent baseline.
3. Latency no greater than 3x the single-agent baseline.
4. Blinded human scoring on proposal quality.
5. Holdout tasks (not in the development set).
6. Hard rule: ties go to the simpler single-agent baseline.

If the baseline wins, the architecture needs fundamental reconsideration.

## Diagrams

### System Flow

```
Human
  | (submit task)
  v
Server (authoritative state, persistence, dispatch)
  | (apply command)
  v
Workflow (pure reducer: command + state -> events + jobs)
  | (emit jobs)
  v
Room Kernel + Policies
  | (context bundle in, structured ledger out)
  v
Agents (sealed: immutable context read + typed actions only)
  | (LLM calls)
  v
Providers (model adapters, normalization)
```

### Deliberation Pipeline

```
Task submitted
  |
  v
Stage 1: Domain rooms (mini agents)
  |-- Frontend room -> ledger + report.md
  |-- Backend room  -> ledger + report.md
  |-- Database room -> ledger + report.md
  |
  v
Stage 2: Synthesis room (lead models)
  |-- Reads Stage 1 ledgers
  |-- May issue query_room -> bounded mini-cycle -> QueryResponseArtifact
  |-- Produces synthesis ledger + review packet
  |
  v
Human gate
  |-- Approve -> done
  |-- Reject + feedback -> Stage 1 (rerun, max iterations capped)
  |-- Cancel -> cancelled
```

### Task State Machine

```
External:  submitted -> running -> awaiting_review -> approved
                                                   -> rejected -> running (rerun)
                                                   -> failed
                                                   -> cancelled

Internal (within "running"):
  mini_rooms -> synthesis -> [query_back -> synthesis] -> rendering
```

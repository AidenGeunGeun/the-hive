# The Hive — Architecture

## What This Is

The Hive is a multi-agent deliberation system. It produces architectural proposals through structured discussion between LLM agents. No code is written until a human approves the output. Implementation happens in a separate system.

## Core Philosophy

- Deliberation and implementation are separate systems. The Hive only deliberates.
- Agents are tool-using agentic loops with read access to the repository. They investigate, reason, and discuss.
- Human approval gates all implementation.
- The output is an extracted room summary with evidence, rendered as a review packet. Not code.

## Architecture Overview

Two deliberation stages + human gate.

### Stage 1: Domain Rooms

3-5 agents per room, domain-scoped (frontend, backend, database, infra, etc.).

- Each agent is a Pi instance running a bounded agentic loop with read-only repo tools.
- Agents explore the codebase within their domain scope, read what they need, and form positions.
- Adversarial system prompts: agents must find flaws before agreeing, no empty agreement.
- Each turn produces a natural language contribution with lightweight structured signals (stance, blockers, cited files).
- Room summary is extracted from the conversation transcript after the room concludes.
- Output: extracted RoomSummary + full transcript for audit.

### Stage 2: Synthesis Room

One stronger model per domain.

- Input: Stage 1 room summaries (not full transcripts by default).
- Focus: cross-system integration, API contracts, data flow, shared infrastructure.
- Synthesis agents also run agentic loops with read-only repo access.
- Can issue `query_room` jobs to Stage 1 rooms for targeted clarification (see Query-Back).
- Output: synthesis summary, rendered as review packet with final_proposal.md.

### Human Gate

The human receives a review packet containing:

- Proposal artifact (final_proposal.md)
- Unresolved issues with transcript references
- Dissent (risks proposed for human decision)
- Context gaps flagged by agents
- Evidence trace links (cited file spans with repo snapshot refs)
- Extraction confidence score and coverage warnings
- Diff from prior version (if rerun)

The human approves, rejects with feedback, or cancels. Rejection loops back to Stage 1 with feedback injected. Max iteration cap prevents infinite deliberation.

The human gate is NOT a deliberation tier. It is an approval checkpoint.

## Agent Model

### Agents Are Pi Instances

Each deliberation agent is a Pi instance — a bounded agentic loop powered by `pi-ai`.

An agent's turn is not a single completion call. It is a loop: the agent reads files, reasons, reads more, and produces its contribution when ready. The loop is bounded by wall-clock time and max rounds. Within those bounds, the agent has autonomy over what it reads and how it reasons.

### Read-Only Repo Access

Agents can:
- Read files in the repository (scoped to their domain by path policy)
- List directories
- Read the conversation transcript so far (other agents' contributions)

Agents cannot:
- Write or modify files
- Execute shell commands
- Access the network
- Write to storage or any persistent state

The Hive uses `pi-ai` for model API abstraction. The agent runtime provides read-only tools and manages the agentic loop. All durable state is owned by the server, not by Pi sessions.

### Turn Structure

Each turn produces a contribution with lightweight structured signals:

```
TurnContribution {
  bodyMarkdown: string          // natural language — the agent's full position
  citedFiles: FileSpanRef[]     // files read and referenced as evidence
  stance: "support" | "object" | "uncertain"
  wantsClosure: boolean         // signal for convergence detection
  blockers: string[]            // explicit unresolved concerns
}
```

The body is natural language. The signals are for the room kernel's stop policy. This replaces the previous 8-action ledger vocabulary as per-turn output.

### Graceful Failure

If an agent's loop fails (provider error, timeout, crash), the runtime should:
1. Attempt to resume from the last stable point in the loop.
2. If resume fails, mark the agent as degraded for this turn.
3. If an agent fails repeatedly, mark it as failed. Room health checks apply.

## Room: Kernel + Policy

The room kernel is deterministic in its **outer scheduling** and non-deterministic only **inside each agent's turn runtime**.

### Kernel (invariant across all room types)

- Deterministic turn sequencing (round-robin scheduling is replayable)
- Conversation transcript management (append contributions, build context for next agent)
- Turn trace capture (full agentic loop traces, not just final output)
- Agent lifecycle (create runtime handle, inject context, run turn, collect contribution, teardown)
- Max_rounds enforcement
- Room health monitoring (active agent count vs minHealthyAgents)
- Wall-clock budget enforcement per turn and per room

### Turn Flow

For each turn, the kernel passes a TurnBrief to the agent runtime:

- Task prompt and persona
- Conversation transcript so far (previous agents' contributions)
- Repo snapshot reference
- Domain-scoped path allowlist
- Wall-clock budget

The runtime executes the Pi loop and returns a TurnContribution.

### Policies (pluggable per room type)

**TurnPolicy** — who speaks next.
v1: deterministic round-robin.

**StopPolicy** — when is the room done.
v1: stop when all healthy agents signal `support` or `support with reservations` and no high-severity blockers remain, or when no new issues were raised in the last full round, or max_rounds, or room health below quorum.

**MemoryPolicy** — what conversation context each agent sees per turn.
v1: full transcript of all contributions. Agents manage their own relevance filtering through what they choose to read and respond to.

**FailurePolicy** — what happens on agent error.
v1: attempt resume, then retry once, then mark agent as failed. If active agents drop below minHealthyAgents, terminate room with `inconclusive_due_to_health`.

**ArtifactPolicy** — output structure.
Domain rooms: extracted RoomSummary.
Synthesis room: extracted synthesis summary, rendered as review packet.

## Room Summary Extraction

After a room conversation concludes, structured data is extracted from the transcript. This is a multi-stage process, not a single summarizer pass.

### Extraction Pipeline

1. **Turn-local extraction** — After each turn, extract candidate issues, decisions, risks, objections, and evidence references.
2. **Room reducer** — Merge turn-level candidates into a canonical RoomSummary.
3. **Coverage validator** — A second pass checking: "What did the reducer miss? What disagreements remain? Which claims lack evidence?"

### Canonical Room Output

```
RoomSummary {
  roomId: string
  outcome: "completed" | "inconclusive"
  issues: IssueSummary[]          // identified concerns
  decisions: DecisionSummary[]    // resolved decisions with rationale
  risks: RiskSummary[]            // proposed risks for human decision
  contextGaps: ContextGap[]       // missing information flagged by agents
  dissent: DissentItem[]          // unresolved disagreements
  evidence: EvidenceRef[]         // file spans, transcript turns, excerpts
  extractionConfidence: number    // 0-1 confidence score
  coverageWarnings: string[]      // what the validator flagged
}
```

Every extracted item points to: transcript turn IDs, file path + snapshot ref + line spans, and excerpt snippets.

**Transcript is evidence. Room summary is authority.**

## Context: Repo Snapshots

The `context` package manages repository access for deliberation cycles.

### What Context Provides

- **Repo snapshot** — A fixed reference point for the codebase. All agents in a cycle read from the same snapshot. No mid-deliberation mutations.
- **Domain scoping** — Path allowlists per domain room. A frontend room sees `packages/frontend/`, `packages/ui/`, shared configs. A backend room sees `packages/api/`, `packages/server/`, etc. Configured, not inferred.
- **Manifest** — Lightweight metadata: directory tree, package.json dependency graph, file sizes. Available to agents without reading every file.

### What Context Does NOT Do

- Pre-build curated bundles. Agents explore the repo themselves.
- Parse or interpret file contents. That's the agent's job.
- Manage embeddings or knowledge graphs. Those may layer on later as optional tools.

Domain scoping is the primary guard against agents reading irrelevant files and wasting tokens. The repo snapshot ensures consistency across the deliberation cycle.

## Query-Back from Synthesis

When the synthesis room identifies a cross-domain conflict it cannot resolve from room summaries alone:

1. Synthesis agent signals a query-back need.
2. Workflow transitions internal phase: `synthesis` -> `query_back`.
3. Server dispatches: creates a bounded mini-cycle in the target source room.
   - Same agents, same repo snapshot, plus the targeted question.
   - StopPolicy: answer the question, max 3 rounds.
4. Source room produces a focused answer as a **versioned QueryResponseArtifact**. This is NOT a mutation of the original room summary.
5. Answer returns to synthesis room's context.
6. Workflow transitions: `query_back` -> `synthesis`.

Bounded: max query-backs per synthesis session is configurable (default 3).

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

The workflow does not know or care about agent internals. It sees jobs (`prepare_repo_snapshot`, `run_domain_room`, `run_synthesis_room`, `render_review_packet`) and their completion signals.

## Task Lifecycle

### External States (visible to CLI/UI)

```
submitted -> running -> awaiting_review -> approved / rejected / failed / cancelled
```

### Internal Phases (inside "running")

```
preparing_snapshot -> mini_rooms -> synthesis -> query_back -> synthesis -> rendering -> rerun
```

Rejection loops `running -> awaiting_review` with max iteration cap.

## Protocol: Wire vs Engine

One package, two entrypoints, **enforced** separation.

### `@the-hive/protocol/wire` (stable — breaking changes require major version bump)

What crosses process boundaries (server <-> CLI/UI):
- Task DTOs (external lifecycle states)
- Commands (submit_task, approve, reject, cancel)
- Events (task_state_changed, room_started, room_completed)
- Review packet schema (extracted summary view, proposal, evidence, dissent)
- Error codes
- Protocol version and compatibility

### `@the-hive/protocol/engine` (internal — can change freely)

Shared internal contracts:
- Agent runtime interface
- TurnBrief and TurnContribution types
- Policy interfaces (TurnPolicy, StopPolicy, MemoryPolicy, FailurePolicy, ArtifactPolicy)
- RoomSummary and extraction types
- Room kernel types
- Room health types
- Repo snapshot and path policy types
- QueryResponseArtifact type

Enforcement: package.json exports restrict what can be imported. CI checks verify that cli only imports from `protocol/wire` and no package imports server.

## Persistence

### Authority Model

| Store | Authoritative for | Package |
|-------|-------------------|---------|
| Workflow event log | Task state and lifecycle transitions | storage |
| Room summaries | Decisions, issues, risks, evidence (extracted) | storage |
| Room transcripts | Full conversation record (contributions + metadata) | storage |
| Turn traces | Agent loop internals: LLM calls, tool uses, file reads | storage |
| Snapshots | Recovery optimization (derived from event log) | storage |

- Workflow event log is the authority for "what state is this task in."
- Room summary is the authority for "what decisions were made."
- Transcripts are the evidence base. Summaries reference them.
- Turn traces are deep audit. Tool calls, file reads, LLM request/response within each agent loop.
- Snapshots are a recovery optimization, derived from the event log. Not authoritative.

### Hard Rules

- All stores are append-only.
- Only the `storage` package touches SQLite.
- Only the `server` writes to storage. All other packages emit events or jobs.
- Server is the single SQLite writer (no concurrent write contention by design).
- Pi session state is NOT authoritative. If Pi sessions can be cached/resumed, treat it as optimization, not truth.

## Package Structure

10 packages + 1 non-package test directory.

### Dependency Graph

```
protocol (base — no deps)
  ^
  |-- config
  |-- context         (repo snapshots, manifests, domain scoping)
  |-- providers       (model registry, pi-ai adapters, pricing/capabilities)
  |-- agent-runtime   (Pi loop, read-only tools, trace capture, graceful failure)
  |-- room            (conversation orchestration, turn scheduling, convergence, extraction)
  |-- workflow
  |-- storage
  |-- cli (wire entrypoint only)
  |
  server (composition root — all packages)
```

### Hard Boundary Rules

- No package except `storage` touches SQLite.
- No package except `providers` and `agent-runtime` imports pi-ai.
- No package imports `server`.
- `workflow` has zero side effects.
- `cli` imports from `protocol/wire` only. Enforced by lint + CI.
- `room` receives agent runtimes, policies, and context refs as runtime arguments.
- Contributors: `protocol/wire` is public API. `protocol/engine` is internal.

### Package Responsibilities

**@the-hive/protocol** — Types, interfaces, schemas. Two entrypoints: wire (stable) and engine (internal). No logic, no side effects.

**@the-hive/config** — Config loading, validation, defaults. Team/room/provider/policy definitions. Domain-to-path mappings. Deps: protocol.

**@the-hive/context** — Repo snapshot management, domain-scoped path policies, directory manifests. Provides read-only access surface for agent runtimes. Deps: protocol.

**@the-hive/providers** — Model/provider registry over pi-ai. Capability matrix (tool calling, context limits, cost). Only package that imports pi-ai provider SDKs. Deps: protocol.

**@the-hive/agent-runtime** — Pi-powered agentic loop for deliberation agents. Read-only tools (file read, directory list). Trace capture for every substep. Graceful failure and resume. Wall-clock enforcement. Deps: protocol, providers.

**@the-hive/room** — Room kernel + policy implementations. Turn scheduling, conversation management, convergence detection, room health. Room summary extraction pipeline (turn-local → reducer → coverage validator). Deps: protocol.

**@the-hive/workflow** — Pure state machine reducer. Task lifecycle. Escalation logic. Query-back job emission. Zero side effects, zero persistence. Deps: protocol.

**@the-hive/storage** — SQLite schema, migrations, repositories. Stores: workflow events, room summaries, room transcripts, turn traces, review packets, repo snapshot metadata. Only package that touches SQLite. Deps: protocol.

**@the-hive/server** — Runtime host. Authoritative state writes. Job dispatch (receives jobs from workflow, dispatches to rooms). WebSocket API (protocol/wire messages only). Headless mode. Composition root: wires all packages together. Deps: all packages.

**@the-hive/cli** — Stateless WebSocket client. Terminal UI. Approve/reject flow. Zero server imports. Deps: protocol/wire.

**test/eval** (non-package) — Golden tasks, single-agent baselines, artifact scoring, cost/latency metrics.

## Evaluation Requirements

The product hypothesis (structured multi-agent deliberation produces better architectural proposals than a single strong agent) must be empirically validated.

### Eval Gate

Before expanding multi-agent features:
1. Hive must produce measurably better proposals than a single strong agent **with the same repo snapshot and tools**.
2. Cost multiplier no greater than 5x the single-agent baseline.
3. Latency no greater than 3x the single-agent baseline.
4. Blinded human scoring on proposal quality.
5. Holdout tasks (not in the development set).
6. Hard rule: ties go to the simpler single-agent baseline.

The baseline gets the same repo access and tools as Hive agents. The comparison tests multi-agent deliberation value, not tool access advantage.

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
  | (orchestrate agent turns, manage conversation, detect convergence)
  v
Agent Runtime (Pi loop: read files, reason, produce contribution)
  | (read-only repo access via context)
  v
Providers (model registry, pi-ai adapters)
```

### Deliberation Pipeline

```
Task submitted
  |
  v
Prepare repo snapshot + domain scoping
  |
  v
Stage 1: Domain rooms (mini agents, agentic loops)
  |-- Frontend room -> transcript + extracted RoomSummary
  |-- Backend room  -> transcript + extracted RoomSummary
  |-- Database room -> transcript + extracted RoomSummary
  |
  v
Stage 2: Synthesis room (stronger models, agentic loops)
  |-- Reads Stage 1 room summaries
  |-- May issue query_room -> bounded mini-cycle -> QueryResponseArtifact
  |-- Produces synthesis summary + review packet
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
  preparing_snapshot -> mini_rooms -> synthesis -> [query_back -> synthesis] -> rendering
```

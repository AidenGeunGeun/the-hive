# The Hive — Implementation Plan

Contracts-first, then vertical slices. Do not finish every package horizontally before integrating.

## Execution Order

1. **Phase 0–1** — Freeze boundaries and contracts.
2. **Phase 2 + Phase 3 in parallel** — Build state authority and room core.
3. **Phase 4** — Prove a live room before adding more orchestration.
4. **Phase 5** — Prove a real end-to-end path with one room.
5. **Phase 6** — Replace fixtures with real context bundles and multi-room Stage 1.
6. **Phase 7** — Add synthesis and human review.
7. **Phase 8** — Add query-back and rerun only after nominal flow works.
8. **Phase 9** — Run the eval gate before expanding feature scope.

## Parallelization Opportunities

After **Phase 1** is frozen:

- **Track A:** `workflow` + `storage`
- **Track B:** `room` kernel + scripted agents
- **Track C:** `config` polish + fixture generation

After **Phase 3**:

- **Track D:** `providers` live turn execution
- **Track E:** CLI shell and wire client
- **Track F:** initial eval fixture authoring

After **Phase 5**:

- **Track G:** `context` bundle builder
- **Track H:** synthesis renderer + review packet UI

Rules for safe parallelization:

- nobody changes `protocol/wire` casually after Phase 1
- `protocol/engine` can evolve, but only through PRs that update scripted-room fixtures
- `storage` schema changes after Phase 2 require migration tests before merge

---

## Phase 0 — Repository guardrails and enforceable boundaries

**Goal**
Make architectural violations mechanically hard before any business logic exists.

**Packages involved**
root, `@the-hive/protocol`, `@the-hive/cli`, `@the-hive/server`

**Concrete deliverables**

- Root `tsconfig.base.json` with:
  - `strict: true`
  - `noUncheckedIndexedAccess: true`
  - `exactOptionalPropertyTypes: true`
  - `useUnknownInCatchVariables: true`
  - `verbatimModuleSyntax: true`
  - `noImplicitOverride: true`
- Root scripts:
  - `typecheck`
  - `lint`
  - `test`
  - `check-boundaries`
  - `check-no-default-exports`
  - `check-no-explicit-any`
- `package.json` exports in `@the-hive/protocol`:
  - `"./wire"`
  - `"./engine"`
  - no root catch-all export
- CI checks:
  - CLI may import only `@the-hive/protocol/wire`
  - no package may import `@the-hive/server`
  - only `providers` may import `@mariozechner/pi-ai`
  - only `storage` may import `bun:sqlite`
- Root coding conventions doc:
  - public object shapes use `interface`
  - discriminated unions may use `type`
  - named exports only
  - no bare `throw new Error()`

**What must be complete before this phase starts**
Nothing.

**Test strategy**

- Deliberately add a banned import in a fixture file; CI must fail.
- Deliberately add `export default`; CI must fail.
- Deliberately add `as any`; CI must fail.

**Integration checkpoint**

- A dummy PR that violates each rule fails for the right reason.

**Risks**

- Overbuilding lint rules. Keep them simple and grep-based if needed.
- Biome may not enforce all repo-specific rules alone; accept small custom scripts.

---

## Phase 1 — Freeze contracts first: protocol and config

**Goal**
Define the shared shapes once so every package can build against them without guessing.

**Packages involved**
`@the-hive/protocol`, `@the-hive/config`

**Concrete deliverables**

### `@the-hive/protocol/wire`

Export interfaces **and** runtime schemas for:

- `ProtocolVersion`
- `SubmitTaskCommand`
- `ApproveTaskCommand`
- `RejectTaskCommand`
- `CancelTaskCommand`
- `SubscribeTaskCommand`
- `GetTaskSnapshotCommand`
- `WireCommandEnvelope`
- `TaskStateChangedEvent`
- `RoomStartedEvent`
- `RoomCompletedEvent`
- `TaskReviewReadyEvent`
- `TaskFailedEvent`
- `TaskCancelledEvent`
- `WireEventEnvelope`
- `ReviewPacketView`
- `ReviewPacketDiffView`
- `WireError`

Suggested command shapes:

```ts
interface SubmitTaskCommand {
  readonly kind: "submit_task";
  readonly commandId: string;
  readonly taskId: string;
  readonly prompt: string;
  readonly bundleInput: BundleInputRef;
  readonly requestedDomains?: readonly string[];
  readonly configProfile?: string;
  readonly submittedAtMs: number;
}
```

```ts
interface RejectTaskCommand {
  readonly kind: "reject_task";
  readonly commandId: string;
  readonly taskId: string;
  readonly feedback: readonly string[];
  readonly submittedAtMs: number;
}
```

```ts
interface ReviewPacketView {
  readonly taskId: string;
  readonly version: number;
  readonly proposalMarkdown: string;
  readonly unresolvedIssues: readonly IssueSummaryView[];
  readonly riskProposals: readonly RiskProposalView[];
  readonly contextGaps: readonly ContextGapView[];
  readonly evidenceLinks: readonly EvidenceTraceLinkView[];
  readonly diffFromPrevious?: ReviewPacketDiffView;
  readonly generatedAtMs: number;
}
```

### `@the-hive/protocol/engine`

Export interfaces for:

- IDs and refs:
  - `TaskId`, `RoomId`, `AgentId`, `IssueId`, `TurnId`, `QueryResponseArtifactId`
- task state:
  - `WorkflowState`
  - `ExternalTaskState`
  - `InternalPhase`
  - `PendingJob`
- room contracts:
  - `RoomSpec`
  - `RoomKind` = `"domain" | "synthesis" | "query_back"`
  - `AgentSpec`
  - `RoomRunResult`
  - `RoomHealth`
- agent contracts:
  - `Agent`
  - `AgentTurnInput`
  - `AgentTurnOutput`
  - `ParsedTurn`
- turn payload:
  - `SubmitTurnPayload`
  - `LedgerAction`
  - `RoomControlAction`
  - `QueryRoomAction`
- ledger contracts:
  - `LedgerEntry`
  - `IssueRecord`
  - `DecisionRecord`
  - `IssueRelation`
  - `ClosureProposal`
- context:
  - `ContextBundle`
  - `ContextSection`
  - `StalenessMetadata`
- query-back:
  - `QueryResponseArtifact`
  - `RoomRevisionRef`
- errors:
  - `EngineErrorCode`
  - `StorageErrorCode`
  - `ProviderErrorCode`

**Important implementation decision**

Do **not** model the provider surface as 8 independent tool calls. Define **one** turn-emission payload:

```ts
interface SubmitTurnPayload {
  readonly summary: string;
  readonly ledgerActions: readonly LedgerAction[];
  readonly controlActions: readonly RoomControlAction[];
}
```

This preserves turn atomicity, makes trace capture sane, and avoids grouping multiple tool calls after the fact.

### `@the-hive/config`

Export:

- `HiveConfig`
- `ProviderProfileConfig`
- `ModelSelectionConfig`
- `RoomTemplateConfig`
- `PolicyConfig`
- `ServerConfig`
- `StorageConfig`
- `loadConfig(path: string): Promise<HiveConfig | ConfigLoadError>`
- `validateConfig(input: unknown): ValidationResult<HiveConfig>`
- `buildDefaultConfig(): HiveConfig`

Minimum config fields:

```ts
interface RoomTemplateConfig {
  readonly kind: "domain" | "synthesis" | "query_back";
  readonly maxRounds: number;
  readonly minHealthyAgents: number;
  readonly turnPolicy: "round_robin";
  readonly stopPolicy: "no_open_objections";
  readonly memoryPolicy: "unresolved_issue_scoped";
  readonly failurePolicy: "retry_once_then_fail";
}
```

Validation rules:

- `maxRounds > 0`
- `minHealthyAgents >= 1`
- `minHealthyAgents <= agentCount`
- `queryBack.maxPerSynthesis >= 0`
- no duplicate room ids
- only synthesis rooms may emit `query_room`
- `risk_accepted` may not appear in engine-side configs or enums

**What must be complete before this phase starts**

- Phase 0 boundary enforcement.

**Test strategy**

- Schema round-trip tests for every wire command/event.
- Invalid config fixtures:
  - `minHealthyAgents > agents.length`
  - duplicate domain room ids
  - unsupported policy names
  - negative query-back caps
- Snapshot tests for `protocol/wire` JSON examples.

**Integration checkpoint**

- Every other package can compile against protocol/config with zero stub guessing.

**Risks**

- The architecture does **not** specify the wire subscription model. Decide it here.
- The architecture does **not** specify whether task submission carries a path, a bundle spec, or a prebuilt bundle ref. Decide it here.
- Do not let `wire` and `engine` share barrels; keep separate exports from day one.

---

## Phase 2 — Workflow reducer and storage authority

**Goal**
Make state authority real before any live LLM logic exists.

**Packages involved**
`@the-hive/workflow`, `@the-hive/storage`, `@the-hive/protocol`

**Concrete deliverables**

### `@the-hive/workflow`

Export:

- `applyCommand(state, command): WorkflowTransition`
- `applyEvent(state, event): WorkflowState`
- `projectState(events, snapshot?): WorkflowState`
- `buildInitialState(taskId, submission): WorkflowState`

Core interfaces:

```ts
interface WorkflowTransition {
  readonly newState: WorkflowState;
  readonly events: readonly WorkflowEvent[];
  readonly jobs: readonly PendingJob[];
}
```

```ts
interface PendingJob {
  readonly jobId: string;
  readonly taskId: string;
  readonly kind:
    | "build_context_bundle"
    | "run_domain_room"
    | "run_synthesis_room"
    | "run_query_back_room"
    | "render_review_packet";
  readonly payload: unknown;
  readonly dedupeKey: string;
}
```

Workflow events must include at minimum:

- `task_submitted`
- `task_started`
- `context_bundle_built`
- `room_job_enqueued`
- `room_started`
- `room_completed`
- `room_failed`
- `query_room_requested`
- `query_response_recorded`
- `review_packet_rendered`
- `task_review_ready`
- `task_approved`
- `task_rejected`
- `task_cancelled`
- `task_failed`

### `@the-hive/storage`

Use Bun's built-in SQLite driver (synchronous, transaction-friendly, fits single-writer authority).

Export:

- `openDatabase(path: string): DatabaseHandle`
- `runMigrations(db): Promise<void>`
- `appendWorkflowEvents(taskId, events): Promise<void>`
- `readWorkflowEvents(taskId, afterSeq?): Promise<readonly WorkflowEventRecord[]>`
- `writeSnapshot(taskId, snapshot): Promise<void>`
- `readLatestSnapshot(taskId): Promise<WorkflowSnapshotRecord | null>`
- `appendLedgerEntries(roomId, entries): Promise<void>`
- `readLedgerEntries(roomId): Promise<readonly LedgerEntryRecord[]>`
- `appendTurnTrace(roomId, trace): Promise<void>`
- `readTurnTraces(roomId): Promise<readonly TurnTraceRecord[]>`
- `appendQueryResponseArtifact(artifact): Promise<void>`
- `readQueryResponseArtifacts(roomId): Promise<readonly QueryResponseArtifactRecord[]>`
- `withWriteTransaction<T>(fn): Promise<T>`

SQLite schema:

- `workflow_events` — `(task_id, seq)` PK, `event_type`, `payload_json`, `created_at_ms`
- `workflow_snapshots` — `task_id`, `event_seq`, `snapshot_json`, `created_at_ms`
- `ledger_entries` — `room_id`, `seq`, `turn_id`, `agent_id`, `entry_type`, `issue_id`, `payload_json`, `created_at_ms`
- `turn_traces` — `room_id`, `turn_id`, `agent_id`, `prompt_json`, `raw_response_json`, `parse_status`, `normalized_turn_json`, `validation_errors_json`, `usage_json`, `timing_json`, `created_at_ms`
- `query_response_artifacts` — `artifact_id`, `source_room_id`, `source_room_revision`, `synthesis_room_id`, `question`, `payload_json`, `created_at_ms`

SQL views:

- `current_issue_state_v`
- `open_issues_v`
- `risk_proposals_v`
- `context_gaps_v`

**What must be complete before this phase starts**

- Phase 1 protocol/config contracts.

**Test strategy**

- Reducer tests for every command/event transition.
- Replay tests: `events -> state` equals `snapshot + tail events -> same state`.
- Idempotency tests for duplicate `commandId` and duplicate `jobId`.
- Migration tests from empty DB to latest schema.
- Transaction tests: appending a room result must not persist trace without ledger or vice versa.

**Integration checkpoint**

- A fixture event log can reconstruct state exactly.
- Crash recovery from snapshot + event tail works.

**Risks**

- The architecture says snapshots are derived and non-authoritative; your storage API must make that impossible to violate.
- If jobs are not represented in workflow state, crash recovery will be vague. Represent them explicitly now.

---

## Phase 3 — Room kernel, ledger projection, semantic validation

**Goal**
Prove the hardest core logic without live providers.

**Packages involved**
`@the-hive/room`, `@the-hive/protocol`

**Concrete deliverables**

### Core interfaces and functions

- `runRoom(input: RoomKernelInput): Promise<RoomRunResult>`
- `collectTurn(agent, memoryView): Promise<AgentTurnOutput>`
- `validateParsedTurn(turn, roomState): SemanticValidationResult`
- `applyTurnToLedger(ledger, parsedTurn): LedgerDelta`
- `projectIssueStates(entries): IssueProjection`
- `evaluateRoomHealth(state): RoomHealth`
- `evaluateStop(state): StopDecision`
- `renderDomainReport(ledger): RenderedArtifact`
- `renderSynthesisProposal(ledger): RenderedArtifact`

### Policy implementations

- `roundRobinTurnPolicy`
- `noOpenObjectionStopPolicy`
- `unresolvedIssueScopedMemoryPolicy`
- `retryOnceThenFailFailurePolicy`
- `domainArtifactPolicy`
- `synthesisArtifactPolicy`

### Semantic validation rules

- target issue exists for: `challenge`, `propose_resolution`, `propose_closure`, `reopen_issue`, `record_decision` (if `targetIssueId` present), `link_issues`
- `reopen_issue` only on non-open issues
- `propose_closure` only if issue is not already terminal and no identical proposal exists after current `ledgerVersion`
- `challenge` voids pending closure on target issue
- `link_issues` may not self-link
- duplicate suppression for `create_issue` (v1: normalized title hash, not embedding similarity)
- synthesis-only control actions rejected in domain rooms
- domain rooms may not emit `query_room`

### In-memory room state

```ts
interface RoomRuntimeState {
  readonly roomId: string;
  readonly ledgerVersion: number;
  readonly currentRound: number;
  readonly activeAgents: readonly AgentId[];
  readonly failedAgents: readonly AgentId[];
  readonly issueProjection: IssueProjection;
  readonly pendingObjectionsByIssue: ReadonlyMap<IssueId, readonly AgentId[]>;
}
```

### Scripted fake agents

- `ScriptedAgent` — returns predetermined `SubmitTurnPayload`s
- `FaultyAgent` — fails on specified turns
- `EchoAgent` — deterministic smoke tests

**What must be complete before this phase starts**

- Phase 1 contracts.

**Test strategy**

- Determinism: same scripted inputs produce byte-identical ledger and trace output.
- Closure semantics: no open objections -> closes; challenge voids closure; repeated identical closure rejected.
- Health semantics: below quorum -> `inconclusive_due_to_health`.
- Reopen semantics: resolved -> reopened -> open again.
- Duplicate suppression: same issue twice from different agents only creates one open issue.
- Memory policy: unresolved issues include detail; resolved issues only appear as status summaries.

**Integration checkpoint**

- A scripted 3-agent room can run end-to-end in-memory and produce ledger entries, rendered `report.md`, raw turn traces, and deterministic replay.

**Risks**

- Duplicate suppression is under-specified in the architecture. Keep it syntactic in v1.
- Do not couple the room kernel to provider concerns here.

---

## Phase 4 — Providers package and real turn execution

**Goal**
Swap fake agents for real `pi-ai`-backed agents in a headless harness.

**Packages involved**
`@the-hive/providers`, `@the-hive/room`, `@the-hive/protocol`

**Concrete deliverables**

### Provider package interfaces

- `createProviderRegistry(config): ProviderRegistry`
- `createProviderAgent(spec, runtimeDeps): Agent`
- `resolveModel(selection): ModelHandle`
- `runProviderTurn(input): Promise<ProviderTurnResult>`
- `normalizeToolCall(toolCall): ParsedTurn | ProviderNormalizationError`

```ts
interface ProviderCapability {
  readonly providerId: string;
  readonly modelId: string;
  readonly supportsStrictSchemas: boolean;
  readonly supportsStreamingToolArgs: boolean;
  readonly supportsReasoning: boolean;
  readonly maxContextWindowTokens: number;
}
```

### Turn emission tool

Implement exactly one tool: `submit_turn`

```ts
interface SubmitTurnPayload {
  readonly summary: string;
  readonly ledgerActions: readonly LedgerAction[];
  readonly controlActions: readonly RoomControlAction[];
}
```

For synthesis rooms, `controlActions` may include:

```ts
interface QueryRoomAction {
  readonly kind: "query_room";
  readonly targetRoomId: string;
  readonly question: string;
  readonly relevantIssueIds: readonly string[];
}
```

### Provider loop

For each turn:
1. Build prompt from `MemoryView`
2. Call provider via `pi-ai`
3. Validate tool call arguments
4. If invalid: emit tool result error back to model once, retry same turn
5. Normalize to `ParsedTurn`
6. Return: parsed turn, raw response, usage, timing, stop reason

### Harness

`scripts/run-live-room.ts` — headless live harness with inputs (provider/model, fixture ContextBundle, room template) and outputs (rendered report, ledger JSON, trace JSON, cost/latency summary).

**What must be complete before this phase starts**

- Phase 3 room kernel and action schemas.
- Phase 1 config enough to resolve provider/model selections.

**Test strategy**

- Contract tests with a fake provider adapter.
- Live smoke tests behind env flags only.
- Invalid tool args -> tool-result error -> model retry.
- Provider normalization tests: same `submit_turn` tool across providers yields same internal shape.
- Long-context tests: memory policy output stays inside model limit.

**Integration checkpoint**

- A headless script can run a real 3-agent domain room against one live provider and produce valid ledger + trace output.

**Risks**

- The architecture leaves model assignments unspecified. Decide one dev default now.
- Do not implement multi-provider rooms here. Keep single-provider only.
- If turn emission is modeled as 8 separate tools, you will create avoidable grouping bugs.

---

## Phase 5 — Minimal server + CLI: first user-visible end-to-end path

**Goal**
Prove the architecture with one real task flowing through server, storage, room, provider, and CLI.

**Packages involved**
`@the-hive/server`, `@the-hive/cli`, `@the-hive/storage`, `@the-hive/workflow`, `@the-hive/room`, `@the-hive/providers`

**Concrete deliverables**

### Server

Use Bun's native WebSocket server with `Bun.serve()`.

Export:

- `startHost(config): Promise<HostHandle>`
- `handleWireCommand(envelope): Promise<void>`
- `dispatchPendingJobs(taskId): Promise<void>`
- `recoverIncompleteTasks(): Promise<void>`
- `broadcastTaskEvent(event): void`

Core server components:

- `authority.ts` — single write queue, wraps `workflow.applyCommand`, persists resulting events/snapshots
- `dispatch.ts` — executes jobs (v1: only `run_domain_room`)
- `ws.ts` — subscribe/unsubscribe, snapshot-on-subscribe, push events

### CLI

Export:

- `connectClient(url): Promise<ClientHandle>`
- `submitTask(command): Promise<void>`
- `subscribeTask(taskId): Promise<void>`
- `approveTask(taskId): Promise<void>`
- `cancelTask(taskId): Promise<void>`
- `renderTaskTimeline(events): string`
- `renderReviewPacket(packet): string`

### Scope of this phase

Only implement: single domain room, static fixture ContextBundle, render domain report.md, transition to awaiting_review, approve / cancel. Do NOT add synthesis or query-back yet.

**What must be complete before this phase starts**

- Phase 2 workflow/storage.
- Phase 4 real provider turns.

**Test strategy**

- In-process integration test: CLI sends submit_task -> server persists event -> room runs -> report renders -> task reaches awaiting_review -> CLI approves.
- Duplicate command test using same commandId.
- WS reconnect + resubscribe.
- Crash recovery: kill server after room completion, before review broadcast; restart, recover correct state.

**Integration checkpoint**

- A real operator can: start server, start CLI, submit a task, watch a real room run, inspect the generated report, approve or cancel.

**Risks**

- The wire API needs a subscription/read model now. The architecture does not spell this out.
- Do not add terminal polish before this flow works.

---

## Phase 6 — Context bundle builder and Stage 1 orchestration

**Goal**
Replace static fixture bundles with real bundle construction and run multiple domain rooms.

**Packages involved**
`@the-hive/context`, `@the-hive/config`, `@the-hive/server`, `@the-hive/storage`, `@the-hive/workflow`

**Concrete deliverables**

### Context package

Export:

- `buildContextBundle(input): Promise<ContextBundle>`
- `sliceBundleForDomain(bundle, domain): ContextBundle`
- `computeBundleDigest(bundle): string`
- `computeSectionStaleness(section): StalenessMetadata`

Parsers: `parseAgentsMd`, `parseArchitectureMarkdown`, `parsePackageJsonManifest`, `parseOpenApiDocument`, `parseGraphqlSchema`, `parseSqlSchema`

### Storage addition

Persist bundles for replay:

- `context_bundles` — `bundle_id`, `task_id`, `version`, `manifest_json`, `created_at_ms`
- `context_bundle_sections` — `bundle_id`, `section_id`, `kind`, `domain_tags_json`, `source_ref`, `content`, `checksum`, `staleness_json`

### Workflow/server

- `build_context_bundle` job
- `run_domain_room` jobs for each configured domain room
- aggregation of multiple Stage 1 room completions before moving on

**What must be complete before this phase starts**

- Phase 5 first end-to-end flow.
- Phase 1 config schema stable enough to define domain rooms.

**Test strategy**

- Fixture directories with: valid docs only, missing OpenAPI, malformed GraphQL, stale sections.
- Hash stability tests.
- Domain slicing tests: frontend room doesn't receive DB-only sections unless shared.
- Persistence/reload tests for bundles.

**Integration checkpoint**

- Submit a task pointing at a real input directory, build bundles, spawn multiple domain rooms, and persist their results.

**Risks**

- The architecture does not define source precedence when the same fact appears in multiple sections.
- Staleness computation is underspecified. Decide whether it is file metadata, explicit frontmatter, or external manifest data.
- Context bundles can easily become too large; measure section counts and token sizes now.

---

## Phase 7 — Synthesis room, final proposal, and human gate

**Goal**
Complete the nominal two-stage deliberation path.

**Packages involved**
`@the-hive/workflow`, `@the-hive/room`, `@the-hive/server`, `@the-hive/cli`, `@the-hive/storage`

**Concrete deliverables**

### Workflow additions

- `run_synthesis_room` job
- transitions: `mini_rooms -> synthesis -> rendering -> awaiting_review`
- `approve_task`, `reject_task`, `cancel_task`

### Review packet renderer

Export:

- `renderFinalProposal(ledger): string`
- `buildReviewPacket(current, previous?): ReviewPacketView`
- `computeStructuredDiff(previous, current): ReviewPacketDiffView`

### CLI

- review screen, approve flow, reject-with-feedback flow, cancel flow

**What must be complete before this phase starts**

- Phase 6 multiple Stage 1 rooms.
- Artifact renderers stable for domain rooms.

**Test strategy**

- Synthesis input fixture tests from multiple ledgers.
- Deterministic render tests: same ledger => same proposal bytes.
- Review packet diff tests: no previous version -> no diff; changed decision -> diff rendered.
- CLI approve/reject integration tests.

**Integration checkpoint**

- Full nominal flow works: Stage 1 rooms -> synthesis room -> review packet -> human approve/reject.

**Risks**

- Diff format is not specified in the architecture.
- Evidence link format is underspecified: section refs only vs excerpt+section refs.

---

## Phase 8 — Query-back and rerun loop

**Goal**
Implement the parts most likely to produce subtle state bugs: targeted clarification and rejection iteration.

**Packages involved**
`@the-hive/workflow`, `@the-hive/server`, `@the-hive/room`, `@the-hive/storage`, `@the-hive/cli`

**Concrete deliverables**

### Query-back

- `QueryRoomJobPayload` — taskId, synthesisRoomId, targetRoomId, question, relevantIssueIds, maxRounds
- `QueryResponseArtifact` — artifactId, sourceRoomId, sourceRoomRevision, synthesisRoomId, question, relevantIssueIds, answerMarkdown, ledgerEntries, createdAtMs
- Important rule: query-back result is a **versioned artifact**, not an append to the original source ledger

### Rerun loop

- workflow transitions: `awaiting_review -> running(rerun)`
- inject rejection feedback into: synthesis input, domain room prompt preamble, review packet diff context
- enforce max iteration cap

### Artifact versioning

- `proposal_version`, `room_revision`, `review_packet.version`, `diffFromPrevious`

**What must be complete before this phase starts**

- Phase 7 two-stage nominal flow.

**Test strategy**

- query-back cap reached -> workflow still terminates correctly
- original source ledger remains unchanged after query-back
- rerun produces version 2 packet with diff
- reject twice -> max iteration cap enforced
- synthesis resumes after query-back with new artifact in context

**Integration checkpoint**

- A synthesis room can issue query_room, consume the response, finish proposal generation, and then survive at least one reject/rerun cycle.

**Risks**

- The architecture does not define what counts as "question answered" in query-back.
- Feedback injection semantics are underspecified: prepend to system prompt? add as synthetic context section? add as workflow event only?

---

## Phase 9 — Eval gate and hardening

**Goal**
Prove the product hypothesis and harden the system that actually exists, not the one imagined earlier.

**Packages involved**
`test/eval`, `@the-hive/providers`, `@the-hive/storage`, `@the-hive/server`, `@the-hive/cli`

**Concrete deliverables**

### Eval harness

- `GoldenTaskFixture` — taskId, prompt, bundleRef, hiddenFromDev, rubricId
- `BaselineRunConfig` — provider, model, promptStyle
- `EvalRunResult` — taskId, system, proposalVersion, qualityScore, latencyMs, costUsd, passed

### Scoring

- blinded reviewer packs
- rubric categories: correctness, completeness, risk identification, cross-system reasoning, evidence grounding, actionability
- tie rule: same score => baseline wins

### Operational hardening

- concurrency limits for live runs
- write queue observability
- trace size caps / pruning policy
- bundle size telemetry
- explicit WS reconnect behavior
- recovery startup path tests

**What must be complete before this phase starts**

- Phase 8 full behavior path.

**Test strategy**

- holdout task separation
- replay from persisted traces
- blinded scoring dry-run
- cost multiplier and latency threshold enforcement
- soak tests with multiple submitted tasks

**Integration checkpoint**

- The team can run: Hive, baseline, blinded scoring, cost/latency comparison, pass/fail decision.

**Risks**

- If evaluation is weak, you will rationalize complexity instead of removing it.
- Do not add multi-provider rooms until this gate passes.

---

## Ambiguities Requiring Design Decisions

These are not optional. Decide them explicitly during implementation.

1. **Turn emission shape** — one `submit_turn` tool (recommended) vs 8 separate tools
2. **`query_room` classification** — treat as `RoomControlAction`, not a decision record
3. **Wire subscription/read model** — CLI needs reconnect, subscribe, and fetch current state
4. **Task submission input** — filesystem root, explicit files, bundle spec, or prebuilt bundle id
5. **Context bundle persistence** — necessary for replay and eval, not explicitly in architecture
6. **Context source precedence** — which source wins when facts conflict
7. **Staleness computation** — file mtimes, explicit frontmatter, or external manifest
8. **Duplicate suppression algorithm** — exact normalized signature in v1, no embeddings
9. **Evidence payload shape** — `sectionId` only, or `sectionId + byte range + excerpt`
10. **Server dispatch concurrency** — start with single dispatch queue, raise later
11. **Diff algorithm** — needs structured issue/decision diffs, not just line diff
12. **Reject feedback injection** — needs one canonical path (synthetic context section, prompt preamble, or workflow metadata)
13. **Query-back stop condition** — "answer the question" is not machine-checkable; needs concrete mini-cycle stop rule
14. **Artifact storage** — canonical storage is SQLite text blobs; CLI export to files is optional
15. **Positive support signals** — no explicit "endorse resolution" action; "no challenge" is weaker than "supported"

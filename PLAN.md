# The Hive — Implementation Plan

Contracts-first, then vertical slices. Do not finish every package horizontally before integrating.

## Execution Order

1. **Phase 0–1** — Freeze boundaries and contracts.
2. **Phase 2 + Phase 3 in parallel** — Build state authority and room core.
3. **Phase 4** — Prove a live room before adding more orchestration.
4. **Phase 4.5** — Pre-integration structural fixes (persistence authority, wire gaps, workflow slimming).
5. **Phase 5** — Prove a real end-to-end path with one room.
6. **Phase 6** — Replace fixtures with real context bundles and multi-room Stage 1.
7. **Phase 7** — Add synthesis and human review.
8. **Phase 8** — Add query-back and rerun only after nominal flow works.
9. **Phase 9** — Run the eval gate before expanding feature scope.

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

- `createProviderRegistry(registryConfig: ProviderRegistryConfig): ProviderRegistry`
- `createProviderAgent(spec, runtimeDeps): Agent`
- `resolveModel(selection): ModelHandle`
- `runProviderTurn(input): Promise<ProviderTurnResult>`
- `normalizeToolCall(toolCall): ParsedTurn | ProviderNormalizationError`

`ProviderRegistryConfig` is a providers-local runtime contract. The server maps validated `@the-hive/config` objects into this shape at composition time. `providers` does not import `config`.

`ProviderAgentDeps` (the `runtimeDeps` argument) includes `registry`, `complete` (injectable pi-ai completion function), and `roomKind` (for room-kind-aware tool schema selection).

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

## Phase 4.5 — Pre-integration structural fixes

**Goal**
Fix the persistence authority model, fill wire protocol gaps, and slim the workflow event model so Phase 5 server composition is mechanical rather than a patchwork of workarounds.

**Background**
An external architecture review of the Phase 5 integration surface found: (1) `room_completed` workflow events carry full `RoomRunResult`, blurring the authority split between workflow log and ledger/trace stores; (2) the wire protocol lacks snapshot responses and command-level error reporting; (3) the workflow has no mechanism to skip synthesis, forcing Phase 5 to fake it; (4) `room_started` has no workflow producer, making it invisible to recovery and reconnect; (5) several fields on `ReviewPacketView` have no honest data source.

**Packages involved**
`@the-hive/protocol` (wire + engine), `@the-hive/workflow`, `@the-hive/storage`

### 1. Protocol Wire Changes

**`packages/protocol/src/wire/errors.ts`** — Add `TaskFailureCode`:

```ts
export type TaskFailureCode =
  | "context_build_failed"
  | "room_failed"
  | "render_failed"
  | "max_iterations_exceeded"
  | "internal_error";
```

`WireErrorCode` stays unchanged (protocol/command-level errors only).

**`packages/protocol/src/wire/events.ts`** — Add `TaskSnapshotEvent`, update `TaskFailedEvent`:

```ts
export interface TaskSnapshotEvent {
  readonly kind: "task_snapshot";
  readonly commandId: string;
  readonly snapshot: TaskSnapshotView;
  readonly sentAtMs: number;
}
```

Add `TaskSnapshotEvent` to the `WireEvent` union.

Change `TaskFailedEvent.errorCode` from `WireErrorCode` to `TaskFailureCode`:

```ts
export interface TaskFailedEvent {
  readonly kind: "task_failed";
  readonly taskId: string;
  readonly errorCode: TaskFailureCode;
  readonly message: string;
  readonly failedAtMs: number;
}
```

Add `outcome` to `RoomCompletedEvent`:

```ts
export interface RoomCompletedEvent {
  readonly kind: "room_completed";
  readonly taskId: string;
  readonly roomId: string;
  readonly roomKind: RoomKindView;
  readonly outcome: "completed" | "inconclusive";
  readonly completedAtMs: number;
}
```

**`packages/protocol/src/wire/views.ts`** — Two fields become optional:

```ts
export interface IssueSummaryView {
  readonly issueId: string;
  readonly title: string;
  readonly state: IssueStateView;
  readonly domain?: string; // was required
}

export interface EvidenceTraceLinkView {
  readonly issueId: string;
  readonly sectionRef?: string; // was required
  readonly evidence?: string; // new: freeform evidence from ledger
  readonly excerpt?: string;
}
```

**`packages/protocol/src/wire/errors.ts`** — Add `WireErrorEnvelope` and `WireServerMessage`:

```ts
export interface WireErrorEnvelope {
  readonly protocolVersion: ProtocolVersion;
  readonly commandId: string;
  readonly error: WireError;
}

export type WireServerMessage = WireEventEnvelope | WireErrorEnvelope;
```

**`packages/protocol/src/wire/schemas.ts`** — Add runtime schemas for all new types: `taskFailureCodeSchema`, `taskSnapshotEventSchema`, `wireErrorEnvelopeSchema`, `wireServerMessageSchema`. Update `taskFailedEventSchema` to use `taskFailureCodeSchema`. Update `roomCompletedEventSchema` to include `outcome`. Update `issueSummaryViewSchema` for optional `domain`. Update `evidenceTraceLinkViewSchema` for optional `sectionRef` + new `evidence`.

**`packages/protocol/src/wire/index.ts`** — Export all new types and schemas.

### 2. Protocol Engine Changes

**`packages/protocol/src/engine/workflow.ts`** — Add `WorkflowPlan` and `WorkflowSubmission`. Update `WorkflowState`:

```ts
export interface WorkflowPlan {
  readonly includeSynthesis: boolean;
  readonly allowQueryBack: boolean;
  readonly allowRerun: boolean;
}

export interface WorkflowSubmission {
  readonly prompt: string;
  readonly bundleInputPath: string;
  readonly requestedDomains: readonly string[];
  readonly configProfile?: string;
  readonly plan: WorkflowPlan;
}

export interface WorkflowState {
  readonly taskId: TaskId;
  readonly externalState: ExternalTaskState;
  readonly internalPhase: InternalPhase;
  readonly iteration: number;
  readonly pendingJobs: readonly PendingJob[];
  readonly completedRoomIds: readonly RoomId[];
  readonly reviewPacketVersion: number;
  readonly maxIterations: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly bundleId?: string;
  readonly submission?: WorkflowSubmission; // replaces hidden _workflow.submission
}
```

**`packages/protocol/src/engine/index.ts`** — Export `WorkflowPlan` and `WorkflowSubmission`.

### 3. Workflow Reducer Changes

**`packages/workflow/src/index.ts`** — All changes in this single file.

**3a. New command: `start_room`**

```ts
export interface StartRoomWorkflowCommand extends TimedWorkflowCommandBase {
  readonly kind: "start_room";
  readonly roomId: RoomId;
  readonly roomKind: RoomKind;
  readonly domain?: string;
  readonly agentIds: readonly AgentId[];
}
```

Add to `WorkflowCommand` union. Handler validates: a pending room job exists for this `roomId`. Emits enriched `RoomStartedWorkflowEvent`:

```ts
export interface RoomStartedWorkflowEvent extends WorkflowEventBase {
  readonly kind: "room_started";
  readonly roomId: RoomId;
  readonly roomKind: RoomKind;
  readonly domain?: string;
  readonly agentIds: readonly AgentId[];
}
```

`applyEvent` for `room_started` updates timestamps only (no state change beyond that). The pending job stays until `room_completed` or `room_failed`.

**3b. Slim `room_completed`**

Before:

```ts
export interface RoomCompletedWorkflowCommand extends TimedWorkflowCommandBase {
  readonly kind: "room_completed";
  readonly roomId: RoomId;
  readonly result: RoomRunResult;
}
```

After:

```ts
export interface RoomCompletedWorkflowCommand extends TimedWorkflowCommandBase {
  readonly kind: "room_completed";
  readonly roomId: RoomId;
  readonly roomKind: RoomKind;
  readonly outcome: RoomRunOutcome;
}
```

Similarly for the event:

```ts
export interface RoomCompletedWorkflowEvent extends WorkflowEventBase {
  readonly kind: "room_completed";
  readonly roomId: RoomId;
  readonly roomKind: RoomKind;
  readonly outcome: RoomRunOutcome;
}
```

The handler references change from `command.result.kind` to `command.roomKind`, `command.result.outcome` to `command.outcome`, `command.result.roomId` to `command.roomId`.

Accept both `"completed"` and `"inconclusive"` outcomes. Remove the `outcome !== "completed"` rejection. Failed rooms still go through `room_failed`.

**3c. WorkflowPlan-conditional synthesis**

On last domain room completion, check `submission.plan.includeSynthesis`:

- If `true`: enqueue `run_synthesis_room` (existing behavior).
- If `false`: enqueue `render_review_packet` directly with `sourceRoomIds` from `completedRoomIds`.

The render job payload gains explicit fields:

```ts
{
  version: number;
  iteration: number;
  sourceRoomIds: readonly RoomId[];
  sourceStage: "domain" | "synthesis";
}
```

For synthesis completion, the render payload uses `sourceRoomIds: [synthesisRoomId]` and `sourceStage: "synthesis"`.

**3d. Feedback as `string[]`**

Change `RejectTaskWorkflowCommand.feedback` from `string` to `readonly string[]`.
Change `TaskRejectedWorkflowEvent.feedback` from `string` to `readonly string[]`.
Change `createBuildContextJob` `feedback` parameter from `string` to `readonly string[]`.

The job payload carries the structured array. Formatting happens downstream at injection time.

**3e. Submission in public state**

Add `plan: WorkflowPlan` to `SubmitTaskWorkflowCommand` and `TaskSubmittedWorkflowEvent`.

Move `WorkflowSubmission` from the internal `_workflow` metadata to public `WorkflowState.submission`. The internal `WorkflowMetadata` retains only `processedCommandIds` and `queryBackSequence`.

`buildInitialState(taskId, maxIterations)` signature unchanged — `submission` starts as `undefined`, gets set on `task_submitted`.

**3f. Test updates**

All existing 19 tests updated to reflect:

- Slim `room_completed` (no more `result: RoomRunResult` in commands/events)
- New `plan` field on submit commands
- New `start_room` command
- `feedback` as `string[]` on reject
- `submission` on public state
- No synthesis enqueue when `plan.includeSynthesis === false`

New tests:

- `start_room` happy path and validation (room job must exist)
- `plan.includeSynthesis === false` → domain complete goes directly to render
- `plan.includeSynthesis === true` → domain complete enqueues synthesis (existing behavior)
- `room_completed` with `"inconclusive"` outcome accepted
- `feedback` as `string[]` round-trips through reject → rerun

### 4. Storage Schema Additions

**`packages/storage/src/index.ts`** — All changes in this single file.

**4a. Auto-seq workflow event append**

New function:

```ts
export interface PersistableWorkflowEvent {
  readonly eventType: string;
  readonly payloadJson: string;
  readonly createdAtMs: number;
}

export function appendWorkflowEventsAutoSeq(
  db: Database,
  taskId: string,
  events: readonly PersistableWorkflowEvent[],
): readonly WorkflowEventRecord[];
```

Implementation: inside the caller's transaction, `SELECT COALESCE(MAX(seq), 0) FROM workflow_events WHERE task_id = ?`, then assign `base + index + 1` to each event. Returns the persisted records with assigned `seq` values.

Existing `appendWorkflowEvents` stays for backward compatibility.

**4b. Room artifacts table**

```sql
CREATE TABLE IF NOT EXISTS room_artifacts (
  room_id TEXT NOT NULL PRIMARY KEY,
  artifact_kind TEXT NOT NULL,
  content TEXT NOT NULL,
  path_hint TEXT,
  created_at_ms INTEGER NOT NULL
);
```

```ts
export interface RoomArtifactRecord {
  readonly roomId: string;
  readonly artifactKind: string;
  readonly content: string;
  readonly pathHint: string | null;
  readonly createdAtMs: number;
}

export function appendRoomArtifact(db: Database, artifact: RoomArtifactRecord): void;
export function readRoomArtifact(db: Database, roomId: string): RoomArtifactRecord | null;
```

**4c. Review packets table**

```sql
CREATE TABLE IF NOT EXISTS review_packets (
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  packet_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (task_id, version)
);
```

```ts
export interface ReviewPacketRecord {
  readonly taskId: string;
  readonly version: number;
  readonly packetJson: string;
  readonly createdAtMs: number;
}

export function writeReviewPacket(db: Database, packet: ReviewPacketRecord): void;
export function readReviewPacket(
  db: Database,
  taskId: string,
  version: number,
): ReviewPacketRecord | null;
export function readLatestReviewPacket(db: Database, taskId: string): ReviewPacketRecord | null;
```

**4d. Tasks derived index table**

```sql
CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT NOT NULL PRIMARY KEY,
  external_state TEXT NOT NULL,
  internal_phase TEXT NOT NULL,
  prompt TEXT NOT NULL,
  latest_event_seq INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);
```

```ts
export interface TaskIndexRecord {
  readonly taskId: string;
  readonly externalState: string;
  readonly internalPhase: string;
  readonly prompt: string;
  readonly latestEventSeq: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export function upsertTaskIndex(db: Database, task: TaskIndexRecord): void;
export function readTaskIndex(db: Database, taskId: string): TaskIndexRecord | null;
export function listRecoverableTasks(db: Database): readonly TaskIndexRecord[];
```

`listRecoverableTasks` returns rows where `external_state NOT IN ('approved', 'cancelled', 'failed')`.

**4e. Migrations** — Add the 3 new `CREATE TABLE` statements to the migrations array. Existing tables unchanged.

**4f. Tests** — Add tests for:

- `appendWorkflowEventsAutoSeq`: correct seq assignment, sequential calls produce incrementing seqs
- `appendRoomArtifact` + `readRoomArtifact`: round-trip, null for missing
- `writeReviewPacket` + `readReviewPacket` + `readLatestReviewPacket`: round-trip, version ordering
- `upsertTaskIndex` + `readTaskIndex` + `listRecoverableTasks`: insert, update, filter terminal states
- Existing 6 storage tests remain passing

### Test Strategy Summary

| Package   | Existing | Updates                                                   | New Tests                                                       |
| --------- | -------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| protocol  | 4        | Update for new types, optional fields                     | Schema tests for new wire types                                 |
| workflow  | 19       | All 19 (room_completed shape, plan, feedback, submission) | ~5 (start_room, plan conditional, inconclusive, feedback array) |
| storage   | 6        | None                                                      | ~8 (auto-seq, artifacts, packets, task index)                   |
| config    | 10       | None                                                      | None                                                            |
| room      | 22       | None                                                      | None                                                            |
| providers | 26       | None                                                      | None                                                            |

Room and providers tests should pass unmodified — room still produces `RoomRunResult`, providers still produce `AgentTurnOutput`. The slimming is at the workflow command boundary, not at the room output boundary.

### Acceptance Criteria

1. `bun run build` passes across all packages.
2. `bun run typecheck` passes across all packages.
3. `bun run check` (biome) passes.
4. `bun run test` passes — all existing tests updated, all new tests passing.
5. `scripts/check-boundaries.sh` passes (no boundary violations).
6. Wire `TaskFailedEvent` uses `TaskFailureCode`, not `WireErrorCode`.
7. Wire has `TaskSnapshotEvent`, `WireErrorEnvelope`, `WireServerMessage`.
8. `IssueSummaryView.domain` is optional.
9. `EvidenceTraceLinkView.sectionRef` is optional, `evidence` field added.
10. `WorkflowState.submission` is public (not hidden in `_workflow`).
11. `WorkflowPlan` controls synthesis: `includeSynthesis: false` → no synthesis job after domain completion.
12. `start_room` command produces persisted `room_started` event with roomKind, domain, agentIds.
13. `room_completed` command/event carries only roomId, roomKind, outcome — no `RoomRunResult`.
14. `room_completed` accepts `"inconclusive"` outcome without throwing.
15. Reject feedback is `readonly string[]` through workflow command, event, and job payload.
16. Storage has `room_artifacts`, `review_packets`, `tasks` tables with working CRUD.
17. `appendWorkflowEventsAutoSeq` assigns correct sequential seq values.

### What must be complete before Phase 5

This phase (4.5). All acceptance criteria met.

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

- Phase 4.5 pre-integration structural fixes.

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

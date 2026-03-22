import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

import type { HiveConfig } from "@the-hive/config";
import type {
	Agent,
	ContextBundle,
	ContextSection,
	PendingJob,
	RenderedArtifact,
	RoomId,
	RoomRunResult,
	RoomSpec,
	WorkflowState,
} from "@the-hive/protocol/engine";
import type {
	ContextGapView,
	IssueSummaryView,
	ReviewPacketView,
	RiskProposalView,
} from "@the-hive/protocol/wire";
import { type CompleteFn, type ProviderRegistry, createProviderAgent } from "@the-hive/providers";
import { runRoom } from "@the-hive/room";
import {
	type DatabaseHandle,
	appendLedgerEntries,
	appendRoomArtifact,
	appendTurnTrace,
	listRecoverableTasks,
	readLedgerEntries,
	readReviewPacket,
	readRoomArtifact,
	withWriteTransaction,
	writeReviewPacket,
} from "@the-hive/storage";

import type { Authority } from "./authority";
import { buildRoomSpecFromJob } from "./config-mapper";

export interface BuildContextBundleJobPayload {
	readonly prompt: string;
	readonly bundleInputPath: string;
	readonly requestedDomains: readonly string[];
	readonly iteration: number;
	readonly configProfile?: string;
	readonly feedback?: readonly string[];
}

export interface DomainRoomJobPayload {
	readonly roomId: RoomId;
	readonly domain: string;
	readonly bundleId: string;
	readonly iteration: number;
}

export interface RenderReviewPacketJobPayload {
	readonly version: number;
	readonly iteration: number;
	readonly sourceRoomIds: readonly RoomId[];
	readonly sourceStage: "domain" | "synthesis";
}

export interface DispatcherDeps {
	readonly db: DatabaseHandle;
	readonly authority: Authority;
	readonly config: HiveConfig;
	readonly providerRegistry: ProviderRegistry;
	readonly completeFn: CompleteFn;
	readonly createAgents?: (spec: RoomSpec<"domain">) => readonly Agent<"domain">[];
	readonly roomRunner?: typeof runRoom;
}

export interface Dispatcher {
	kick(taskId: string): void;
	recoverIncompleteTasks(): Promise<void>;
	shutdown(): void;
}

interface ProjectedIssueState {
	readonly issueId: string;
	readonly title: string;
	readonly state:
		| "open"
		| "challenged"
		| "proposed_resolution"
		| "closure_proposed"
		| "resolved"
		| "deferred"
		| "risk_proposed";
}

class DispatcherError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "DispatcherError";
	}
}

function sha1(value: string): string {
	return createHash("sha1").update(value).digest("hex");
}

function buildSectionKind(filePath: string): ContextSection["kind"] {
	if (filePath.endsWith("AGENTS.md")) {
		return "agents_md";
	}
	if (filePath.endsWith("package.json")) {
		return "dependency_manifest";
	}
	if (filePath.endsWith(".graphql") || filePath.endsWith(".gql")) {
		return "graphql";
	}
	if (filePath.endsWith(".sql")) {
		return "db_schema";
	}
	if (
		filePath.endsWith("openapi.json") ||
		filePath.endsWith("openapi.yaml") ||
		filePath.endsWith("openapi.yml")
	) {
		return "openapi";
	}
	return "architecture_doc";
}

function collectFixtureFiles(rootPath: string): readonly string[] {
	const resolvedRoot = resolve(rootPath);
	const stat = statSync(resolvedRoot);
	if (stat.isFile()) {
		return [resolvedRoot];
	}

	const files: string[] = [];
	const queue = [resolvedRoot];
	while (queue.length > 0) {
		const currentPath = queue.shift();
		if (!currentPath) {
			continue;
		}

		for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
			const nextPath = resolve(currentPath, entry.name);
			if (entry.isDirectory()) {
				queue.push(nextPath);
				continue;
			}
			if (entry.isFile()) {
				files.push(nextPath);
			}
		}
	}

	return files.sort();
}

function buildStaticFixtureBundle(
	bundleId: string,
	bundleInputPath: string,
	requestedDomains: readonly string[],
): ContextBundle {
	const createdAtMs = Date.now();
	if (existsSync(bundleInputPath)) {
		const files = collectFixtureFiles(bundleInputPath);
		const sections = files.map((filePath, index) => {
			const content = readFileSync(filePath, "utf8");
			return {
				sectionId: `section-${index + 1}`,
				kind: buildSectionKind(filePath),
				sourceRef: filePath,
				domainTags: requestedDomains.length > 0 ? requestedDomains : ["general"],
				content,
				checksum: sha1(content),
				staleness: {
					lastVerifiedAtMs: createdAtMs,
					source: "file_mtime" as const,
				},
			};
		});

		return {
			bundleId,
			version: 1,
			createdAtMs,
			rootRef: bundleInputPath,
			sections,
		};
	}

	const content = [
		"# Phase 5 Context Fixture",
		"",
		`Bundle input path: ${bundleInputPath}`,
		`Requested domains: ${requestedDomains.join(", ") || "general"}`,
		"",
		"This is a static fallback ContextBundle used when the requested path does not exist.",
	].join("\n");

	return {
		bundleId,
		version: 1,
		createdAtMs,
		rootRef: bundleInputPath,
		sections: [
			{
				sectionId: "fixture-1",
				kind: "architecture_doc",
				sourceRef: bundleInputPath,
				domainTags: requestedDomains.length > 0 ? requestedDomains : ["general"],
				content,
				checksum: sha1(content),
				staleness: {
					lastVerifiedAtMs: createdAtMs,
					source: "unknown" as const,
				},
			},
		],
	};
}

function narrowBuildContextPayload(payload: unknown): BuildContextBundleJobPayload {
	const candidate = payload as Partial<BuildContextBundleJobPayload>;
	if (
		typeof candidate.prompt !== "string" ||
		typeof candidate.bundleInputPath !== "string" ||
		!Array.isArray(candidate.requestedDomains) ||
		typeof candidate.iteration !== "number"
	) {
		throw new DispatcherError("Invalid build_context_bundle payload");
	}

	return {
		prompt: candidate.prompt,
		bundleInputPath: candidate.bundleInputPath,
		requestedDomains: candidate.requestedDomains.filter(
			(value): value is string => typeof value === "string",
		),
		iteration: candidate.iteration,
		...(typeof candidate.configProfile === "string"
			? { configProfile: candidate.configProfile }
			: {}),
		...(Array.isArray(candidate.feedback)
			? {
					feedback: candidate.feedback.filter(
						(value): value is string => typeof value === "string",
					),
				}
			: {}),
	};
}

function narrowDomainRoomPayload(payload: unknown): DomainRoomJobPayload {
	const candidate = payload as Partial<DomainRoomJobPayload>;
	if (
		typeof candidate.roomId !== "string" ||
		typeof candidate.domain !== "string" ||
		typeof candidate.bundleId !== "string" ||
		typeof candidate.iteration !== "number"
	) {
		throw new DispatcherError("Invalid run_domain_room payload");
	}

	return {
		roomId: candidate.roomId as RoomId,
		domain: candidate.domain,
		bundleId: candidate.bundleId,
		iteration: candidate.iteration,
	};
}

function narrowRenderPayload(payload: unknown): RenderReviewPacketJobPayload {
	const candidate = payload as Partial<RenderReviewPacketJobPayload>;
	if (
		typeof candidate.version !== "number" ||
		typeof candidate.iteration !== "number" ||
		!Array.isArray(candidate.sourceRoomIds) ||
		(candidate.sourceStage !== "domain" && candidate.sourceStage !== "synthesis")
	) {
		throw new DispatcherError("Invalid render_review_packet payload");
	}

	return {
		version: candidate.version,
		iteration: candidate.iteration,
		sourceRoomIds: candidate.sourceRoomIds.filter(
			(value): value is RoomId => typeof value === "string",
		),
		sourceStage: candidate.sourceStage,
	};
}

function toLedgerEntryRecord(roomId: string, entry: RoomRunResult["ledgerEntries"][number]) {
	return {
		roomId,
		seq: entry.seq,
		turnId: entry.turnId,
		agentId: entry.agentId,
		entryType: entry.action.kind,
		issueId:
			"issueId" in entry.action
				? entry.action.issueId
				: "targetIssueId" in entry.action
					? entry.action.targetIssueId
					: null,
		payloadJson: JSON.stringify(entry),
		createdAtMs: entry.timestamp,
	};
}

function toTurnTraceRecord(roomId: string, trace: RoomRunResult["turnTraces"][number]) {
	return {
		roomId,
		turnId: trace.turnId,
		agentId: trace.agentId,
		promptJson: JSON.stringify({ roundNumber: trace.roundNumber }),
		rawResponseJson: JSON.stringify(trace.rawResponse),
		parseStatus: trace.parsedTurn ? "parsed" : "invalid",
		normalizedTurnJson: trace.parsedTurn ? JSON.stringify(trace.parsedTurn) : null,
		validationErrorsJson: null,
		usageJson: null,
		timingJson: JSON.stringify({
			startedAtMs: trace.startedAtMs,
			completedAtMs: trace.completedAtMs,
			latencyMs: trace.completedAtMs - trace.startedAtMs,
		}),
		createdAtMs: trace.completedAtMs,
	};
}

function toRoomArtifactRecord(roomId: string, artifact: RenderedArtifact, createdAtMs: number) {
	return {
		roomId,
		artifactKind: artifact.kind,
		content: artifact.content,
		pathHint: artifact.pathHint ?? null,
		createdAtMs,
	};
}

function readDomainSystemPrompt(): string {
	const promptUrl = new URL("../../../prompts/room-base.md", import.meta.url);
	return readFileSync(promptUrl, "utf8");
}

function buildBundleId(taskId: string, iteration: number): string {
	return `bundle:${taskId}:${iteration}`;
}

function buildInternalCommandId(kind: string, value: string): string {
	return `internal:${kind}:${value}`;
}

function deriveRoomDomain(roomId: string): string | undefined {
	const parts = roomId.split(":");
	return parts.at(-1);
}

function projectIssueStatesFromLedger(
	entryRecords: ReturnType<typeof readLedgerEntries>,
): readonly ProjectedIssueState[] {
	const issues = new Map<string, ProjectedIssueState>();
	for (const record of entryRecords) {
		const parsed = JSON.parse(record.payloadJson) as {
			action?: {
				readonly kind?: string;
				readonly issueId?: string;
				readonly targetIssueId?: string;
				readonly title?: string;
				readonly closureType?: ProjectedIssueState["state"];
			};
		};
		const action = parsed.action;
		if (!action?.kind) {
			continue;
		}

		switch (action.kind) {
			case "create_issue": {
				if (typeof action.issueId !== "string" || typeof action.title !== "string") {
					continue;
				}
				issues.set(action.issueId, {
					issueId: action.issueId,
					title: action.title,
					state: "open",
				});
				break;
			}
			case "challenge":
			case "propose_resolution":
			case "reopen_issue":
			case "propose_closure": {
				if (typeof action.targetIssueId !== "string") {
					continue;
				}
				const current = issues.get(action.targetIssueId);
				if (!current) {
					continue;
				}
				const nextState: ProjectedIssueState["state"] =
					action.kind === "challenge"
						? "challenged"
						: action.kind === "propose_resolution"
							? "proposed_resolution"
							: action.kind === "reopen_issue"
								? "open"
								: (action.closureType ?? "closure_proposed");
				issues.set(action.targetIssueId, {
					...current,
					state: nextState,
				});
				break;
			}
			default:
				break;
		}
	}

	return [...issues.values()];
}

function buildReviewPacket(
	taskId: string,
	version: number,
	sourceRoomIds: readonly RoomId[],
	ledgerByRoom: ReadonlyMap<RoomId, ReturnType<typeof readLedgerEntries>>,
	artifactsByRoom: ReadonlyMap<RoomId, ReturnType<typeof readRoomArtifact>>,
): ReviewPacketView {
	const unresolvedIssues: IssueSummaryView[] = [];
	const riskProposals: RiskProposalView[] = [];
	const contextGaps: ContextGapView[] = [];
	const proposalMarkdown = sourceRoomIds
		.map((roomId) => artifactsByRoom.get(roomId)?.content ?? "")
		.filter((content) => content.length > 0)
		.join("\n\n");

	for (const roomId of sourceRoomIds) {
		const ledgerEntries = ledgerByRoom.get(roomId) ?? [];
		const domain = deriveRoomDomain(roomId);
		for (const issue of projectIssueStatesFromLedger(ledgerEntries)) {
			if (
				issue.state === "resolved" ||
				issue.state === "deferred" ||
				issue.state === "risk_proposed"
			) {
				continue;
			}
			unresolvedIssues.push({
				issueId: issue.issueId,
				title: issue.title,
				state: issue.state,
				...(domain ? { domain } : {}),
			});
		}

		const titleByIssueId = new Map(
			projectIssueStatesFromLedger(ledgerEntries).map((issue) => [issue.issueId, issue.title]),
		);
		for (const entry of ledgerEntries) {
			const parsed = JSON.parse(entry.payloadJson) as {
				action?: {
					readonly kind?: string;
					readonly targetIssueId?: string;
					readonly description?: string;
					readonly justification?: string;
					readonly closureType?: string;
					readonly rationale?: string;
				};
			};
			const action = parsed.action;
			if (!action?.kind) {
				continue;
			}

			if (
				action.kind === "propose_closure" &&
				action.closureType === "risk_proposed" &&
				typeof action.targetIssueId === "string" &&
				typeof action.rationale === "string"
			) {
				riskProposals.push({
					issueId: action.targetIssueId,
					title: titleByIssueId.get(action.targetIssueId) ?? action.targetIssueId,
					rationale: action.rationale,
					proposedBy: entry.agentId,
				});
			}

			if (
				action.kind === "request_context" &&
				typeof action.description === "string" &&
				typeof action.justification === "string"
			) {
				contextGaps.push({
					description: action.description,
					justification: action.justification,
					requestedBy: entry.agentId,
				});
			}
		}
	}

	return {
		taskId,
		version,
		proposalMarkdown,
		unresolvedIssues,
		riskProposals,
		contextGaps,
		evidenceLinks: [],
		generatedAtMs: Date.now(),
	};
}

function inferRecoveredRoomOutcome(
	roomId: RoomId,
	db: DatabaseHandle,
): "completed" | "inconclusive" {
	const hasUnresolvedIssues = projectIssueStatesFromLedger(readLedgerEntries(db, roomId)).some(
		(issue) =>
			issue.state !== "resolved" && issue.state !== "deferred" && issue.state !== "risk_proposed",
	);
	return hasUnresolvedIssues ? "inconclusive" : "completed";
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new DispatcherError("Dispatch cancelled");
	}
}

function waitForAbort(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		if (signal.aborted) {
			reject(new DispatcherError("Dispatch cancelled"));
			return;
		}

		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(new DispatcherError("Dispatch cancelled"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

export function createDispatcher(deps: DispatcherDeps): Dispatcher {
	const inFlightJobIds = new Set<string>();
	const bundleCache = new Map<string, ContextBundle>();
	const jobControllers = new Map<string, AbortController>();
	const roomRunner = deps.roomRunner ?? runRoom;
	let isShuttingDown = false;

	function getTaskState(taskId: string): WorkflowState {
		const state = deps.authority.getTaskState(taskId);
		if (!state) {
			throw new DispatcherError(`Missing task state for ${taskId}`);
		}
		return state;
	}

	function buildOrReuseBundle(
		taskId: string,
		payload: BuildContextBundleJobPayload,
	): ContextBundle {
		const bundleId = buildBundleId(taskId, payload.iteration);
		const cached = bundleCache.get(bundleId);
		if (cached) {
			return cached;
		}

		const bundle = buildStaticFixtureBundle(
			bundleId,
			payload.bundleInputPath,
			payload.requestedDomains,
		);
		bundleCache.set(bundleId, bundle);
		return bundle;
	}

	function getContextBundle(taskId: string, payload: DomainRoomJobPayload): ContextBundle {
		const cached = bundleCache.get(payload.bundleId);
		if (cached) {
			return cached;
		}

		const state = getTaskState(taskId);
		const bundleInputPath = state.submission?.bundleInputPath;
		const requestedDomains = state.submission?.requestedDomains ?? [payload.domain];
		if (!bundleInputPath) {
			throw new DispatcherError(`Missing submission bundleInputPath for ${taskId}`);
		}

		const rebuilt = buildStaticFixtureBundle(payload.bundleId, bundleInputPath, requestedDomains);
		bundleCache.set(payload.bundleId, rebuilt);
		return rebuilt;
	}

	function buildAgents(spec: RoomSpec<"domain">): readonly Agent<"domain">[] {
		if (deps.createAgents) {
			return deps.createAgents(spec);
		}

		return spec.agentSpecs.map((agentSpec) =>
			createProviderAgent(agentSpec, {
				registry: deps.providerRegistry,
				complete: deps.completeFn,
				roomKind: "domain",
			}),
		);
	}

	async function handleBuildContextJob(
		taskId: string,
		payload: BuildContextBundleJobPayload,
		signal: AbortSignal,
	): Promise<void> {
		const bundle = buildOrReuseBundle(taskId, payload);
		throwIfAborted(signal);
		if (isShuttingDown) {
			return;
		}

		await deps.authority.handleInternalCommand({
			kind: "context_bundle_built",
			commandId: buildInternalCommandId("context_bundle_built", `${taskId}:${payload.iteration}`),
			taskId: taskId as WorkflowState["taskId"],
			timestamp: Date.now(),
			bundleId: bundle.bundleId,
		});
	}

	async function handleRunDomainRoomJob(
		taskId: string,
		payload: DomainRoomJobPayload,
		signal: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		if (readRoomArtifact(deps.db, payload.roomId)) {
			if (isShuttingDown) {
				return;
			}
			await deps.authority.handleInternalCommand({
				kind: "room_completed",
				commandId: buildInternalCommandId("room_completed", payload.roomId),
				taskId: taskId as WorkflowState["taskId"],
				timestamp: Date.now(),
				roomId: payload.roomId,
				roomKind: "domain",
				outcome: inferRecoveredRoomOutcome(payload.roomId, deps.db),
			});
			return;
		}

		let contextBundle: ContextBundle;
		let spec: RoomSpec<"domain">;
		let agents: readonly Agent<"domain">[];
		try {
			throwIfAborted(signal);
			contextBundle = getContextBundle(taskId, payload);
			spec = buildRoomSpecFromJob(deps.config, payload);
			agents = buildAgents(spec);
		} catch (error) {
			if (error instanceof DispatcherError && error.message === "Dispatch cancelled") {
				return;
			}
			await deps.authority.handleInternalCommand({
				kind: "room_failed",
				commandId: buildInternalCommandId("room_failed", payload.roomId),
				taskId: taskId as WorkflowState["taskId"],
				timestamp: Date.now(),
				roomId: payload.roomId,
				errorCode: "room_failed",
				message: error instanceof Error ? error.message : "Domain room setup failed",
			});
			return;
		}

		try {
			await deps.authority.handleInternalCommand({
				kind: "start_room",
				commandId: buildInternalCommandId("start_room", payload.roomId),
				taskId: taskId as WorkflowState["taskId"],
				timestamp: Date.now(),
				roomId: payload.roomId,
				roomKind: "domain",
				domain: payload.domain,
				agentIds: agents.map((agent) => agent.agentId),
			});
		} catch (error) {
			console.warn(
				`Skipping room start for ${payload.roomId}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return;
		}

		let result: RoomRunResult<"domain">;
		try {
			throwIfAborted(signal);
			const roomRunPromise = roomRunner({
				spec,
				agents,
				contextBundle,
				systemPrompt: readDomainSystemPrompt(),
			});
			const raced = await Promise.race([
				roomRunPromise.then(
					(roomResult) => ({ kind: "result" as const, roomResult }),
					(error: unknown) => ({ kind: "error" as const, error }),
				),
				waitForAbort(signal),
			]);
			if (raced.kind === "error") {
				throw raced.error;
			}
			result = raced.roomResult;
		} catch (error) {
			if (error instanceof DispatcherError && error.message === "Dispatch cancelled") {
				return;
			}
			await deps.authority.handleInternalCommand({
				kind: "room_failed",
				commandId: buildInternalCommandId("room_failed", payload.roomId),
				taskId: taskId as WorkflowState["taskId"],
				timestamp: Date.now(),
				roomId: payload.roomId,
				errorCode: "room_failed",
				message: error instanceof Error ? error.message : "Domain room execution failed",
			});
			return;
		}

		throwIfAborted(signal);
		const renderedArtifact = result.renderedArtifact;
		if (!renderedArtifact) {
			await deps.authority.handleInternalCommand({
				kind: "room_failed",
				commandId: buildInternalCommandId("room_failed", payload.roomId),
				taskId: taskId as WorkflowState["taskId"],
				timestamp: Date.now(),
				roomId: payload.roomId,
				errorCode: "render_failed",
				message: "Domain room did not render an artifact",
			});
			return;
		}

		if (isShuttingDown) {
			return;
		}

		withWriteTransaction(deps.db, () => {
			appendLedgerEntries(
				deps.db,
				payload.roomId,
				result.ledgerEntries.map((entry) => toLedgerEntryRecord(payload.roomId, entry)),
			);
			for (const trace of result.turnTraces) {
				appendTurnTrace(deps.db, payload.roomId, toTurnTraceRecord(payload.roomId, trace));
			}
			appendRoomArtifact(
				deps.db,
				toRoomArtifactRecord(payload.roomId, renderedArtifact, result.completedAtMs),
			);
		});

		if (isShuttingDown) {
			return;
		}

		try {
			if (result.outcome === "failed") {
				await deps.authority.handleInternalCommand({
					kind: "room_failed",
					commandId: buildInternalCommandId("room_failed", payload.roomId),
					taskId: taskId as WorkflowState["taskId"],
					timestamp: Date.now(),
					roomId: payload.roomId,
					errorCode: "room_failed",
					message: "Domain room execution failed",
				});
				return;
			}

			await deps.authority.handleInternalCommand({
				kind: "room_completed",
				commandId: buildInternalCommandId("room_completed", payload.roomId),
				taskId: taskId as WorkflowState["taskId"],
				timestamp: Date.now(),
				roomId: payload.roomId,
				roomKind: "domain",
				outcome: result.outcome,
			});
		} catch (error) {
			console.warn(
				`Late room completion for ${payload.roomId}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	async function handleRenderReviewPacketJob(
		taskId: string,
		payload: RenderReviewPacketJobPayload,
		signal: AbortSignal,
	): Promise<void> {
		throwIfAborted(signal);
		if (readReviewPacket(deps.db, taskId, payload.version)) {
			if (isShuttingDown) {
				return;
			}
			await deps.authority.handleInternalCommand({
				kind: "review_packet_rendered",
				commandId: buildInternalCommandId("review_packet_rendered", `${taskId}:${payload.version}`),
				taskId: taskId as WorkflowState["taskId"],
				timestamp: Date.now(),
				version: payload.version,
			});
			return;
		}

		const ledgerByRoom = new Map<RoomId, ReturnType<typeof readLedgerEntries>>();
		const artifactsByRoom = new Map<RoomId, ReturnType<typeof readRoomArtifact>>();
		for (const roomId of payload.sourceRoomIds) {
			throwIfAborted(signal);
			ledgerByRoom.set(roomId, readLedgerEntries(deps.db, roomId));
			artifactsByRoom.set(roomId, readRoomArtifact(deps.db, roomId));
		}
		for (const roomId of payload.sourceRoomIds) {
			const artifact = artifactsByRoom.get(roomId);
			if (!artifact || artifact.content.length === 0) {
				if (isShuttingDown) {
					return;
				}
				await deps.authority.handleInternalCommand({
					kind: "task_failed",
					commandId: buildInternalCommandId("task_failed", `${taskId}:render`),
					taskId: taskId as WorkflowState["taskId"],
					timestamp: Date.now(),
					errorCode: "render_failed",
					message: `Missing room artifact for ${roomId}`,
				});
				return;
			}
		}

		const packet = buildReviewPacket(
			taskId,
			payload.version,
			payload.sourceRoomIds,
			ledgerByRoom,
			artifactsByRoom,
		);
		if (isShuttingDown) {
			return;
		}

		withWriteTransaction(deps.db, () => {
			writeReviewPacket(deps.db, {
				taskId,
				version: payload.version,
				packetJson: JSON.stringify(packet),
				createdAtMs: packet.generatedAtMs,
			});
		});

		if (isShuttingDown) {
			return;
		}

		await deps.authority.handleInternalCommand({
			kind: "review_packet_rendered",
			commandId: buildInternalCommandId("review_packet_rendered", `${taskId}:${payload.version}`),
			taskId: taskId as WorkflowState["taskId"],
			timestamp: Date.now(),
			version: payload.version,
		});
	}

	async function runJob(taskId: string, job: PendingJob): Promise<void> {
		const controller = jobControllers.get(job.jobId);
		if (!controller) {
			throw new DispatcherError(`Missing abort controller for job ${job.jobId}`);
		}

		switch (job.kind) {
			case "build_context_bundle":
				await handleBuildContextJob(
					taskId,
					narrowBuildContextPayload(job.payload),
					controller.signal,
				);
				break;
			case "run_domain_room":
				await handleRunDomainRoomJob(
					taskId,
					narrowDomainRoomPayload(job.payload),
					controller.signal,
				);
				break;
			case "render_review_packet":
				await handleRenderReviewPacketJob(
					taskId,
					narrowRenderPayload(job.payload),
					controller.signal,
				);
				break;
			case "run_synthesis_room":
			case "run_query_back_room":
				throw new DispatcherError(`${job.kind} is out of scope for Phase 5`);
		}
	}

	return {
		kick(taskId: string): void {
			if (isShuttingDown) {
				return;
			}

			const state = deps.authority.getTaskState(taskId);
			if (!state) {
				return;
			}

			for (const job of state.pendingJobs) {
				if (inFlightJobIds.has(job.jobId)) {
					continue;
				}
				inFlightJobIds.add(job.jobId);
				jobControllers.set(job.jobId, new AbortController());
				void runJob(taskId, job)
					.catch(async (error: unknown) => {
						if (error instanceof DispatcherError && error.message === "Dispatch cancelled") {
							return;
						}
						console.warn(
							`Dispatch job ${job.jobId} failed: ${error instanceof Error ? error.message : String(error)}`,
						);
						if (job.kind === "build_context_bundle") {
							await deps.authority.handleInternalCommand({
								kind: "task_failed",
								commandId: buildInternalCommandId("task_failed", `${taskId}:context`),
								taskId: taskId as WorkflowState["taskId"],
								timestamp: Date.now(),
								errorCode: "context_build_failed",
								message: error instanceof Error ? error.message : "Context build failed",
							});
						}
					})
					.finally(() => {
						inFlightJobIds.delete(job.jobId);
						jobControllers.delete(job.jobId);
					});
			}
		},

		async recoverIncompleteTasks(): Promise<void> {
			for (const task of listRecoverableTasks(deps.db)) {
				deps.authority.getTaskState(task.taskId);
				this.kick(task.taskId);
			}
		},

		shutdown(): void {
			isShuttingDown = true;
			for (const controller of jobControllers.values()) {
				controller.abort();
			}
			jobControllers.clear();
			inFlightJobIds.clear();
		},
	};
}

export { buildReviewPacket, buildStaticFixtureBundle, projectIssueStatesFromLedger };

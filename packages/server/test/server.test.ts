// @ts-nocheck

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";
import { buildDefaultConfig } from "@the-hive/config";
import { type WorkflowState, createIssueId, createTaskId } from "@the-hive/protocol/engine";
import { createDefaultProviderRegistry } from "@the-hive/providers";
import { ScriptedAgent } from "@the-hive/room";
import {
	appendLedgerEntries,
	appendRoomArtifact,
	closeDatabase,
	openDatabase,
	readLedgerEntries,
	readReviewPacket,
	readRoomArtifact,
	readTaskIndex,
	readWorkflowEvents,
	runMigrations,
	writeReviewPacket,
} from "@the-hive/storage";

import { createAuthority } from "../src/authority";
import { type DispatcherDeps, buildReviewPacket, createDispatcher } from "../src/dispatch";
import { startHost } from "../src/index";
import { createWireProjector } from "../src/projection";

function createTempDbPath(): { readonly dir: string; readonly path: string } {
	const dir = mkdtempSync(join(tmpdir(), "the-hive-server-"));
	return {
		dir,
		path: join(dir, "server.sqlite"),
	};
}

function createSubmitEnvelope(taskId: string, commandId = `submit:${taskId}`) {
	return {
		protocolVersion: { major: 1, minor: 0 },
		command: {
			kind: "submit_task" as const,
			commandId,
			taskId,
			prompt: "Design the architecture",
			bundleInput: { path: "/tmp/context" },
			requestedDomains: ["backend"],
			configProfile: "default",
			submittedAtMs: 100,
		},
	};
}

function createApproveEnvelope(taskId: string) {
	return {
		protocolVersion: { major: 1, minor: 0 },
		command: {
			kind: "approve_task" as const,
			commandId: `approve:${taskId}`,
			taskId,
			submittedAtMs: 400,
		},
	};
}

function createRejectEnvelope(taskId: string) {
	return {
		protocolVersion: { major: 1, minor: 0 },
		command: {
			kind: "reject_task" as const,
			commandId: `reject:${taskId}`,
			taskId,
			feedback: ["Need more detail"],
			submittedAtMs: 410,
		},
	};
}

function createCancelEnvelope(taskId: string) {
	return {
		protocolVersion: { major: 1, minor: 0 },
		command: {
			kind: "cancel_task" as const,
			commandId: `cancel:${taskId}`,
			taskId,
			submittedAtMs: 420,
		},
	};
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!check()) {
		if (Date.now() > deadline) {
			throw new Error("Timed out waiting for condition");
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

function createResolvedAgentFactory(includeRisk = false, includeContextGap = false) {
	return (
		spec: DispatcherDeps["createAgents"] extends (input: infer T) => infer _R ? T : never,
	) => {
		const issueId = createIssueId();
		return spec.agentSpecs.map((agentSpec) => {
			const turns =
				agentSpec.persona === "critic"
					? [
							{
								summary: "Open issue",
								ledgerActions: [
									{
										kind: "create_issue",
										issueId,
										title: includeRisk ? "Risk decision" : "Need caching",
										description: "The current design lacks a decision",
									},
									...(includeContextGap
										? [
												{
													kind: "request_context" as const,
													description: "Need API schema",
													justification: "The contract is missing",
												},
											]
										: []),
								],
								controlActions: [],
							},
							null,
						]
					: agentSpec.persona === "builder"
						? [
								{
									summary: "Resolve issue",
									ledgerActions: [
										{
											kind: "propose_resolution",
											targetIssueId: issueId,
											proposal: "Add a cache strategy",
										},
									],
									controlActions: [],
								},
								null,
							]
						: [
								{
									summary: "Close issue",
									ledgerActions: [
										{
											kind: "propose_closure",
											targetIssueId: issueId,
											rationale: includeRisk ? "Accept the rollout risk" : "Resolved",
											closureType: includeRisk ? "risk_proposed" : "resolved",
										},
									],
									controlActions: [],
								},
								null,
							];

			return new ScriptedAgent({
				agentId: agentSpec.agentId,
				spec: agentSpec,
				turns,
			});
		});
	};
}

function createHarness(options?: {
	readonly dbPath?: string;
	readonly createAgents?: DispatcherDeps["createAgents"];
	readonly roomRunner?: DispatcherDeps["roomRunner"];
}) {
	const temp = options?.dbPath ? null : createTempDbPath();
	const dbPath = options?.dbPath ?? temp?.path ?? "";
	const db = openDatabase(dbPath);
	runMigrations(db);
	const config = buildDefaultConfig();
	const projector = createWireProjector(db);
	const broadcasts: Array<{ readonly taskId: string; readonly events: readonly unknown[] }> = [];
	let dispatcherRef: ReturnType<typeof createDispatcher> | null = null;
	const authority = createAuthority(
		{
			db,
			projector,
			broadcaster: (taskId, events) => {
				broadcasts.push({ taskId, events });
			},
			dispatcher: (taskId) => {
				dispatcherRef?.kick(taskId);
			},
		},
		config.defaults.maxIterations,
	);
	const dispatcher = createDispatcher({
		db,
		authority,
		config: { ...config, storage: { dbPath } },
		providerRegistry: createDefaultProviderRegistry(),
		completeFn: async () => {
			throw new Error("completeFn should not be called in tests");
		},
		...(options?.createAgents ? { createAgents: options.createAgents } : {}),
		...(options?.roomRunner ? { roomRunner: options.roomRunner } : {}),
	});
	dispatcherRef = dispatcher;

	return {
		db,
		dbPath,
		authority,
		dispatcher,
		projector,
		broadcasts,
		cleanup() {
			dispatcher.shutdown();
			closeDatabase(db);
			if (temp) {
				rmSync(temp.dir, { recursive: true, force: true });
			}
		},
	};
}

describe("server phase 5", () => {
	it("persists workflow events and updates the task index on submit", async () => {
		const temp = createTempDbPath();
		const db = openDatabase(temp.path);
		try {
			runMigrations(db);
			const projector = createWireProjector(db);
			const authority = createAuthority(
				{
					db,
					projector,
					broadcaster: () => {},
					dispatcher: () => {},
				},
				2,
			);
			const taskId = createTaskId();

			await authority.handleWireCommand(createSubmitEnvelope(taskId));

			const events = readWorkflowEvents(db, taskId).map((record) => JSON.parse(record.payloadJson));
			expect(events.map((event) => event.kind)).toEqual([
				"task_submitted",
				"task_started",
				"room_job_enqueued",
			]);
			expect(readTaskIndex(db, taskId)?.externalState).toBe("running");
		} finally {
			closeDatabase(db);
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});

	it("treats duplicate command ids as a no-op", async () => {
		const temp = createTempDbPath();
		const db = openDatabase(temp.path);
		try {
			runMigrations(db);
			const authority = createAuthority(
				{
					db,
					projector: createWireProjector(db),
					broadcaster: () => {},
					dispatcher: () => {},
				},
				2,
			);
			const taskId = createTaskId();
			const envelope = createSubmitEnvelope(taskId, "same-command");

			await authority.handleWireCommand(envelope);
			await authority.handleWireCommand(envelope);

			expect(readWorkflowEvents(db, taskId)).toHaveLength(3);
		} finally {
			closeDatabase(db);
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});

	it("translates submit, approve, and cancel wire commands and rejects reruns", async () => {
		const temp = createTempDbPath();
		const db = openDatabase(temp.path);
		try {
			runMigrations(db);
			const authority = createAuthority(
				{
					db,
					projector: {
						projectCommit: async () => [],
						buildTaskSnapshot: async () => ({
							taskId: "",
							state: "submitted",
							prompt: "",
							createdAtMs: 0,
							updatedAtMs: 0,
						}),
					},
					broadcaster: () => {},
					dispatcher: () => {},
				},
				2,
			);
			const taskId = createTaskId();
			await authority.handleWireCommand(createSubmitEnvelope(taskId));
			const submitEvent = JSON.parse(readWorkflowEvents(db, taskId)[0]?.payloadJson ?? "{}");
			expect(submitEvent.bundleInputPath).toBe("/tmp/context");
			expect(submitEvent.plan).toEqual({
				includeSynthesis: false,
				allowQueryBack: false,
				allowRerun: false,
			});

			await authority.handleInternalCommand({
				kind: "context_bundle_built",
				commandId: `bundle:${taskId}`,
				taskId,
				timestamp: 200,
				bundleId: "bundle:1",
			});
			const roomId = (
				authority.getTaskState(taskId)?.pendingJobs[0]?.payload as { readonly roomId: string }
			).roomId;
			await authority.handleInternalCommand({
				kind: "room_completed",
				commandId: `room:${taskId}`,
				taskId,
				timestamp: 300,
				roomId: roomId as never,
				roomKind: "domain",
				outcome: "completed",
			});
			await authority.handleInternalCommand({
				kind: "review_packet_rendered",
				commandId: `render:${taskId}`,
				taskId,
				timestamp: 350,
				version: 1,
			});

			await authority.handleWireCommand(createApproveEnvelope(taskId));
			expect(JSON.parse(readWorkflowEvents(db, taskId).at(-1)?.payloadJson ?? "{}").timestamp).toBe(
				400,
			);

			const rejectedTaskId = createTaskId();
			await authority.handleWireCommand(createSubmitEnvelope(rejectedTaskId));
			expect(authority.handleWireCommand(createRejectEnvelope(rejectedTaskId))).rejects.toThrow(
				"reject_task is disabled in Phase 5",
			);

			const cancelledTaskId = createTaskId();
			await authority.handleWireCommand(createSubmitEnvelope(cancelledTaskId));
			await authority.handleWireCommand(createCancelEnvelope(cancelledTaskId));
			expect(
				JSON.parse(readWorkflowEvents(db, cancelledTaskId).at(-1)?.payloadJson ?? "{}").timestamp,
			).toBe(420);
		} finally {
			closeDatabase(db);
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});

	it("projects workflow commits into wire events", async () => {
		const temp = createTempDbPath();
		const db = openDatabase(temp.path);
		try {
			runMigrations(db);
			writeReviewPacket(db, {
				taskId: "task-1",
				version: 1,
				packetJson: JSON.stringify({
					taskId: "task-1",
					version: 1,
					proposalMarkdown: "# Proposal",
					unresolvedIssues: [],
					riskProposals: [],
					contextGaps: [],
					evidenceLinks: [],
					generatedAtMs: 500,
				}),
				createdAtMs: 500,
			});
			const projector = createWireProjector(db);
			const prevState = {
				taskId: "task-1",
				externalState: "running",
				internalPhase: "rendering",
				iteration: 0,
				pendingJobs: [],
				completedRoomIds: [],
				reviewPacketVersion: 0,
				maxIterations: 2,
				createdAtMs: 100,
				updatedAtMs: 100,
			} satisfies WorkflowState;
			const nextState = {
				...prevState,
				externalState: "awaiting_review",
				internalPhase: "awaiting_review",
				updatedAtMs: 500,
			};
			const wireEvents = await projector.projectCommit({
				taskId: "task-1",
				prevState,
				nextState,
				events: [
					{
						seq: 1,
						event: {
							kind: "room_started",
							commandId: "c1",
							taskId: "task-1",
							timestamp: 200,
							roomId: "room-1" as never,
							roomKind: "domain",
							agentIds: ["a1" as never],
						},
					},
					{
						seq: 2,
						event: {
							kind: "task_review_ready",
							commandId: "c2",
							taskId: "task-1",
							timestamp: 500,
							version: 1,
						},
					},
				],
				jobs: [],
			});

			expect(wireEvents.map((event) => event.kind)).toEqual([
				"task_state_changed",
				"room_started",
				"task_review_ready",
			]);
		} finally {
			closeDatabase(db);
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});

	it("dispatches build_context_bundle and stores bundle state", async () => {
		const harness = createHarness({
			createAgents: createResolvedAgentFactory(),
			roomRunner: async (input) => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				return {
					roomId: input.spec.roomId,
					kind: "domain",
					outcome: "completed",
					ledgerEntries: [],
					turnTraces: [],
					renderedArtifact: {
						kind: "report_markdown",
						content: "# Waiting",
						pathHint: "report.md",
					},
					health: {
						totalAgents: 1,
						activeAgents: 1,
						failedAgents: 0,
						minHealthyAgents: 1,
						isHealthy: true,
					},
					startedAtMs: 1,
					completedAtMs: 2,
				};
			},
		});
		try {
			const taskId = createTaskId();
			await harness.authority.handleWireCommand(createSubmitEnvelope(taskId));
			await waitFor(() => harness.authority.getTaskState(taskId)?.internalPhase === "mini_rooms");
			const state = harness.authority.getTaskState(taskId);
			expect(state?.bundleId).toBe(`bundle:${taskId}:0`);
			expect(state?.pendingJobs[0]?.kind).toBe("run_domain_room");
			await new Promise((resolve) => setTimeout(resolve, 120));
		} finally {
			harness.cleanup();
		}
	});

	it("runs a domain room and persists ledger, traces, and artifact", async () => {
		const harness = createHarness({ createAgents: createResolvedAgentFactory() });
		try {
			const taskId = createTaskId();
			await harness.authority.handleWireCommand(createSubmitEnvelope(taskId));
			await waitFor(
				() => harness.authority.getTaskState(taskId)?.externalState === "awaiting_review",
			);
			const roomId = harness.authority.getTaskState(taskId)?.completedRoomIds[0];
			expect(roomId).toBeTruthy();
			expect(readLedgerEntries(harness.db, roomId ?? "").length).toBeGreaterThan(0);
			expect(readRoomArtifact(harness.db, roomId ?? "")?.content).toContain("# Room Report");
		} finally {
			harness.cleanup();
		}
	});

	it("builds review packets from persisted ledger entries", () => {
		const roomId = "room:task-1:domain:0:0:backend" as never;
		const packet = buildReviewPacket(
			"task-1",
			1,
			[roomId],
			new Map([
				[
					roomId,
					[
						{
							roomId,
							seq: 1,
							turnId: "turn-1",
							agentId: "agent-1",
							entryType: "create_issue",
							issueId: "issue-1",
							payloadJson: JSON.stringify({
								action: {
									kind: "create_issue",
									issueId: "issue-1",
									title: "Need schema",
									description: "Schema missing",
								},
							}),
							createdAtMs: 100,
						},
						{
							roomId,
							seq: 2,
							turnId: "turn-2",
							agentId: "agent-2",
							entryType: "propose_closure",
							issueId: "issue-1",
							payloadJson: JSON.stringify({
								action: {
									kind: "propose_closure",
									targetIssueId: "issue-1",
									closureType: "risk_proposed",
									rationale: "Accept the risk",
								},
							}),
							createdAtMs: 110,
						},
						{
							roomId,
							seq: 3,
							turnId: "turn-3",
							agentId: "agent-3",
							entryType: "request_context",
							issueId: null,
							payloadJson: JSON.stringify({
								action: {
									kind: "request_context",
									description: "Need API schema",
									justification: "Contract missing",
								},
							}),
							createdAtMs: 120,
						},
					],
				],
			]),
			new Map([
				[
					roomId,
					{
						roomId,
						artifactKind: "report_markdown",
						content: "# Room Report\nRisk accepted",
						pathHint: "report.md",
						createdAtMs: 130,
					},
				],
			]),
		);

		expect(packet.proposalMarkdown).toContain("# Room Report");
		expect(packet.riskProposals).toEqual([
			{
				issueId: "issue-1",
				title: "Need schema",
				rationale: "Accept the risk",
				proposedBy: "agent-2",
			},
		]);
		expect(packet.contextGaps).toEqual([
			{
				description: "Need API schema",
				justification: "Contract missing",
				requestedBy: "agent-3",
			},
		]);
	});

	it("completes the full in-process lifecycle and approves the task", async () => {
		const harness = createHarness({ createAgents: createResolvedAgentFactory(false, true) });
		try {
			const taskId = createTaskId();
			await harness.authority.handleWireCommand(createSubmitEnvelope(taskId));
			await waitFor(
				() => harness.authority.getTaskState(taskId)?.externalState === "awaiting_review",
			);
			const packetRecord = readReviewPacket(harness.db, taskId, 1);
			expect(packetRecord).not.toBeNull();
			const packet = JSON.parse(packetRecord?.packetJson ?? "{}");
			expect(packet.proposalMarkdown).toContain("# Room Report");
			expect(packet.contextGaps).toHaveLength(1);

			await harness.authority.handleWireCommand(createApproveEnvelope(taskId));
			await waitFor(() => harness.authority.getTaskState(taskId)?.externalState === "approved");
		} finally {
			harness.cleanup();
		}
	});

	it("cancels a task while a room is still running", async () => {
		const harness = createHarness({
			createAgents: createResolvedAgentFactory(),
			roomRunner: async (input) => {
				await new Promise((resolve) => setTimeout(resolve, 100));
				return {
					roomId: input.spec.roomId,
					kind: "domain",
					outcome: "completed",
					ledgerEntries: [],
					turnTraces: [],
					renderedArtifact: {
						kind: "report_markdown",
						content: "# Late report",
						pathHint: "report.md",
					},
					health: {
						totalAgents: 1,
						activeAgents: 1,
						failedAgents: 0,
						minHealthyAgents: 1,
						isHealthy: true,
					},
					startedAtMs: 1,
					completedAtMs: 2,
				};
			},
		});
		try {
			const taskId = createTaskId();
			await harness.authority.handleWireCommand(createSubmitEnvelope(taskId));
			await waitFor(() => harness.authority.getTaskState(taskId)?.internalPhase === "mini_rooms");
			await harness.authority.handleWireCommand(createCancelEnvelope(taskId));
			await waitFor(() => harness.authority.getTaskState(taskId)?.externalState === "cancelled");
			await new Promise((resolve) => setTimeout(resolve, 120));
			expect(harness.authority.getTaskState(taskId)?.externalState).toBe("cancelled");
		} finally {
			harness.cleanup();
		}
	});

	it("recovers incomplete tasks after restart", async () => {
		const temp = createTempDbPath();
		const taskId = createTaskId();
		const db = openDatabase(temp.path);
		runMigrations(db);
		const authority = createAuthority(
			{
				db,
				projector: createWireProjector(db),
				broadcaster: () => {},
				dispatcher: () => {},
			},
			2,
		);
		await authority.handleWireCommand(createSubmitEnvelope(taskId));
		await authority.handleInternalCommand({
			kind: "context_bundle_built",
			commandId: `bundle:${taskId}`,
			taskId,
			timestamp: 200,
			bundleId: `bundle:${taskId}:0`,
		});
		const roomId = (
			authority.getTaskState(taskId)?.pendingJobs[0]?.payload as { readonly roomId: string }
		).roomId;
		appendLedgerEntries(db, roomId, [
			{
				roomId,
				seq: 1,
				turnId: "turn-1",
				agentId: "agent-1",
				entryType: "create_issue",
				issueId: "issue-1",
				payloadJson: JSON.stringify({
					action: {
						kind: "create_issue",
						issueId: "issue-1",
						title: "Recovered issue",
						description: "Recovered description",
					},
				}),
				createdAtMs: 210,
			},
		]);
		appendRoomArtifact(db, {
			roomId,
			artifactKind: "report_markdown",
			content: "# Recovered Report",
			pathHint: "report.md",
			createdAtMs: 220,
		});
		closeDatabase(db);

		const recovered = createHarness({
			dbPath: temp.path,
			createAgents: createResolvedAgentFactory(),
		});
		try {
			await recovered.dispatcher.recoverIncompleteTasks();
			await waitFor(
				() => recovered.authority.getTaskState(taskId)?.externalState === "awaiting_review",
			);
			expect(
				recovered.broadcasts.some((entry) =>
					entry.events.some(
						(event) =>
							(event as { readonly kind?: string; readonly outcome?: string }).kind ===
								"room_completed" &&
							(event as { readonly outcome?: string }).outcome === "inconclusive",
					),
				),
			).toBe(true);
			expect(readReviewPacket(recovered.db, taskId, 1)?.packetJson).toContain("Recovered Report");
		} finally {
			recovered.cleanup();
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});

	it("returns a wire error envelope for invalid websocket commands", async () => {
		const temp = createTempDbPath();
		const config = {
			...buildDefaultConfig(),
			server: { host: "127.0.0.1", port: 4180, headless: true },
			storage: { dbPath: temp.path },
		};
		const host = await startHost(config);
		try {
			const response = await new Promise<string>((resolve, reject) => {
				const socket = new WebSocket(host.url);
				socket.onopen = () => {
					socket.send(
						JSON.stringify({
							protocolVersion: { major: 1, minor: 0 },
							command: { kind: "not_real", commandId: "bad-1", taskId: "task-1" },
						}),
					);
				};
				socket.onmessage = (event) => {
					resolve(String(event.data));
					socket.close();
				};
				socket.onerror = () => reject(new Error("websocket failed"));
			});
			const parsed = JSON.parse(response) as { readonly error?: { readonly code?: string } };
			expect(parsed.error?.code).toBe("UNKNOWN_COMMAND");
		} finally {
			await host.shutdown();
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});

	it("returns invalid payload for malformed websocket commands", async () => {
		const temp = createTempDbPath();
		const config = {
			...buildDefaultConfig(),
			server: { host: "127.0.0.1", port: 4181, headless: true },
			storage: { dbPath: temp.path },
		};
		const host = await startHost(config);
		try {
			const response = await new Promise<string>((resolve, reject) => {
				const socket = new WebSocket(host.url);
				socket.onopen = () => {
					socket.send(
						JSON.stringify({
							protocolVersion: { major: 1, minor: 0 },
							command: {
								kind: "reject_task",
								commandId: "bad-2",
								taskId: "task-1",
								feedback: [123],
								submittedAtMs: 10,
							},
						}),
					);
				};
				socket.onmessage = (event) => {
					resolve(String(event.data));
					socket.close();
				};
				socket.onerror = () => reject(new Error("websocket failed"));
			});
			const parsed = JSON.parse(response) as { readonly error?: { readonly code?: string } };
			expect(parsed.error?.code).toBe("INVALID_PAYLOAD");
		} finally {
			await host.shutdown();
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});

	it("fails the task when a room does not produce an artifact", async () => {
		const harness = createHarness({
			createAgents: createResolvedAgentFactory(),
			roomRunner: async (input) => ({
				roomId: input.spec.roomId,
				kind: "domain",
				outcome: "completed",
				ledgerEntries: [],
				turnTraces: [],
				health: {
					totalAgents: 1,
					activeAgents: 1,
					failedAgents: 0,
					minHealthyAgents: 1,
					isHealthy: true,
				},
				startedAtMs: 1,
				completedAtMs: 2,
			}),
		});
		try {
			const taskId = createTaskId();
			await harness.authority.handleWireCommand(createSubmitEnvelope(taskId));
			await waitFor(() => harness.authority.getTaskState(taskId)?.externalState === "failed");
			const lastEvent = JSON.parse(
				readWorkflowEvents(harness.db, taskId).at(-1)?.payloadJson ?? "{}",
			);
			expect(lastEvent.errorCode).toBe("render_failed");
		} finally {
			harness.cleanup();
		}
	});

	it("fails rendering when a completed room artifact is missing", async () => {
		const temp = createTempDbPath();
		const db = openDatabase(temp.path);
		runMigrations(db);
		const authority = createAuthority(
			{
				db,
				projector: createWireProjector(db),
				broadcaster: () => {},
				dispatcher: () => {},
			},
			2,
		);
		const taskId = createTaskId();
		await authority.handleWireCommand(createSubmitEnvelope(taskId));
		await authority.handleInternalCommand({
			kind: "context_bundle_built",
			commandId: `bundle:${taskId}`,
			taskId,
			timestamp: 200,
			bundleId: `bundle:${taskId}:0`,
		});
		const roomId = (
			authority.getTaskState(taskId)?.pendingJobs[0]?.payload as { readonly roomId: string }
		).roomId;
		await authority.handleInternalCommand({
			kind: "room_completed",
			commandId: `room:${taskId}`,
			taskId,
			timestamp: 300,
			roomId: roomId as never,
			roomKind: "domain",
			outcome: "completed",
		});
		closeDatabase(db);
		const harness = createHarness({ dbPath: temp.path });
		try {
			await harness.dispatcher.recoverIncompleteTasks();
			await waitFor(() => harness.authority.getTaskState(taskId)?.externalState === "failed");
			const lastEvent = JSON.parse(
				readWorkflowEvents(harness.db, taskId).at(-1)?.payloadJson ?? "{}",
			);
			expect(lastEvent.errorCode).toBe("render_failed");
		} finally {
			harness.cleanup();
			rmSync(temp.dir, { recursive: true, force: true });
		}
	});
});

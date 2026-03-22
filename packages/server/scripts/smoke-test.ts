#!/usr/bin/env bun

/**
 * Smoke test: boots the full server with ScriptedAgents over real WebSocket,
 * then drives a complete task lifecycle (submit → deliberate → review → approve).
 *
 * Usage (from repo root):
 *   bun packages/server/scripts/smoke-test.ts [--debug]
 *
 * Exits 0 on success, 1 on failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDefaultConfig } from "@the-hive/config";
import { createIssueId } from "@the-hive/protocol/engine";
import type { Agent, AgentSpec, RoomSpec } from "@the-hive/protocol/engine";
import { createDefaultProviderRegistry } from "@the-hive/providers";

import { ScriptedAgent } from "@the-hive/room";
import { closeDatabase, openDatabase, runMigrations } from "@the-hive/storage";

import { createAuthority } from "../src/authority";
import { createDispatcher } from "../src/dispatch";
import { createWireProjector } from "../src/projection";
import { createWsServer } from "../src/ws";

// ── Debug flag ──────────────────────────────────────────────────────────────

const DEBUG = process.argv.includes("--debug");

function log(tag: string, message: string): void {
	const timestamp = new Date().toISOString().slice(11, 23);
	console.log(`[${timestamp}] [${tag}] ${message}`);
}

function debug(tag: string, message: string): void {
	if (DEBUG) {
		const timestamp = new Date().toISOString().slice(11, 23);
		console.log(`[${timestamp}] [${tag}] ${message}`);
	}
}

// ── ScriptedAgent factory ───────────────────────────────────────────────────

function createSmokeTestAgents(spec: RoomSpec<"domain">): readonly Agent<"domain">[] {
	const issueId = createIssueId();

	return spec.agentSpecs.map((agentSpec: AgentSpec, index: number) => {
		const role = index === 0 ? "creator" : index === 1 ? "resolver" : "closer";

		const turns =
			role === "creator"
				? [
						{
							summary: "Identify architectural concern",
							ledgerActions: [
								{
									kind: "create_issue" as const,
									issueId,
									title: "Missing cache invalidation strategy",
									description:
										"The proposed architecture does not address how cached data will be invalidated when the source of truth changes. This is a critical gap for data consistency.",
								},
							],
							controlActions: [],
						},
						null, // vote end on second call
					]
				: role === "resolver"
					? [
							{
								summary: "Propose resolution with TTL-based approach",
								ledgerActions: [
									{
										kind: "propose_resolution" as const,
										targetIssueId: issueId,
										proposal:
											"Use a TTL-based cache with event-driven invalidation. Each cache entry gets a 5-minute TTL as a safety net, but primary invalidation is driven by domain events published through the message bus. This gives us both consistency and performance.",
									},
								],
								controlActions: [],
							},
							null,
						]
					: [
							{
								summary: "Close issue as resolved",
								ledgerActions: [
									{
										kind: "propose_closure" as const,
										targetIssueId: issueId,
										rationale:
											"The TTL + event-driven approach is sound. It handles both the happy path (event-driven invalidation) and the failure path (TTL expiry). No objections.",
										closureType: "resolved" as const,
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
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
	const startTime = Date.now();
	log("SMOKE", "Starting smoke test...");

	// 1. Setup temp DB and config
	const tempDir = mkdtempSync(join(tmpdir(), "the-hive-smoke-"));
	const dbPath = join(tempDir, "smoke.sqlite");
	const port = 4199; // unlikely to collide
	const config = {
		...buildDefaultConfig(),
		server: { host: "127.0.0.1", port, headless: true },
		storage: { dbPath },
	};

	debug("SETUP", `Temp dir: ${tempDir}`);
	debug("SETUP", `DB: ${dbPath}`);
	debug("SETUP", `WS port: ${port}`);

	const db = openDatabase(dbPath);
	runMigrations(db);
	log("SMOKE", "Database initialized");

	// 2. Wire server components (same as startHost but with agent override)
	const projector = createWireProjector(db);

	let dispatcherRef: ReturnType<typeof createDispatcher> | null = null;
	const authority = createAuthority(
		{
			db,
			projector,
			broadcaster: (taskId, events) => {
				debug("BROADCAST", `task=${taskId} events=${events.length}`);
				for (const event of events) {
					const e = event as { readonly kind?: string };
					debug("BROADCAST", `  → ${e.kind ?? "unknown"}`);
				}
				wsServer.broadcast(taskId, events);
			},
			dispatcher: (taskId) => {
				dispatcherRef?.kick(taskId);
			},
		},
		config.defaults.maxIterations,
	);

	const wsServer = createWsServer({
		authority,
		projector,
		db,
		host: config.server.host,
		port: config.server.port,
	});

	const dispatcher = createDispatcher({
		db,
		authority,
		config,
		providerRegistry: createDefaultProviderRegistry(),
		completeFn: async () => {
			throw new Error("completeFn should not be called with ScriptedAgents");
		},
		createAgents: createSmokeTestAgents,
	});
	dispatcherRef = dispatcher;

	log("SMOKE", `Server listening on ws://127.0.0.1:${port}`);

	// 3. Connect a WebSocket client (like the CLI would)
	const serverUrl = `ws://127.0.0.1:${port}`;
	const taskId = crypto.randomUUID();
	const receivedEvents: Array<{ readonly kind: string; [key: string]: unknown }> = [];
	let resolveTerminal: (() => void) | null = null;
	let rejectTerminal: ((error: Error) => void) | null = null;

	const terminalPromise = new Promise<void>((resolve, reject) => {
		resolveTerminal = resolve;
		rejectTerminal = reject;
	});

	const timeout = setTimeout(() => {
		rejectTerminal?.(new Error("Smoke test timed out after 15s"));
	}, 15_000);

	log("SMOKE", `Connecting to ${serverUrl}...`);
	const ws = new WebSocket(serverUrl);

	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => {
			log("SMOKE", "WebSocket connected");
			resolve();
		};
		ws.onerror = (event) => {
			reject(new Error(`WebSocket error: ${(event as ErrorEvent).message ?? "unknown"}`));
		};
	});

	let approveSent = false;

	ws.onmessage = (event) => {
		const raw = JSON.parse(String(event.data)) as Record<string, unknown>;

		if ("error" in raw) {
			const error = raw.error as { readonly code?: string; readonly message?: string };
			// TASK_NOT_FOUND is expected when subscribe arrives before submit
			if (error.code === "TASK_NOT_FOUND") {
				debug("CLIENT", "TASK_NOT_FOUND (subscribe before submit — expected)");
				return;
			}
			log("ERROR", `Server error: ${error.code} — ${error.message}`);
			rejectTerminal?.(new Error(`Server error: ${error.code}`));
			return;
		}

		if ("event" in raw) {
			const wireEvent = raw.event as { readonly kind: string; [key: string]: unknown };
			receivedEvents.push(wireEvent);
			log("EVENT", formatEventCompact(wireEvent));

			// Check for awaiting_review from state change or snapshot
			let currentState: string | undefined;
			if (wireEvent.kind === "task_state_changed") {
				currentState = wireEvent.toState as string;
			} else if (wireEvent.kind === "task_snapshot") {
				currentState = (wireEvent.snapshot as { readonly state?: string })?.state;
			}

			if (currentState === "awaiting_review" && !approveSent) {
				approveSent = true;
				log("SMOKE", "Task is awaiting review — sending approve...");
				ws.send(
					JSON.stringify({
						protocolVersion: { major: 1, minor: 0 },
						command: {
							kind: "approve_task",
							commandId: crypto.randomUUID(),
							taskId,
							submittedAtMs: Date.now(),
						},
					}),
				);
			}

			if (
				currentState === "approved" ||
				currentState === "failed" ||
				currentState === "cancelled"
			) {
				resolveTerminal?.();
			}
		}
	};

	// 4. Subscribe first, then submit.
	// Subscribe registers the socket for broadcasts even if the task doesn't exist yet
	// (TASK_NOT_FOUND error is expected and ignored). This ensures all subsequent
	// broadcasts from the submit pipeline reach this client.
	log("SMOKE", `Subscribing to task ${taskId.slice(0, 8)}...`);

	ws.send(
		JSON.stringify({
			protocolVersion: { major: 1, minor: 0 },
			command: {
				kind: "subscribe_task",
				commandId: crypto.randomUUID(),
				taskId,
			},
		}),
	);

	// Let subscribe complete on the server before submitting
	await new Promise((resolve) => setTimeout(resolve, 20));

	log("SMOKE", `Submitting task ${taskId.slice(0, 8)}...`);

	ws.send(
		JSON.stringify({
			protocolVersion: { major: 1, minor: 0 },
			command: {
				kind: "submit_task",
				commandId: crypto.randomUUID(),
				taskId,
				prompt: "Design a cache invalidation strategy for a microservices architecture",
				bundleInput: { path: "/tmp/nonexistent-context" },
				requestedDomains: ["backend"],
				submittedAtMs: Date.now(),
			},
		}),
	);

	// 5. Wait for terminal state
	try {
		await terminalPromise;
	} finally {
		clearTimeout(timeout);
		ws.close();
	}

	// 6. Verify results
	const finalState = authority.getTaskState(taskId);
	const elapsed = Date.now() - startTime;

	log("SMOKE", "");
	log("SMOKE", "═══════════════════════════════════════════════");
	log("SMOKE", "  SMOKE TEST RESULTS");
	log("SMOKE", "═══════════════════════════════════════════════");
	log("SMOKE", "");

	const stateChanges = receivedEvents
		.filter((e) => e.kind === "task_state_changed")
		.map((e) => `${e.fromState} → ${e.toState}`);
	log("RESULT", `State transitions: ${stateChanges.join(", ")}`);
	log("RESULT", `Final state: ${finalState?.externalState ?? "unknown"}`);
	log("RESULT", `Wire events received: ${receivedEvents.length}`);
	log("RESULT", `Event types: ${receivedEvents.map((e) => e.kind).join(", ")}`);

	const hasReviewPacket = receivedEvents.some((e) => e.kind === "task_review_ready");
	log("RESULT", `Review packet delivered: ${hasReviewPacket ? "YES" : "NO"}`);

	if (hasReviewPacket) {
		const reviewEvent = receivedEvents.find((e) => e.kind === "task_review_ready") as {
			readonly reviewPacket?: {
				readonly proposalMarkdown?: string;
				readonly unresolvedIssues?: readonly unknown[];
				readonly riskProposals?: readonly unknown[];
				readonly contextGaps?: readonly unknown[];
			};
		};
		const packet = reviewEvent?.reviewPacket;
		if (packet) {
			log("RESULT", `Proposal length: ${packet.proposalMarkdown?.length ?? 0} chars`);
			log("RESULT", `Unresolved issues: ${packet.unresolvedIssues?.length ?? 0}`);
			log("RESULT", `Risk proposals: ${packet.riskProposals?.length ?? 0}`);
			log("RESULT", `Context gaps: ${packet.contextGaps?.length ?? 0}`);

			if (DEBUG && packet.proposalMarkdown) {
				log("RESULT", "");
				log("RESULT", "── Proposal Markdown ──");
				console.log(packet.proposalMarkdown);
				log("RESULT", "── End ──");
			}
		}
	}

	log("SMOKE", "");
	log("RESULT", `Elapsed: ${elapsed}ms`);

	// Assertions
	const passed = finalState?.externalState === "approved" && hasReviewPacket;

	if (passed) {
		log("SMOKE", "✓ SMOKE TEST PASSED");
	} else {
		log("SMOKE", "✗ SMOKE TEST FAILED");
		if (finalState?.externalState !== "approved") {
			log("FAIL", `Expected final state 'approved', got '${finalState?.externalState}'`);
		}
		if (!hasReviewPacket) {
			log("FAIL", "No review packet was delivered");
		}
	}

	log("SMOKE", "═══════════════════════════════════════════════");

	// 7. Cleanup
	wsServer.shutdown();
	dispatcher.shutdown();
	closeDatabase(db);
	rmSync(tempDir, { recursive: true, force: true });
	debug("CLEANUP", "Temp files removed");

	if (!passed) {
		process.exitCode = 1;
	}
}

function formatEventCompact(event: { readonly kind: string; [key: string]: unknown }): string {
	switch (event.kind) {
		case "task_state_changed":
			return `state: ${event.fromState} → ${event.toState}`;
		case "task_snapshot": {
			const snapshotState = (event.snapshot as { readonly state?: string })?.state ?? "?";
			return `snapshot: state=${snapshotState}`;
		}
		case "room_started": {
			const roomIdStr = (event.roomId as string) ?? "?";
			return `room started: ${roomIdStr.slice(0, 30)}...`;
		}
		case "room_completed":
			return `room completed: outcome=${event.outcome ?? "?"}`;
		case "task_review_ready":
			return "review packet delivered";
		case "task_failed":
			return `FAILED: ${event.errorCode} — ${event.message}`;
		case "task_cancelled":
			return "cancelled";
		default:
			return event.kind;
	}
}

main().catch((error) => {
	log("FATAL", error instanceof Error ? error.message : String(error));
	if (DEBUG && error instanceof Error && error.stack) {
		console.error(error.stack);
	}
	process.exitCode = 1;
});

import { describe, expect, it } from "bun:test";

import type { TaskSnapshotView, WireError, WireEvent } from "@the-hive/protocol/wire";

import { formatError, formatEvent, formatSnapshot } from "../src/format";

describe("cli formatting", () => {
	it("formats task state changes", () => {
		const event: WireEvent = {
			kind: "task_state_changed",
			taskId: "task-1",
			fromState: "submitted",
			toState: "running",
			changedAtMs: 1_700_000_000_000,
		};

		expect(formatEvent(event)).toContain("[task_state_changed] submitted -> running");
	});

	it("formats room lifecycle events", () => {
		const started: WireEvent = {
			kind: "room_started",
			taskId: "task-1",
			roomId: "room-1",
			roomKind: "domain",
			agentIds: ["agent-1", "agent-2", "agent-3"],
			startedAtMs: 1_700_000_000_000,
		};
		const completed: WireEvent = {
			kind: "room_completed",
			taskId: "task-1",
			roomId: "room-1",
			roomKind: "domain",
			outcome: "completed",
			completedAtMs: 1_700_000_001_000,
		};

		expect(formatEvent(started)).toContain("[room_started] room=room-1 kind=domain agents=3");
		expect(formatEvent(completed)).toContain(
			"[room_completed] room=room-1 kind=domain outcome=completed",
		);
	});

	it("formats review ready events with proposal markdown", () => {
		const event: WireEvent = {
			kind: "task_review_ready",
			taskId: "task-1",
			reviewPacket: {
				taskId: "task-1",
				version: 1,
				proposalMarkdown: "# Proposal",
				unresolvedIssues: [],
				riskProposals: [],
				contextGaps: [],
				evidenceLinks: [],
				generatedAtMs: 1_700_000_001_000,
			},
			readyAtMs: 1_700_000_001_000,
		};

		const output = formatEvent(event);
		expect(output).toContain("[task_review_ready] version=1");
		expect(output).toContain("--- PROPOSAL ---");
		expect(output).toContain("# Proposal");
	});

	it("formats failures, cancellations, snapshots, and errors", () => {
		const failedEvent: WireEvent = {
			kind: "task_failed",
			taskId: "task-1",
			errorCode: "render_failed",
			message: "Renderer failed",
			failedAtMs: 1_700_000_002_000,
		};
		const cancelledEvent: WireEvent = {
			kind: "task_cancelled",
			taskId: "task-1",
			cancelledAtMs: 1_700_000_003_000,
		};
		const snapshot: TaskSnapshotView = {
			taskId: "task-1",
			state: "awaiting_review",
			prompt: "Design the system",
			currentPhase: "awaiting_review",
			roomSummaries: [],
			createdAtMs: 1_700_000_000_000,
			updatedAtMs: 1_700_000_003_000,
		};
		const snapshotEvent: WireEvent = {
			kind: "task_snapshot",
			commandId: "cmd-1",
			snapshot,
			sentAtMs: 1_700_000_003_000,
		};
		const error: WireError = {
			code: "INVALID_PAYLOAD",
			message: "Bad payload",
		};

		expect(formatEvent(failedEvent)).toContain(
			"[task_failed] code=render_failed message=Renderer failed",
		);
		expect(formatEvent(cancelledEvent)).toContain("[task_cancelled]");
		expect(formatSnapshot(snapshot)).toContain("task=task-1 state=awaiting_review");
		expect(formatEvent(snapshotEvent)).toContain(
			"[task_snapshot] task=task-1 state=awaiting_review",
		);
		expect(formatError(error)).toBe("[error] code=INVALID_PAYLOAD message=Bad payload");
	});
});

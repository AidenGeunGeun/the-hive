import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	type LedgerEntryRecord,
	type PersistableWorkflowEvent,
	type QueryResponseArtifactRecord,
	type ReviewPacketRecord,
	type RoomArtifactRecord,
	type TaskIndexRecord,
	type TurnTraceRecord,
	type WorkflowEventRecord,
	type WorkflowSnapshotRecord,
	appendLedgerEntries,
	appendQueryResponseArtifact,
	appendRoomArtifact,
	appendTurnTrace,
	appendWorkflowEvents,
	appendWorkflowEventsAutoSeq,
	closeDatabase,
	listRecoverableTasks,
	openDatabase,
	readLatestReviewPacket,
	readLatestSnapshot,
	readLedgerEntries,
	readQueryResponseArtifacts,
	readReviewPacket,
	readRoomArtifact,
	readTaskIndex,
	readTurnTraces,
	readWorkflowEvents,
	runMigrations,
	upsertTaskIndex,
	withTransaction,
	withWriteTransaction,
	writeReviewPacket,
	writeSnapshot,
} from "../src/index";

class TestTransactionError extends Error {
	constructor() {
		super("transaction rollback");
		this.name = "TestTransactionError";
	}
}

function createTempDatabasePath(): { readonly dir: string; readonly path: string } {
	const dir = mkdtempSync(join(tmpdir(), "the-hive-storage-"));
	return {
		dir,
		path: join(dir, "storage.sqlite"),
	};
}

function createWorkflowEventRecords(taskId: string): readonly WorkflowEventRecord[] {
	return [
		{
			taskId,
			seq: 1,
			eventType: "task_submitted",
			payloadJson: JSON.stringify({ prompt: "Design the system" }),
			createdAtMs: 100,
		},
		{
			taskId,
			seq: 2,
			eventType: "task_started",
			payloadJson: JSON.stringify({}),
			createdAtMs: 110,
		},
		{
			taskId,
			seq: 6,
			eventType: "task_review_ready",
			payloadJson: JSON.stringify({ version: 1 }),
			createdAtMs: 160,
		},
	];
}

function createPersistableWorkflowEvents(): readonly PersistableWorkflowEvent[] {
	return [
		{
			eventType: "task_submitted",
			payloadJson: JSON.stringify({ prompt: "Design the system" }),
			createdAtMs: 100,
		},
		{
			eventType: "task_started",
			payloadJson: JSON.stringify({}),
			createdAtMs: 110,
		},
	];
}

function createLedgerEntryRecords(roomId: string): readonly LedgerEntryRecord[] {
	return [
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
					title: "Need caching",
					description: "The current plan is missing a cache layer",
				},
			}),
			createdAtMs: 200,
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
					rationale: "Accept the rollout risk",
				},
			}),
			createdAtMs: 210,
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
					justification: "The contract is not documented",
				},
			}),
			createdAtMs: 220,
		},
	];
}

function createTurnTrace(roomId: string): TurnTraceRecord {
	return {
		roomId,
		turnId: "turn-1",
		agentId: "agent-1",
		promptJson: JSON.stringify({ system: "prompt" }),
		rawResponseJson: JSON.stringify({ raw: "response" }),
		parseStatus: "parsed",
		normalizedTurnJson: JSON.stringify({ action: "create_issue" }),
		validationErrorsJson: null,
		usageJson: JSON.stringify({ inputTokens: 10, outputTokens: 20 }),
		timingJson: JSON.stringify({ startedAtMs: 1, completedAtMs: 2 }),
		createdAtMs: 300,
	};
}

function createQueryArtifact(): QueryResponseArtifactRecord {
	return {
		artifactId: "artifact-1",
		sourceRoomId: "room-source",
		sourceRoomRevision: 2,
		synthesisRoomId: "room-synthesis",
		question: "What retries are acceptable?",
		payloadJson: JSON.stringify({ answerMarkdown: "Use exponential backoff" }),
		createdAtMs: 400,
	};
}

function createRoomArtifact(roomId: string): RoomArtifactRecord {
	return {
		roomId,
		artifactKind: "report_markdown",
		content: "# Domain report",
		pathHint: "reports/domain.md",
		createdAtMs: 500,
	};
}

function createReviewPacket(
	taskId: string,
	version: number,
	createdAtMs: number,
): ReviewPacketRecord {
	return {
		taskId,
		version,
		packetJson: JSON.stringify({ version, proposalMarkdown: `proposal-${version}` }),
		createdAtMs,
	};
}

function createTaskIndex(
	taskId: string,
	externalState: string,
	updatedAtMs: number,
): TaskIndexRecord {
	return {
		taskId,
		externalState,
		internalPhase: externalState === "awaiting_review" ? "awaiting_review" : "mini_rooms",
		prompt: `Prompt for ${taskId}`,
		latestEventSeq: updatedAtMs / 10,
		createdAtMs: 100,
		updatedAtMs,
	};
}

describe("storage", () => {
	it("runs migrations on a fresh database and creates all tables and views", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);

			const objects = db
				.query("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view')")
				.all() as { readonly name: string; readonly type: string }[];
			const names = objects.map((row) => row.name).sort();

			expect(names).toEqual(
				expect.arrayContaining([
					"context_gaps_v",
					"current_issue_state_v",
					"ledger_entries",
					"open_issues_v",
					"query_response_artifacts",
					"review_packets",
					"risk_proposals_v",
					"room_artifacts",
					"tasks",
					"turn_traces",
					"workflow_events",
					"workflow_snapshots",
				]),
			);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("appends and reads workflow events in sequence order with afterSeq filtering", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const records = createWorkflowEventRecords("task-1");
			appendWorkflowEvents(db, "task-1", [
				records[2] as WorkflowEventRecord,
				records[0] as WorkflowEventRecord,
				records[1] as WorkflowEventRecord,
			]);

			expect(readWorkflowEvents(db, "task-1").map((record) => record.seq)).toEqual([1, 2, 6]);
			expect(readWorkflowEvents(db, "task-1", 2).map((record) => record.seq)).toEqual([6]);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("assigns workflow event seq values automatically inside write transactions", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);

			const firstBatch = withWriteTransaction(db, () =>
				appendWorkflowEventsAutoSeq(db, "task-1", createPersistableWorkflowEvents()),
			);
			const secondBatch = withWriteTransaction(db, () =>
				appendWorkflowEventsAutoSeq(db, "task-1", [
					{
						eventType: "task_review_ready",
						payloadJson: JSON.stringify({ version: 1 }),
						createdAtMs: 120,
					},
				]),
			);

			expect(firstBatch.map((record) => record.seq)).toEqual([1, 2]);
			expect(secondBatch.map((record) => record.seq)).toEqual([3]);
			expect(readWorkflowEvents(db, "task-1").map((record) => record.seq)).toEqual([1, 2, 3]);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("writes snapshots and returns the latest snapshot", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const firstSnapshot: WorkflowSnapshotRecord = {
				taskId: "task-1",
				eventSeq: 2,
				snapshotJson: JSON.stringify({ iteration: 0 }),
				createdAtMs: 100,
			};
			const secondSnapshot: WorkflowSnapshotRecord = {
				taskId: "task-1",
				eventSeq: 7,
				snapshotJson: JSON.stringify({ iteration: 1 }),
				createdAtMs: 200,
			};

			writeSnapshot(db, "task-1", firstSnapshot);
			writeSnapshot(db, "task-1", secondSnapshot);

			expect(readLatestSnapshot(db, "task-1")).toEqual(secondSnapshot);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("round-trips ledger entries, turn traces, and query response artifacts", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const roomId = "room-1";
			appendLedgerEntries(db, roomId, createLedgerEntryRecords(roomId));
			appendTurnTrace(db, roomId, createTurnTrace(roomId));
			appendQueryResponseArtifact(db, createQueryArtifact());

			expect(readLedgerEntries(db, roomId)).toEqual(createLedgerEntryRecords(roomId));
			expect(readTurnTraces(db, roomId)).toEqual([createTurnTrace(roomId)]);
			expect(readQueryResponseArtifacts(db, "room-synthesis")).toEqual([createQueryArtifact()]);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("round-trips room artifacts and returns null for missing rooms", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const artifact = createRoomArtifact("room-artifact");
			appendRoomArtifact(db, artifact);

			expect(readRoomArtifact(db, artifact.roomId)).toEqual(artifact);
			expect(readRoomArtifact(db, "missing-room")).toBeNull();
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("writes review packets, reads specific versions, and returns the latest version", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const firstPacket = createReviewPacket("task-1", 1, 600);
			const secondPacket = createReviewPacket("task-1", 2, 700);
			writeReviewPacket(db, firstPacket);
			writeReviewPacket(db, secondPacket);

			expect(readReviewPacket(db, "task-1", 1)).toEqual(firstPacket);
			expect(readReviewPacket(db, "task-1", 3)).toBeNull();
			expect(readLatestReviewPacket(db, "task-1")).toEqual(secondPacket);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("upserts task index records and lists only recoverable tasks", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const runningTask = createTaskIndex("task-running", "running", 200);
			const updatedRunningTask = {
				...runningTask,
				internalPhase: "awaiting_review",
				externalState: "awaiting_review",
				latestEventSeq: 42,
				updatedAtMs: 300,
			};
			const approvedTask = createTaskIndex("task-approved", "approved", 250);
			const rejectedTask = createTaskIndex("task-rejected", "rejected", 260);

			upsertTaskIndex(db, runningTask);
			upsertTaskIndex(db, approvedTask);
			upsertTaskIndex(db, rejectedTask);
			upsertTaskIndex(db, updatedRunningTask);

			expect(readTaskIndex(db, "task-running")).toEqual(updatedRunningTask);
			expect(listRecoverableTasks(db)).toEqual([rejectedTask, updatedRunningTask]);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("rolls back all writes when a transaction throws", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const roomId = "room-atomic";

			expect(() =>
				withTransaction(db, () => {
					appendLedgerEntries(db, roomId, createLedgerEntryRecords(roomId));
					appendTurnTrace(db, roomId, createTurnTrace(roomId));
					appendWorkflowEventsAutoSeq(db, "task-atomic", createPersistableWorkflowEvents());
					throw new TestTransactionError();
				}),
			).toThrow(TestTransactionError);

			expect(readLedgerEntries(db, roomId)).toEqual([]);
			expect(readTurnTraces(db, roomId)).toEqual([]);
			expect(readWorkflowEvents(db, "task-atomic")).toEqual([]);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});

	it("materializes issue and context views from append-only ledger entries", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);
			const roomId = "room-view";
			appendLedgerEntries(db, roomId, createLedgerEntryRecords(roomId));

			const currentIssueState = db
				.query(
					"SELECT room_id, issue_id, current_state FROM current_issue_state_v WHERE room_id = ?1",
				)
				.get(roomId) as {
				readonly room_id: string;
				readonly issue_id: string;
				readonly current_state: string;
			};
			const riskProposals = db
				.query("SELECT issue_id FROM risk_proposals_v WHERE room_id = ?1")
				.all(roomId) as { readonly issue_id: string }[];
			const openIssues = db
				.query("SELECT issue_id FROM open_issues_v WHERE room_id = ?1")
				.all(roomId) as { readonly issue_id: string }[];
			const contextGaps = db
				.query("SELECT description FROM context_gaps_v WHERE room_id = ?1")
				.all(roomId) as { readonly description: string }[];

			expect(currentIssueState).toEqual({
				room_id: roomId,
				issue_id: "issue-1",
				current_state: "closure_proposed",
			});
			expect(riskProposals).toEqual([{ issue_id: "issue-1" }]);
			expect(openIssues).toEqual([{ issue_id: "issue-1" }]);
			expect(contextGaps).toEqual([{ description: "Need API schema" }]);
		} finally {
			closeDatabase(db);
			rmSync(dir, { force: true, recursive: true });
		}
	});
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
	type LedgerEntryRecord,
	type QueryResponseArtifactRecord,
	type TurnTraceRecord,
	type WorkflowEventRecord,
	type WorkflowSnapshotRecord,
	appendLedgerEntries,
	appendQueryResponseArtifact,
	appendTurnTrace,
	appendWorkflowEvents,
	closeDatabase,
	openDatabase,
	readLatestSnapshot,
	readLedgerEntries,
	readQueryResponseArtifacts,
	readTurnTraces,
	readWorkflowEvents,
	runMigrations,
	withTransaction,
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

describe("storage", () => {
	it("runs migrations on a fresh database and creates all tables and views", () => {
		const { dir, path } = createTempDatabasePath();
		const db = openDatabase(path);

		try {
			runMigrations(db);

			const objects = db
				.query<{ readonly name: string; readonly type: string }, []>(
					"SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view')",
				)
				.all();
			const names = objects.map((row) => row.name).sort();

			expect(names).toEqual(
				expect.arrayContaining([
					"current_issue_state_v",
					"ledger_entries",
					"open_issues_v",
					"query_response_artifacts",
					"risk_proposals_v",
					"turn_traces",
					"workflow_events",
					"workflow_snapshots",
					"context_gaps_v",
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
					throw new TestTransactionError();
				}),
			).toThrow(TestTransactionError);

			expect(readLedgerEntries(db, roomId)).toEqual([]);
			expect(readTurnTraces(db, roomId)).toEqual([]);
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
				.query<
					{
						readonly room_id: string;
						readonly issue_id: string;
						readonly current_state: string;
					},
					[]
				>("SELECT room_id, issue_id, current_state FROM current_issue_state_v WHERE room_id = ?1")
				.get(roomId);
			const riskProposals = db
				.query<{ readonly issue_id: string }, []>(
					"SELECT issue_id FROM risk_proposals_v WHERE room_id = ?1",
				)
				.all(roomId);
			const openIssues = db
				.query<{ readonly issue_id: string }, []>(
					"SELECT issue_id FROM open_issues_v WHERE room_id = ?1",
				)
				.all(roomId);
			const contextGaps = db
				.query<{ readonly description: string }, []>(
					"SELECT description FROM context_gaps_v WHERE room_id = ?1",
				)
				.all(roomId);

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

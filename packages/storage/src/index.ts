import { Database } from "bun:sqlite";

export type DatabaseHandle = Database;

export interface WorkflowEventRecord {
	readonly taskId: string;
	readonly seq: number;
	readonly eventType: string;
	readonly payloadJson: string;
	readonly createdAtMs: number;
}

export interface PersistableWorkflowEvent {
	readonly eventType: string;
	readonly payloadJson: string;
	readonly createdAtMs: number;
}

export interface WorkflowSnapshotRecord {
	readonly taskId: string;
	readonly eventSeq: number;
	readonly snapshotJson: string;
	readonly createdAtMs: number;
}

export interface LedgerEntryRecord {
	readonly roomId: string;
	readonly seq: number;
	readonly turnId: string;
	readonly agentId: string;
	readonly entryType: string;
	readonly issueId: string | null;
	readonly payloadJson: string;
	readonly createdAtMs: number;
}

export interface TurnTraceRecord {
	readonly roomId: string;
	readonly turnId: string;
	readonly agentId: string;
	readonly promptJson: string;
	readonly rawResponseJson: string;
	readonly parseStatus: string;
	readonly normalizedTurnJson: string | null;
	readonly validationErrorsJson: string | null;
	readonly usageJson: string | null;
	readonly timingJson: string;
	readonly createdAtMs: number;
}

export interface QueryResponseArtifactRecord {
	readonly artifactId: string;
	readonly sourceRoomId: string;
	readonly sourceRoomRevision: number;
	readonly synthesisRoomId: string;
	readonly question: string;
	readonly payloadJson: string;
	readonly createdAtMs: number;
}

export interface RoomArtifactRecord {
	readonly roomId: string;
	readonly artifactKind: string;
	readonly content: string;
	readonly pathHint: string | null;
	readonly createdAtMs: number;
}

export interface ReviewPacketRecord {
	readonly taskId: string;
	readonly version: number;
	readonly packetJson: string;
	readonly createdAtMs: number;
}

export interface TaskIndexRecord {
	readonly taskId: string;
	readonly externalState: string;
	readonly internalPhase: string;
	readonly prompt: string;
	readonly latestEventSeq: number;
	readonly createdAtMs: number;
	readonly updatedAtMs: number;
}

const MIGRATIONS_SQL = [
	`CREATE TABLE IF NOT EXISTS workflow_events (
		task_id TEXT NOT NULL,
		seq INTEGER NOT NULL,
		event_type TEXT NOT NULL,
		payload_json TEXT NOT NULL,
		created_at_ms INTEGER NOT NULL,
		PRIMARY KEY (task_id, seq)
	);`,
	`CREATE TABLE IF NOT EXISTS workflow_snapshots (
		task_id TEXT NOT NULL,
		event_seq INTEGER NOT NULL,
		snapshot_json TEXT NOT NULL,
		created_at_ms INTEGER NOT NULL,
		PRIMARY KEY (task_id, event_seq)
	);`,
	`CREATE TABLE IF NOT EXISTS ledger_entries (
		room_id TEXT NOT NULL,
		seq INTEGER NOT NULL,
		turn_id TEXT NOT NULL,
		agent_id TEXT NOT NULL,
		entry_type TEXT NOT NULL,
		issue_id TEXT,
		payload_json TEXT NOT NULL,
		created_at_ms INTEGER NOT NULL,
		PRIMARY KEY (room_id, seq)
	);`,
	`CREATE TABLE IF NOT EXISTS turn_traces (
		room_id TEXT NOT NULL,
		turn_id TEXT NOT NULL,
		agent_id TEXT NOT NULL,
		prompt_json TEXT NOT NULL,
		raw_response_json TEXT NOT NULL,
		parse_status TEXT NOT NULL,
		normalized_turn_json TEXT,
		validation_errors_json TEXT,
		usage_json TEXT,
		timing_json TEXT NOT NULL,
		created_at_ms INTEGER NOT NULL,
		PRIMARY KEY (room_id, turn_id)
	);`,
	`CREATE TABLE IF NOT EXISTS query_response_artifacts (
		artifact_id TEXT NOT NULL PRIMARY KEY,
		source_room_id TEXT NOT NULL,
		source_room_revision INTEGER NOT NULL,
		synthesis_room_id TEXT NOT NULL,
		question TEXT NOT NULL,
		payload_json TEXT NOT NULL,
		created_at_ms INTEGER NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS room_artifacts (
		room_id TEXT NOT NULL PRIMARY KEY,
		artifact_kind TEXT NOT NULL,
		content TEXT NOT NULL,
		path_hint TEXT,
		created_at_ms INTEGER NOT NULL
	);`,
	`CREATE TABLE IF NOT EXISTS review_packets (
		task_id TEXT NOT NULL,
		version INTEGER NOT NULL,
		packet_json TEXT NOT NULL,
		created_at_ms INTEGER NOT NULL,
		PRIMARY KEY (task_id, version)
	);`,
	`CREATE TABLE IF NOT EXISTS tasks (
		task_id TEXT NOT NULL PRIMARY KEY,
		external_state TEXT NOT NULL,
		internal_phase TEXT NOT NULL,
		prompt TEXT NOT NULL,
		latest_event_seq INTEGER NOT NULL,
		created_at_ms INTEGER NOT NULL,
		updated_at_ms INTEGER NOT NULL
	);`,
	"DROP VIEW IF EXISTS current_issue_state_v;",
	"DROP VIEW IF EXISTS open_issues_v;",
	"DROP VIEW IF EXISTS risk_proposals_v;",
	"DROP VIEW IF EXISTS context_gaps_v;",
	`CREATE VIEW IF NOT EXISTS current_issue_state_v AS
		WITH ranked_issue_state AS (
			SELECT
				room_id,
				issue_id,
				seq,
				CASE
					WHEN entry_type = 'create_issue' THEN 'open'
					WHEN entry_type = 'challenge' THEN 'challenged'
					WHEN entry_type = 'propose_resolution' THEN 'proposed_resolution'
					WHEN entry_type = 'propose_closure' THEN 'closure_proposed'
					WHEN entry_type = 'reopen_issue' THEN 'open'
					WHEN entry_type IN ('resolved', 'deferred', 'risk_proposed') THEN entry_type
					ELSE NULL
				END AS current_state,
				ROW_NUMBER() OVER (PARTITION BY room_id, issue_id ORDER BY seq DESC) AS state_rank
			FROM ledger_entries
			WHERE issue_id IS NOT NULL
				AND entry_type IN ('create_issue', 'challenge', 'propose_resolution', 'propose_closure', 'reopen_issue', 'resolved', 'deferred', 'risk_proposed')
		),
		issue_details AS (
			SELECT
				room_id,
				json_extract(payload_json, '$.action.issueId') AS issue_id,
				json_extract(payload_json, '$.action.title') AS title,
				json_extract(payload_json, '$.action.description') AS description
			FROM ledger_entries
			WHERE entry_type = 'create_issue'
		)
		SELECT
			ranked_issue_state.room_id,
			ranked_issue_state.issue_id,
			issue_details.title,
			issue_details.description,
			ranked_issue_state.current_state,
			ranked_issue_state.seq AS last_seq
		FROM ranked_issue_state
		LEFT JOIN issue_details
			ON issue_details.room_id = ranked_issue_state.room_id
			AND issue_details.issue_id = ranked_issue_state.issue_id
		WHERE ranked_issue_state.state_rank = 1;`,
	`CREATE VIEW IF NOT EXISTS open_issues_v AS
		SELECT room_id, issue_id, title, description, current_state, last_seq
		FROM current_issue_state_v
		WHERE current_state IN ('open', 'challenged', 'proposed_resolution', 'closure_proposed');`,
	`CREATE VIEW IF NOT EXISTS risk_proposals_v AS
		SELECT room_id, issue_id, title, description, current_state, last_seq
		FROM current_issue_state_v
		WHERE current_state = 'risk_proposed'
		UNION
		SELECT room_id, issue_id, title, description, 'risk_proposed' AS current_state, last_seq
		FROM current_issue_state_v
		JOIN ledger_entries
			USING (room_id, issue_id)
		WHERE current_issue_state_v.current_state = 'closure_proposed'
			AND ledger_entries.seq = current_issue_state_v.last_seq
			AND ledger_entries.entry_type = 'propose_closure'
			AND json_extract(ledger_entries.payload_json, '$.action.closureType') = 'risk_proposed';`,
	`CREATE VIEW IF NOT EXISTS context_gaps_v AS
		SELECT
			room_id,
			seq,
			json_extract(payload_json, '$.action.description') AS description,
			json_extract(payload_json, '$.action.justification') AS justification,
			created_at_ms
		FROM ledger_entries
		WHERE entry_type = 'request_context';`,
] as const;

class StorageRecordMismatchError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StorageRecordMismatchError";
	}
}

export function openDatabase(path: string): Database {
	return new Database(path);
}

export function runMigrations(db: Database): void {
	for (const statement of MIGRATIONS_SQL) {
		db.exec(statement);
	}
}

export function closeDatabase(db: Database): void {
	db.close();
}

export function withTransaction<T>(db: Database, fn: () => T): T {
	db.exec("BEGIN TRANSACTION");
	try {
		const result = fn();
		db.exec("COMMIT");
		return result;
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

export const withWriteTransaction = withTransaction;

export function appendWorkflowEvents(
	db: Database,
	taskId: string,
	events: readonly WorkflowEventRecord[],
): void {
	if (events.length === 0) {
		return;
	}

	const statement = db.prepare(
		"INSERT INTO workflow_events (task_id, seq, event_type, payload_json, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
	);
	for (const event of events) {
		assertMatches(taskId, event.taskId, "taskId");
		statement.run(event.taskId, event.seq, event.eventType, event.payloadJson, event.createdAtMs);
	}
}

export function appendWorkflowEventsAutoSeq(
	db: Database,
	taskId: string,
	events: readonly PersistableWorkflowEvent[],
): readonly WorkflowEventRecord[] {
	if (events.length === 0) {
		return [];
	}

	const row = db
		.query("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM workflow_events WHERE task_id = ?1")
		.get(taskId) as Record<string, unknown> | null;
	const baseSeq = (row?.max_seq as number | undefined) ?? 0;
	const persistedEvents = events.map((event, index) => ({
		taskId,
		seq: baseSeq + index + 1,
		eventType: event.eventType,
		payloadJson: event.payloadJson,
		createdAtMs: event.createdAtMs,
	}));

	appendWorkflowEvents(db, taskId, persistedEvents);
	return persistedEvents;
}

export function readWorkflowEvents(
	db: Database,
	taskId: string,
	afterSeq?: number,
): readonly WorkflowEventRecord[] {
	if (typeof afterSeq === "number") {
		return mapWorkflowEventRows(
			db
				.query(
					"SELECT task_id, seq, event_type, payload_json, created_at_ms FROM workflow_events WHERE task_id = ?1 AND seq > ?2 ORDER BY seq ASC",
				)
				.all(taskId, afterSeq),
		);
	}

	return mapWorkflowEventRows(
		db
			.query(
				"SELECT task_id, seq, event_type, payload_json, created_at_ms FROM workflow_events WHERE task_id = ?1 ORDER BY seq ASC",
			)
			.all(taskId),
	);
}

export function writeSnapshot(
	db: Database,
	taskId: string,
	snapshot: WorkflowSnapshotRecord,
): void {
	assertMatches(taskId, snapshot.taskId, "taskId");
	db.prepare(
		"INSERT INTO workflow_snapshots (task_id, event_seq, snapshot_json, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
	).run(snapshot.taskId, snapshot.eventSeq, snapshot.snapshotJson, snapshot.createdAtMs);
}

export function readLatestSnapshot(db: Database, taskId: string): WorkflowSnapshotRecord | null {
	const row = db
		.query(
			"SELECT task_id, event_seq, snapshot_json, created_at_ms FROM workflow_snapshots WHERE task_id = ?1 ORDER BY event_seq DESC LIMIT 1",
		)
		.get(taskId);

	if (!row) {
		return null;
	}

	return mapWorkflowSnapshotRow(row as Record<string, unknown>);
}

export function appendLedgerEntries(
	db: Database,
	roomId: string,
	entries: readonly LedgerEntryRecord[],
): void {
	if (entries.length === 0) {
		return;
	}

	const statement = db.prepare(
		"INSERT INTO ledger_entries (room_id, seq, turn_id, agent_id, entry_type, issue_id, payload_json, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
	);
	for (const entry of entries) {
		assertMatches(roomId, entry.roomId, "roomId");
		statement.run(
			entry.roomId,
			entry.seq,
			entry.turnId,
			entry.agentId,
			entry.entryType,
			entry.issueId,
			entry.payloadJson,
			entry.createdAtMs,
		);
	}
}

export function readLedgerEntries(db: Database, roomId: string): readonly LedgerEntryRecord[] {
	return mapLedgerEntryRows(
		db
			.query(
				"SELECT room_id, seq, turn_id, agent_id, entry_type, issue_id, payload_json, created_at_ms FROM ledger_entries WHERE room_id = ?1 ORDER BY seq ASC",
			)
			.all(roomId),
	);
}

export function appendTurnTrace(db: Database, roomId: string, trace: TurnTraceRecord): void {
	assertMatches(roomId, trace.roomId, "roomId");
	db.prepare(
		"INSERT INTO turn_traces (room_id, turn_id, agent_id, prompt_json, raw_response_json, parse_status, normalized_turn_json, validation_errors_json, usage_json, timing_json, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
	).run(
		trace.roomId,
		trace.turnId,
		trace.agentId,
		trace.promptJson,
		trace.rawResponseJson,
		trace.parseStatus,
		trace.normalizedTurnJson,
		trace.validationErrorsJson,
		trace.usageJson,
		trace.timingJson,
		trace.createdAtMs,
	);
}

export function readTurnTraces(db: Database, roomId: string): readonly TurnTraceRecord[] {
	return mapTurnTraceRows(
		db
			.query(
				"SELECT room_id, turn_id, agent_id, prompt_json, raw_response_json, parse_status, normalized_turn_json, validation_errors_json, usage_json, timing_json, created_at_ms FROM turn_traces WHERE room_id = ?1 ORDER BY created_at_ms ASC, turn_id ASC",
			)
			.all(roomId),
	);
}

export function appendQueryResponseArtifact(
	db: Database,
	artifact: QueryResponseArtifactRecord,
): void {
	db.prepare(
		"INSERT INTO query_response_artifacts (artifact_id, source_room_id, source_room_revision, synthesis_room_id, question, payload_json, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
	).run(
		artifact.artifactId,
		artifact.sourceRoomId,
		artifact.sourceRoomRevision,
		artifact.synthesisRoomId,
		artifact.question,
		artifact.payloadJson,
		artifact.createdAtMs,
	);
}

export function readQueryResponseArtifacts(
	db: Database,
	roomId: string,
): readonly QueryResponseArtifactRecord[] {
	return mapQueryArtifactRows(
		db
			.query(
				"SELECT artifact_id, source_room_id, source_room_revision, synthesis_room_id, question, payload_json, created_at_ms FROM query_response_artifacts WHERE source_room_id = ?1 OR synthesis_room_id = ?1 ORDER BY created_at_ms ASC, artifact_id ASC",
			)
			.all(roomId),
	);
}

export function appendRoomArtifact(db: Database, artifact: RoomArtifactRecord): void {
	db.prepare(
		"INSERT INTO room_artifacts (room_id, artifact_kind, content, path_hint, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
	).run(
		artifact.roomId,
		artifact.artifactKind,
		artifact.content,
		artifact.pathHint,
		artifact.createdAtMs,
	);
}

export function readRoomArtifact(db: Database, roomId: string): RoomArtifactRecord | null {
	const row = db
		.query(
			"SELECT room_id, artifact_kind, content, path_hint, created_at_ms FROM room_artifacts WHERE room_id = ?1",
		)
		.get(roomId);

	if (!row) {
		return null;
	}

	return mapRoomArtifactRow(row as Record<string, unknown>);
}

export function writeReviewPacket(db: Database, packet: ReviewPacketRecord): void {
	db.prepare(
		"INSERT INTO review_packets (task_id, version, packet_json, created_at_ms) VALUES (?1, ?2, ?3, ?4)",
	).run(packet.taskId, packet.version, packet.packetJson, packet.createdAtMs);
}

export function readReviewPacket(
	db: Database,
	taskId: string,
	version: number,
): ReviewPacketRecord | null {
	const row = db
		.query(
			"SELECT task_id, version, packet_json, created_at_ms FROM review_packets WHERE task_id = ?1 AND version = ?2",
		)
		.get(taskId, version);

	if (!row) {
		return null;
	}

	return mapReviewPacketRow(row as Record<string, unknown>);
}

export function readLatestReviewPacket(db: Database, taskId: string): ReviewPacketRecord | null {
	const row = db
		.query(
			"SELECT task_id, version, packet_json, created_at_ms FROM review_packets WHERE task_id = ?1 ORDER BY version DESC LIMIT 1",
		)
		.get(taskId);

	if (!row) {
		return null;
	}

	return mapReviewPacketRow(row as Record<string, unknown>);
}

export function upsertTaskIndex(db: Database, task: TaskIndexRecord): void {
	db.prepare(
		"INSERT INTO tasks (task_id, external_state, internal_phase, prompt, latest_event_seq, created_at_ms, updated_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(task_id) DO UPDATE SET external_state = excluded.external_state, internal_phase = excluded.internal_phase, prompt = excluded.prompt, latest_event_seq = excluded.latest_event_seq, created_at_ms = excluded.created_at_ms, updated_at_ms = excluded.updated_at_ms",
	).run(
		task.taskId,
		task.externalState,
		task.internalPhase,
		task.prompt,
		task.latestEventSeq,
		task.createdAtMs,
		task.updatedAtMs,
	);
}

export function readTaskIndex(db: Database, taskId: string): TaskIndexRecord | null {
	const row = db
		.query(
			"SELECT task_id, external_state, internal_phase, prompt, latest_event_seq, created_at_ms, updated_at_ms FROM tasks WHERE task_id = ?1",
		)
		.get(taskId);

	if (!row) {
		return null;
	}

	return mapTaskIndexRow(row as Record<string, unknown>);
}

export function listRecoverableTasks(db: Database): readonly TaskIndexRecord[] {
	return mapTaskIndexRows(
		db
			.query(
				"SELECT task_id, external_state, internal_phase, prompt, latest_event_seq, created_at_ms, updated_at_ms FROM tasks WHERE external_state NOT IN ('approved', 'cancelled', 'failed') ORDER BY task_id ASC",
			)
			.all(),
	);
}

function assertMatches(expected: string, actual: string, fieldName: string): void {
	if (expected !== actual) {
		throw new StorageRecordMismatchError(
			`${fieldName} mismatch: expected ${expected}, received ${actual}`,
		);
	}
}

function mapWorkflowEventRows(rows: unknown[]): readonly WorkflowEventRecord[] {
	return rows.map((row) => mapWorkflowEventRow(row as Record<string, unknown>));
}

function mapWorkflowEventRow(row: Record<string, unknown>): WorkflowEventRecord {
	return {
		taskId: row.task_id as string,
		seq: row.seq as number,
		eventType: row.event_type as string,
		payloadJson: row.payload_json as string,
		createdAtMs: row.created_at_ms as number,
	};
}

function mapWorkflowSnapshotRow(row: Record<string, unknown>): WorkflowSnapshotRecord {
	return {
		taskId: row.task_id as string,
		eventSeq: row.event_seq as number,
		snapshotJson: row.snapshot_json as string,
		createdAtMs: row.created_at_ms as number,
	};
}

function mapLedgerEntryRows(rows: unknown[]): readonly LedgerEntryRecord[] {
	return rows.map((row) => {
		const record = row as Record<string, unknown>;
		return {
			roomId: record.room_id as string,
			seq: record.seq as number,
			turnId: record.turn_id as string,
			agentId: record.agent_id as string,
			entryType: record.entry_type as string,
			issueId: (record.issue_id as string | null) ?? null,
			payloadJson: record.payload_json as string,
			createdAtMs: record.created_at_ms as number,
		};
	});
}

function mapTurnTraceRows(rows: unknown[]): readonly TurnTraceRecord[] {
	return rows.map((row) => {
		const record = row as Record<string, unknown>;
		return {
			roomId: record.room_id as string,
			turnId: record.turn_id as string,
			agentId: record.agent_id as string,
			promptJson: record.prompt_json as string,
			rawResponseJson: record.raw_response_json as string,
			parseStatus: record.parse_status as string,
			normalizedTurnJson: (record.normalized_turn_json as string | null) ?? null,
			validationErrorsJson: (record.validation_errors_json as string | null) ?? null,
			usageJson: (record.usage_json as string | null) ?? null,
			timingJson: record.timing_json as string,
			createdAtMs: record.created_at_ms as number,
		};
	});
}

function mapQueryArtifactRows(rows: unknown[]): readonly QueryResponseArtifactRecord[] {
	return rows.map((row) => {
		const record = row as Record<string, unknown>;
		return {
			artifactId: record.artifact_id as string,
			sourceRoomId: record.source_room_id as string,
			sourceRoomRevision: record.source_room_revision as number,
			synthesisRoomId: record.synthesis_room_id as string,
			question: record.question as string,
			payloadJson: record.payload_json as string,
			createdAtMs: record.created_at_ms as number,
		};
	});
}

function mapRoomArtifactRow(row: Record<string, unknown>): RoomArtifactRecord {
	return {
		roomId: row.room_id as string,
		artifactKind: row.artifact_kind as string,
		content: row.content as string,
		pathHint: (row.path_hint as string | null) ?? null,
		createdAtMs: row.created_at_ms as number,
	};
}

function mapReviewPacketRow(row: Record<string, unknown>): ReviewPacketRecord {
	return {
		taskId: row.task_id as string,
		version: row.version as number,
		packetJson: row.packet_json as string,
		createdAtMs: row.created_at_ms as number,
	};
}

function mapTaskIndexRows(rows: unknown[]): readonly TaskIndexRecord[] {
	return rows.map((row) => mapTaskIndexRow(row as Record<string, unknown>));
}

function mapTaskIndexRow(row: Record<string, unknown>): TaskIndexRecord {
	return {
		taskId: row.task_id as string,
		externalState: row.external_state as string,
		internalPhase: row.internal_phase as string,
		prompt: row.prompt as string,
		latestEventSeq: row.latest_event_seq as number,
		createdAtMs: row.created_at_ms as number,
		updatedAtMs: row.updated_at_ms as number,
	};
}

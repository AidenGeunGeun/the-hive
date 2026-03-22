import type { WorkflowState } from "@the-hive/protocol/engine";
import type {
	RoomSummaryView,
	TaskFailureCode,
	TaskSnapshotView,
	WireEvent,
} from "@the-hive/protocol/wire";
import { readReviewPacket, readWorkflowEvents } from "@the-hive/storage";

import type { DatabaseHandle } from "@the-hive/storage";

import type { WorkflowCommit } from "./authority";

const FAILURE_CODES: ReadonlySet<string> = new Set<TaskFailureCode>([
	"context_build_failed",
	"room_failed",
	"render_failed",
	"max_iterations_exceeded",
	"internal_error",
]);

class ProjectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProjectionError";
	}
}

export interface WireProjector {
	projectCommit(commit: WorkflowCommit): Promise<readonly WireEvent[]>;
	buildTaskSnapshot(taskId: string, state: WorkflowState): Promise<TaskSnapshotView>;
}

function asTaskFailureCode(errorCode: string): TaskFailureCode {
	return FAILURE_CODES.has(errorCode as TaskFailureCode)
		? (errorCode as TaskFailureCode)
		: "internal_error";
}

function parseStoredWorkflowEvent(
	payloadJson: string,
	eventType: string,
): {
	readonly kind: string;
	readonly roomId?: string;
	readonly roomKind?: RoomSummaryView["roomKind"];
	readonly outcome?: RoomSummaryView["outcome"] | "failed";
	readonly timestamp: number;
} {
	const event = JSON.parse(payloadJson) as {
		readonly kind?: string;
		readonly roomId?: string;
		readonly roomKind?: RoomSummaryView["roomKind"];
		readonly outcome?: RoomSummaryView["outcome"] | "failed";
		readonly timestamp?: number;
	};
	if (event.kind !== eventType || typeof event.timestamp !== "number") {
		throw new ProjectionError(`Invalid stored workflow event ${eventType}`);
	}

	return {
		kind: event.kind,
		...(typeof event.roomId === "string" ? { roomId: event.roomId } : {}),
		...(event.roomKind ? { roomKind: event.roomKind } : {}),
		...(event.outcome ? { outcome: event.outcome } : {}),
		timestamp: event.timestamp,
	};
}

function buildRoomSummaries(db: DatabaseHandle, taskId: string): readonly RoomSummaryView[] {
	const summaries = new Map<string, RoomSummaryView>();
	for (const record of readWorkflowEvents(db, taskId)) {
		const event = parseStoredWorkflowEvent(record.payloadJson, record.eventType);
		if (!event.roomId) {
			continue;
		}

		switch (event.kind) {
			case "room_started":
				if (!event.roomKind) {
					break;
				}
				summaries.set(event.roomId, {
					roomId: event.roomId,
					roomKind: event.roomKind,
					outcome: "running",
					startedAtMs: event.timestamp,
				});
				break;
			case "room_completed": {
				const current = summaries.get(event.roomId);
				if (!current || !event.roomKind || !event.outcome) {
					break;
				}
				summaries.set(event.roomId, {
					...current,
					outcome: event.outcome === "failed" ? "failed" : event.outcome,
					completedAtMs: event.timestamp,
				});
				break;
			}
			case "room_failed": {
				const current = summaries.get(event.roomId);
				summaries.set(event.roomId, {
					roomId: event.roomId,
					roomKind: current?.roomKind ?? "domain",
					outcome: "failed",
					startedAtMs: current?.startedAtMs ?? event.timestamp,
					completedAtMs: event.timestamp,
				});
				break;
			}
		}
	}

	return [...summaries.values()].sort((left, right) => left.startedAtMs - right.startedAtMs);
}

export function createWireProjector(db: DatabaseHandle): WireProjector {
	return {
		async projectCommit(commit: WorkflowCommit): Promise<readonly WireEvent[]> {
			const events: WireEvent[] = [];
			if (commit.prevState.externalState !== commit.nextState.externalState) {
				const changedAtMs = commit.events.at(-1)?.event.timestamp ?? commit.nextState.updatedAtMs;
				events.push({
					kind: "task_state_changed",
					taskId: commit.taskId,
					fromState: commit.prevState.externalState,
					toState: commit.nextState.externalState,
					changedAtMs,
				});
			}

			for (const persistedEvent of commit.events) {
				const event = persistedEvent.event;
				switch (event.kind) {
					case "room_started":
						events.push({
							kind: "room_started",
							taskId: commit.taskId,
							roomId: event.roomId,
							roomKind: event.roomKind,
							agentIds: event.agentIds,
							startedAtMs: event.timestamp,
						});
						break;
					case "room_completed":
						events.push({
							kind: "room_completed",
							taskId: commit.taskId,
							roomId: event.roomId,
							roomKind: event.roomKind,
							outcome: event.outcome === "failed" ? "inconclusive" : event.outcome,
							completedAtMs: event.timestamp,
						});
						break;
					case "task_review_ready": {
						const packetRecord = readReviewPacket(db, commit.taskId, event.version);
						if (!packetRecord) {
							throw new ProjectionError(
								`Missing review packet for task ${commit.taskId} version ${event.version}`,
							);
						}

						events.push({
							kind: "task_review_ready",
							taskId: commit.taskId,
							reviewPacket: JSON.parse(packetRecord.packetJson),
							readyAtMs: event.timestamp,
						});
						break;
					}
					case "task_failed":
						events.push({
							kind: "task_failed",
							taskId: commit.taskId,
							errorCode: asTaskFailureCode(event.errorCode),
							message: event.message,
							failedAtMs: event.timestamp,
						});
						break;
					case "task_cancelled":
						events.push({
							kind: "task_cancelled",
							taskId: commit.taskId,
							cancelledAtMs: event.timestamp,
						});
						break;
					case "task_submitted":
					case "task_started":
					case "context_bundle_built":
					case "room_job_enqueued":
					case "room_failed":
					case "query_room_requested":
					case "query_response_recorded":
					case "review_packet_rendered":
					case "task_approved":
					case "task_rejected":
						break;
				}
			}

			return events;
		},

		async buildTaskSnapshot(taskId: string, state: WorkflowState): Promise<TaskSnapshotView> {
			return {
				taskId: state.taskId,
				state: state.externalState,
				prompt: state.submission?.prompt ?? "",
				currentPhase: state.internalPhase,
				roomSummaries: buildRoomSummaries(db, taskId),
				createdAtMs: state.createdAtMs,
				updatedAtMs: state.updatedAtMs,
			};
		},
	};
}

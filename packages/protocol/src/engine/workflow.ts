import type { RoomId, TaskId } from "./ids";

export type ExternalTaskState =
	| "submitted"
	| "running"
	| "awaiting_review"
	| "approved"
	| "rejected"
	| "failed"
	| "cancelled";

export type InternalPhase =
	| "pending"
	| "building_context"
	| "mini_rooms"
	| "synthesis"
	| "query_back"
	| "rendering"
	| "awaiting_review"
	| "rerun";

export type JobKind =
	| "build_context_bundle"
	| "run_domain_room"
	| "run_synthesis_room"
	| "run_query_back_room"
	| "render_review_packet";

export interface PendingJob {
	readonly jobId: string;
	readonly taskId: TaskId;
	readonly kind: JobKind;
	readonly payload: unknown;
	readonly dedupeKey: string;
}

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
	readonly submission?: WorkflowSubmission;
}

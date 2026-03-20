import type { WireErrorCode } from "./errors";
import type { ProtocolVersion } from "./version";
import type { ExternalTaskState, ReviewPacketView, RoomKindView } from "./views";

export interface TaskStateChangedEvent {
	readonly kind: "task_state_changed";
	readonly taskId: string;
	readonly fromState: ExternalTaskState;
	readonly toState: ExternalTaskState;
	readonly changedAtMs: number;
}

export interface RoomStartedEvent {
	readonly kind: "room_started";
	readonly taskId: string;
	readonly roomId: string;
	readonly roomKind: RoomKindView;
	readonly agentIds: readonly string[];
	readonly startedAtMs: number;
}

export interface RoomCompletedEvent {
	readonly kind: "room_completed";
	readonly taskId: string;
	readonly roomId: string;
	readonly roomKind: RoomKindView;
	readonly completedAtMs: number;
}

export interface TaskReviewReadyEvent {
	readonly kind: "task_review_ready";
	readonly taskId: string;
	readonly reviewPacket: ReviewPacketView;
	readonly readyAtMs: number;
}

export interface TaskFailedEvent {
	readonly kind: "task_failed";
	readonly taskId: string;
	readonly errorCode: WireErrorCode;
	readonly message: string;
	readonly failedAtMs: number;
}

export interface TaskCancelledEvent {
	readonly kind: "task_cancelled";
	readonly taskId: string;
	readonly cancelledAtMs: number;
}

export type WireEvent =
	| TaskStateChangedEvent
	| RoomStartedEvent
	| RoomCompletedEvent
	| TaskReviewReadyEvent
	| TaskFailedEvent
	| TaskCancelledEvent;

export interface WireEventEnvelope {
	readonly protocolVersion: ProtocolVersion;
	readonly event: WireEvent;
}

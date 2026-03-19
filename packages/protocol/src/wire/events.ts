import type { TaskExternalState } from "./task.js";

export interface TaskStateChangedEvent {
	readonly type: "task_state_changed";
	readonly taskId: string;
	readonly previousState: TaskExternalState;
	readonly newState: TaskExternalState;
	readonly timestamp: number;
}

export interface RoomStartedEvent {
	readonly type: "room_started";
	readonly taskId: string;
	readonly roomId: string;
	readonly domain: string;
	readonly agentCount: number;
	readonly timestamp: number;
}

export interface RoomCompletedEvent {
	readonly type: "room_completed";
	readonly taskId: string;
	readonly roomId: string;
	readonly conclusive: boolean;
	readonly issueCount: number;
	readonly resolvedCount: number;
	readonly timestamp: number;
}

export interface ReviewReadyEvent {
	readonly type: "review_ready";
	readonly taskId: string;
	readonly timestamp: number;
}

export type Event =
	| TaskStateChangedEvent
	| RoomStartedEvent
	| RoomCompletedEvent
	| ReviewReadyEvent;

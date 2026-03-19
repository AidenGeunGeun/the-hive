export type ErrorCode =
	| "TASK_NOT_FOUND"
	| "INVALID_STATE_TRANSITION"
	| "MAX_ITERATIONS_EXCEEDED"
	| "ROOM_HEALTH_FAILURE"
	| "PROVIDER_ERROR"
	| "INTERNAL_ERROR";

export interface ProtocolError {
	readonly code: ErrorCode;
	readonly message: string;
	readonly taskId?: string;
	readonly roomId?: string;
}

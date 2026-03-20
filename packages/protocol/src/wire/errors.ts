export type WireErrorCode =
	| "UNKNOWN_COMMAND"
	| "INVALID_PAYLOAD"
	| "TASK_NOT_FOUND"
	| "INVALID_STATE_TRANSITION"
	| "PROTOCOL_VERSION_MISMATCH";

export interface WireError {
	readonly code: WireErrorCode;
	readonly message: string;
	readonly details?: unknown;
}

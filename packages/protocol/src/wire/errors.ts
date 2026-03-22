import type { WireEventEnvelope } from "./events";
import type { ProtocolVersion } from "./version";

export type WireErrorCode =
	| "UNKNOWN_COMMAND"
	| "INVALID_PAYLOAD"
	| "TASK_NOT_FOUND"
	| "INVALID_STATE_TRANSITION"
	| "PROTOCOL_VERSION_MISMATCH";

export type TaskFailureCode =
	| "context_build_failed"
	| "room_failed"
	| "render_failed"
	| "max_iterations_exceeded"
	| "internal_error";

export interface WireError {
	readonly code: WireErrorCode;
	readonly message: string;
	readonly details?: unknown;
}

export interface WireErrorEnvelope {
	readonly protocolVersion: ProtocolVersion;
	readonly commandId: string;
	readonly error: WireError;
}

export type WireServerMessage = WireEventEnvelope | WireErrorEnvelope;

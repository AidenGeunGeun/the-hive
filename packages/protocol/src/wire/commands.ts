import type { ProtocolVersion } from "./version";
import type { BundleInputRef } from "./views";

export interface SubmitTaskCommand {
	readonly kind: "submit_task";
	readonly commandId: string;
	readonly taskId: string;
	readonly prompt: string;
	readonly bundleInput: BundleInputRef;
	readonly requestedDomains?: readonly string[];
	readonly configProfile?: string;
	readonly submittedAtMs: number;
}

export interface ApproveTaskCommand {
	readonly kind: "approve_task";
	readonly commandId: string;
	readonly taskId: string;
	readonly submittedAtMs: number;
}

export interface RejectTaskCommand {
	readonly kind: "reject_task";
	readonly commandId: string;
	readonly taskId: string;
	readonly feedback: readonly string[];
	readonly submittedAtMs: number;
}

export interface CancelTaskCommand {
	readonly kind: "cancel_task";
	readonly commandId: string;
	readonly taskId: string;
	readonly submittedAtMs: number;
}

export interface SubscribeTaskCommand {
	readonly kind: "subscribe_task";
	readonly commandId: string;
	readonly taskId: string;
}

export interface GetTaskSnapshotCommand {
	readonly kind: "get_task_snapshot";
	readonly commandId: string;
	readonly taskId: string;
}

export type WireCommand =
	| SubmitTaskCommand
	| ApproveTaskCommand
	| RejectTaskCommand
	| CancelTaskCommand
	| SubscribeTaskCommand
	| GetTaskSnapshotCommand;

export interface WireCommandEnvelope {
	readonly protocolVersion: ProtocolVersion;
	readonly command: WireCommand;
}

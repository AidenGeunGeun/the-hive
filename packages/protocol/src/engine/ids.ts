import { randomUUID } from "node:crypto";

declare const taskIdBrand: unique symbol;
declare const roomIdBrand: unique symbol;
declare const agentIdBrand: unique symbol;
declare const issueIdBrand: unique symbol;
declare const turnIdBrand: unique symbol;
declare const queryResponseArtifactIdBrand: unique symbol;

export type TaskId = string & { readonly [taskIdBrand]: "TaskId" };
export type RoomId = string & { readonly [roomIdBrand]: "RoomId" };
export type AgentId = string & { readonly [agentIdBrand]: "AgentId" };
export type IssueId = string & { readonly [issueIdBrand]: "IssueId" };
export type TurnId = string & { readonly [turnIdBrand]: "TurnId" };
export type QueryResponseArtifactId = string & {
	readonly [queryResponseArtifactIdBrand]: "QueryResponseArtifactId";
};

function brandTaskId(value: string): TaskId {
	return value as TaskId;
}

function brandRoomId(value: string): RoomId {
	return value as RoomId;
}

function brandAgentId(value: string): AgentId {
	return value as AgentId;
}

function brandIssueId(value: string): IssueId {
	return value as IssueId;
}

function brandTurnId(value: string): TurnId {
	return value as TurnId;
}

function brandQueryResponseArtifactId(value: string): QueryResponseArtifactId {
	return value as QueryResponseArtifactId;
}

export function createTaskId(): TaskId {
	return brandTaskId(randomUUID());
}

export function createRoomId(): RoomId {
	return brandRoomId(randomUUID());
}

export function createAgentId(): AgentId {
	return brandAgentId(randomUUID());
}

export function createIssueId(): IssueId {
	return brandIssueId(randomUUID());
}

export function createTurnId(): TurnId {
	return brandTurnId(randomUUID());
}

export function createQueryResponseArtifactId(): QueryResponseArtifactId {
	return brandQueryResponseArtifactId(randomUUID());
}

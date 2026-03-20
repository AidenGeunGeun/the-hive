import type { AgentId, IssueId, RoomId, TurnId } from "./ids";
import type { LedgerAction } from "./ledger";
import type { RoomKind } from "./room";

export interface SubmitTurnPayload<K extends RoomKind = RoomKind> {
	readonly summary: string;
	readonly ledgerActions: readonly LedgerAction[];
	readonly controlActions: readonly AllowedRoomControlAction<K>[];
}

export interface ProposeRoomClosureAction {
	readonly kind: "propose_room_closure";
}

export interface QueryRoomAction {
	readonly kind: "query_room";
	readonly targetRoomId: RoomId;
	readonly question: string;
	readonly relevantIssueIds: readonly IssueId[];
}

export type RoomControlAction = ProposeRoomClosureAction | QueryRoomAction;
export type SynthesisRoomControlAction = RoomControlAction;
export type NonSynthesisRoomControlAction = ProposeRoomClosureAction;
export type AllowedRoomControlAction<K extends RoomKind> = K extends "synthesis"
	? SynthesisRoomControlAction
	: NonSynthesisRoomControlAction;

export interface ParsedTurn<K extends RoomKind = RoomKind> {
	readonly turnId: TurnId;
	readonly agentId: AgentId;
	readonly roundNumber: number;
	readonly payload: SubmitTurnPayload<K>;
	readonly timestamp: number;
}

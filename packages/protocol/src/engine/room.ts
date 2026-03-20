import type { AgentSpec } from "./agent";
import type { AgentId, RoomId, TurnId } from "./ids";
import type { LedgerEntry } from "./ledger";
import type { ParsedTurn } from "./turn";

export type RoomKind = "domain" | "synthesis" | "query_back";

export interface PolicySet {
	readonly turnPolicy: string;
	readonly stopPolicy: string;
	readonly memoryPolicy: string;
	readonly failurePolicy: string;
	readonly artifactPolicy: string;
}

export interface RoomSpec<K extends RoomKind = RoomKind> {
	readonly roomId: RoomId;
	readonly kind: K;
	readonly agentSpecs: readonly AgentSpec[];
	readonly maxRounds: number;
	readonly minHealthyAgents: number;
	readonly policies: PolicySet;
}

export type RoomRunOutcome = "completed" | "inconclusive" | "failed";

export interface RenderedArtifact {
	readonly kind: "report_markdown" | "review_packet_markdown" | "query_response_markdown";
	readonly content: string;
	readonly pathHint?: string;
}

export interface TurnTraceRecord<K extends RoomKind = RoomKind> {
	readonly turnId: TurnId;
	readonly agentId: AgentId;
	readonly roundNumber: number;
	readonly parsedTurn: ParsedTurn<K> | null;
	readonly rawResponse: unknown;
	readonly startedAtMs: number;
	readonly completedAtMs: number;
}

export interface RoomHealth {
	readonly totalAgents: number;
	readonly activeAgents: number;
	readonly failedAgents: number;
	readonly minHealthyAgents: number;
	readonly isHealthy: boolean;
}

export interface RoomRunResult<K extends RoomKind = RoomKind> {
	readonly roomId: RoomId;
	readonly kind: K;
	readonly outcome: RoomRunOutcome;
	readonly ledgerEntries: readonly LedgerEntry[];
	readonly turnTraces: readonly TurnTraceRecord<K>[];
	readonly renderedArtifact?: RenderedArtifact;
	readonly health: RoomHealth;
	readonly startedAtMs: number;
	readonly completedAtMs: number;
}

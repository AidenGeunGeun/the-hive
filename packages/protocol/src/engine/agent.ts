import type { ContextBundle } from "./context";
import type { AgentId, IssueId, TurnId } from "./ids";
import type { IssueState } from "./ledger";
import type { RoomKind } from "./room";
import type { ParsedTurn } from "./turn";

export interface ModelSelection {
	readonly providerId: string;
	readonly modelId: string;
	readonly alias?: string;
}

export interface AgentSpec {
	readonly agentId: AgentId;
	readonly persona: string;
	readonly modelSelection: ModelSelection;
	readonly systemPromptRef: string;
}

export interface LedgerSummaryItem {
	readonly issueId: IssueId;
	readonly title: string;
	readonly state: IssueState;
}

export interface UnresolvedIssueDetail {
	readonly issueId: IssueId;
	readonly title: string;
	readonly description: string;
	readonly state: IssueState;
	readonly recentEntries: readonly string[];
}

export interface ResolvedIssueSummary {
	readonly issueId: IssueId;
	readonly title: string;
	readonly state: Extract<IssueState, "resolved" | "deferred" | "risk_proposed">;
	readonly resolutionSummary: string;
}

export interface MemoryView {
	readonly systemPrompt: string;
	readonly contextBundle: ContextBundle;
	readonly ledgerSummary: readonly LedgerSummaryItem[];
	readonly unresolvedIssueDetails: readonly UnresolvedIssueDetail[];
	readonly resolvedIssueSummaries: readonly ResolvedIssueSummary[];
	readonly turnCounterMessage: string;
}

export interface AgentTurnInput {
	readonly turnId: TurnId;
	readonly roundNumber: number;
	readonly memoryView: MemoryView;
	readonly contextBundle: ContextBundle;
}

export interface TurnUsage {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly totalTokens?: number;
	readonly costUsd?: number;
}

export interface TurnTiming {
	readonly startedAtMs: number;
	readonly completedAtMs: number;
	readonly latencyMs: number;
}

export interface AgentTurnOutput<K extends RoomKind = RoomKind> {
	readonly turnId: TurnId;
	readonly agentId: AgentId;
	readonly parsedTurn: ParsedTurn<K> | null;
	readonly rawResponse: unknown;
	readonly usage?: TurnUsage;
	readonly timing: TurnTiming;
}

export interface Agent<K extends RoomKind = RoomKind> {
	readonly agentId: AgentId;
	readonly spec: AgentSpec;
	takeTurn(input: AgentTurnInput): Promise<AgentTurnOutput<K>>;
}

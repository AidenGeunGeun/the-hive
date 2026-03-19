import type { ActionType } from "./actions.js";

export type IssueStatus =
	| "open"
	| "challenged"
	| "proposed_resolution"
	| "closure_proposed"
	| "resolved"
	| "deferred"
	| "risk_proposed";

export type IssueRelation = "blocks" | "depends_on" | "duplicates";

export interface Issue {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly status: IssueStatus;
	readonly createdBy: string;
	readonly assumptions: readonly string[];
	readonly createdAt: number;
	readonly updatedAt: number;
}

export interface TurnAction {
	readonly type: ActionType;
	readonly targetIssueId?: string;
	readonly content: string;
	readonly evidence?: string;
	readonly closureType?: "resolved" | "deferred" | "risk_proposed";
	readonly relation?: IssueRelation;
	readonly sourceIssueId?: string;
	readonly rejectedAlternatives?: readonly string[];
}

export interface Turn {
	readonly agentId: string;
	readonly actions: readonly TurnAction[];
	readonly roundNumber: number;
	readonly timestamp: number;
}

export interface Ledger {
	readonly roomId: string;
	readonly issues: readonly Issue[];
	readonly turns: readonly Turn[];
	readonly startedAt: number;
	readonly completedAt?: number;
}

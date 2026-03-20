import type { AgentId, IssueId, TurnId } from "./ids";

export type IssueState =
	| "open"
	| "challenged"
	| "proposed_resolution"
	| "closure_proposed"
	| "resolved"
	| "deferred"
	| "risk_proposed";

export interface CreateIssueAction {
	readonly kind: "create_issue";
	readonly issueId: IssueId;
	readonly title: string;
	readonly description: string;
	readonly assumptions?: readonly string[];
}

export interface ChallengeAction {
	readonly kind: "challenge";
	readonly targetIssueId: IssueId;
	readonly argument: string;
	readonly evidence?: string;
}

export interface ProposeResolutionAction {
	readonly kind: "propose_resolution";
	readonly targetIssueId: IssueId;
	readonly proposal: string;
	readonly evidence?: string;
}

export type ClosureType = "resolved" | "deferred" | "risk_proposed";

export interface ProposeClosureAction {
	readonly kind: "propose_closure";
	readonly targetIssueId: IssueId;
	readonly rationale: string;
	readonly closureType: ClosureType;
}

export interface ReopenIssueAction {
	readonly kind: "reopen_issue";
	readonly targetIssueId: IssueId;
	readonly reason: string;
	readonly newEvidence?: string;
}

export interface RequestContextAction {
	readonly kind: "request_context";
	readonly description: string;
	readonly justification: string;
}

export interface RecordDecisionAction {
	readonly kind: "record_decision";
	readonly targetIssueId?: IssueId;
	readonly decision: string;
	readonly rationale: string;
	readonly rejectedAlternatives?: readonly string[];
}

export type IssueRelationKind = "blocks" | "depends_on" | "duplicates";

export interface LinkIssuesAction {
	readonly kind: "link_issues";
	readonly sourceId: IssueId;
	readonly targetId: IssueId;
	readonly relation: IssueRelationKind;
}

export type LedgerAction =
	| CreateIssueAction
	| ChallengeAction
	| ProposeResolutionAction
	| ProposeClosureAction
	| ReopenIssueAction
	| RequestContextAction
	| RecordDecisionAction
	| LinkIssuesAction;

export interface LedgerEntry {
	readonly seq: number;
	readonly turnId: TurnId;
	readonly agentId: AgentId;
	readonly action: LedgerAction;
	readonly timestamp: number;
}

export interface IssueRecord {
	readonly issueId: IssueId;
	readonly title: string;
	readonly description: string;
	readonly state: IssueState;
	readonly createdBy: AgentId;
	readonly createdAtSeq: number;
	readonly closedAtSeq?: number;
	readonly closureType?: ClosureType;
	readonly assumptions?: readonly string[];
}

export interface DecisionRecord {
	readonly issueId?: IssueId;
	readonly decision: string;
	readonly rationale: string;
	readonly rejectedAlternatives?: readonly string[];
	readonly recordedAtSeq: number;
}

export interface IssueRelation {
	readonly sourceId: IssueId;
	readonly targetId: IssueId;
	readonly relation: IssueRelationKind;
	readonly createdAtSeq: number;
}

export interface ClosureProposal {
	readonly issueId: IssueId;
	readonly proposedBy: AgentId;
	readonly rationale: string;
	readonly closureType: ClosureType;
	readonly seq: number;
	readonly voided: boolean;
}

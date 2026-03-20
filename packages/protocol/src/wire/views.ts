export type ExternalTaskState =
	| "submitted"
	| "running"
	| "awaiting_review"
	| "approved"
	| "rejected"
	| "failed"
	| "cancelled";

export type IssueStateView =
	| "open"
	| "challenged"
	| "proposed_resolution"
	| "closure_proposed"
	| "resolved"
	| "deferred"
	| "risk_proposed";

export type RoomKindView = "domain" | "synthesis" | "query_back";

export interface BundleInputRef {
	readonly path: string;
}

export interface RoomSummaryView {
	readonly roomId: string;
	readonly roomKind: RoomKindView;
	readonly outcome: "running" | "completed" | "inconclusive" | "failed";
	readonly startedAtMs: number;
	readonly completedAtMs?: number;
}

export interface TaskSnapshotView {
	readonly taskId: string;
	readonly state: ExternalTaskState;
	readonly prompt: string;
	readonly currentPhase?: string;
	readonly roomSummaries?: readonly RoomSummaryView[];
	readonly createdAtMs: number;
	readonly updatedAtMs: number;
}

export interface IssueSummaryView {
	readonly issueId: string;
	readonly title: string;
	readonly state: IssueStateView;
	readonly domain: string;
}

export interface RiskProposalView {
	readonly issueId: string;
	readonly title: string;
	readonly rationale: string;
	readonly proposedBy: string;
}

export interface ContextGapView {
	readonly description: string;
	readonly justification: string;
	readonly requestedBy: string;
}

export interface EvidenceTraceLinkView {
	readonly issueId: string;
	readonly sectionRef: string;
	readonly excerpt?: string;
}

export interface DecisionChangeView {
	readonly issueId?: string;
	readonly decision: string;
	readonly rationale: string;
}

export interface ReviewPacketDiffView {
	readonly fromVersion: number;
	readonly toVersion: number;
	readonly addedIssues: readonly IssueSummaryView[];
	readonly removedIssues: readonly IssueSummaryView[];
	readonly changedDecisions: readonly DecisionChangeView[];
	readonly proposalDiff: string;
}

export interface ReviewPacketView {
	readonly taskId: string;
	readonly version: number;
	readonly proposalMarkdown: string;
	readonly unresolvedIssues: readonly IssueSummaryView[];
	readonly riskProposals: readonly RiskProposalView[];
	readonly contextGaps: readonly ContextGapView[];
	readonly evidenceLinks: readonly EvidenceTraceLinkView[];
	readonly diffFromPrevious?: ReviewPacketDiffView;
	readonly generatedAtMs: number;
}

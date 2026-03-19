export interface ReviewPacket {
	readonly taskId: string;
	readonly iteration: number;
	readonly proposal: string;
	readonly unresolvedIssues: readonly RenderedIssue[];
	readonly riskProposedItems: readonly RenderedIssue[];
	readonly contextGaps: readonly ContextGapSummary[];
	readonly diffFromPrior: string | null;
	readonly createdAt: number;
}

export interface RenderedIssue {
	readonly issueId: string;
	readonly title: string;
	readonly status: string;
	readonly summary: string;
}

export interface ContextGapSummary {
	readonly description: string;
	readonly justification: string;
	readonly requestedBy: string;
}

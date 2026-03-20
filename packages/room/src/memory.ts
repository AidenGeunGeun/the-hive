import type {
	ContextBundle,
	IssueRecord,
	MemoryView,
	ResolvedIssueSummary,
	RoomKind,
	UnresolvedIssueDetail,
} from "@the-hive/protocol/engine";

import { formatLedgerEntry, isTerminalIssueState } from "./helpers";
import { getIssueEntries } from "./ledger";
import type { RoomRuntimeState } from "./types";

function sortIssues(issues: readonly IssueRecord[]): readonly IssueRecord[] {
	return [...issues].sort((left, right) => left.createdAtSeq - right.createdAtSeq);
}

function buildResolutionSummary<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	issue: IssueRecord,
): string {
	const latestClosure = [...state.closureProposals]
		.filter((proposal) => proposal.issueId === issue.issueId && !proposal.voided)
		.sort((left, right) => right.seq - left.seq)[0];

	if (latestClosure) {
		return latestClosure.rationale;
	}

	const latestDecision = [...state.issueProjection.decisions]
		.filter((decision) => decision.issueId === issue.issueId)
		.sort((left, right) => right.recordedAtSeq - left.recordedAtSeq)[0];

	return latestDecision ? latestDecision.decision : `Marked as ${issue.state}.`;
}

export function unresolvedIssueScopedMemoryPolicy<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	systemPrompt: string,
	contextBundle: ContextBundle,
): MemoryView {
	const issues = sortIssues([...state.issueProjection.issues.values()]);
	const unresolvedIssueDetails: UnresolvedIssueDetail[] = [];
	const resolvedIssueSummaries: ResolvedIssueSummary[] = [];

	for (const issue of issues) {
		if (isTerminalIssueState(issue.state)) {
			resolvedIssueSummaries.push({
				issueId: issue.issueId,
				title: issue.title,
				state: issue.state as ResolvedIssueSummary["state"],
				resolutionSummary: buildResolutionSummary(state, issue),
			});
			continue;
		}

		unresolvedIssueDetails.push({
			issueId: issue.issueId,
			title: issue.title,
			description: issue.description,
			state: issue.state,
			recentEntries: getIssueEntries(state.ledgerEntries, issue.issueId).map(formatLedgerEntry),
		});
	}

	return {
		systemPrompt,
		contextBundle,
		ledgerSummary: issues.map((issue) => ({
			issueId: issue.issueId,
			title: issue.title,
			state: issue.state,
		})),
		unresolvedIssueDetails,
		resolvedIssueSummaries,
		turnCounterMessage: `Turn ${state.currentRound}/${state.maxRounds}`,
	};
}

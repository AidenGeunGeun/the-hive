import type { LedgerEntry, RenderedArtifact } from "@the-hive/protocol/engine";

import { formatLedgerEntry, isTerminalIssueState } from "./helpers";
import { getIssueEntries, projectIssueStates } from "./ledger";
import type { IssueProjection } from "./types";

function collectContextGapLines(entries: readonly LedgerEntry[]): readonly string[] {
	return entries
		.filter((entry) => entry.action.kind === "request_context")
		.map((entry) => {
			const action = entry.action;
			return action.kind === "request_context"
				? `- ${action.description} -- ${action.justification} (turn ${entry.turnId})`
				: "";
		})
		.filter((line) => line.length > 0);
}

function renderIssueGroup(title: string, lines: readonly string[]): readonly string[] {
	return [`## ${title}`, ...(lines.length > 0 ? lines : ["None."]), ""];
}

function renderIssueSection(entries: readonly LedgerEntry[], issueId: string): readonly string[] {
	return getIssueEntries(entries, issueId as never).map((entry) => `- ${formatLedgerEntry(entry)}`);
}

function renderDomainReportFromProjection(
	projection: IssueProjection,
	entries: readonly LedgerEntry[],
): RenderedArtifact {
	const issues = [...projection.issues.values()].sort(
		(left, right) => left.createdAtSeq - right.createdAtSeq,
	);
	const openLines: string[] = [];
	const resolvedLines: string[] = [];
	const deferredLines: string[] = [];
	const riskLines: string[] = [];

	for (const issue of issues) {
		const bucket = isTerminalIssueState(issue.state)
			? issue.state === "resolved"
				? resolvedLines
				: issue.state === "deferred"
					? deferredLines
					: riskLines
			: openLines;

		bucket.push(`### ${issue.title} (${issue.state})`);
		bucket.push(`- Issue ID: ${issue.issueId}`);
		bucket.push(`- Description: ${issue.description}`);

		for (const line of renderIssueSection(entries, issue.issueId)) {
			bucket.push(line);
		}

		const issueDecisions = projection.decisions.filter(
			(decision) => decision.issueId === issue.issueId,
		);
		for (const decision of issueDecisions) {
			bucket.push(`- Decision: ${decision.decision} -- ${decision.rationale}`);
		}

		bucket.push("");
	}

	const lines = [
		"# Room Report",
		"",
		`- Total issues: ${issues.length}`,
		`- Ledger entries: ${entries.length}`,
		"",
		...renderIssueGroup("Unresolved Issues", openLines),
		...renderIssueGroup("Resolved Issues", resolvedLines),
		...renderIssueGroup("Deferred Issues", deferredLines),
		...renderIssueGroup("Risk Proposals", riskLines),
		...renderIssueGroup("Context Gaps", collectContextGapLines(entries)),
	];

	return {
		kind: "report_markdown",
		content: lines.join("\n").trimEnd(),
		pathHint: "report.md",
	};
}

export function renderDomainReport(entries: readonly LedgerEntry[]): RenderedArtifact {
	return renderDomainReportFromProjection(projectIssueStates(entries), entries);
}

function renderSynthesisProposalFromProjection(
	projection: IssueProjection,
	entries: readonly LedgerEntry[],
): RenderedArtifact {
	const issues = [...projection.issues.values()].sort(
		(left, right) => left.createdAtSeq - right.createdAtSeq,
	);
	const proposalLines = issues
		.filter((issue) => issue.state === "resolved" || issue.state === "deferred")
		.map((issue) => `- ${issue.title} (${issue.state})`);
	const decisionLines = projection.decisions.map(
		(decision) => `- ${decision.decision} -- ${decision.rationale}`,
	);
	const riskLines = issues
		.filter((issue) => issue.state === "risk_proposed")
		.map((issue) => `- ${issue.title} (${issue.issueId})`);
	const unresolvedLines = issues
		.filter((issue) => !isTerminalIssueState(issue.state))
		.map((issue) => `- ${issue.title} (${issue.state})`);
	const lines = [
		"# Final Proposal",
		"",
		...renderIssueGroup("Proposal", proposalLines),
		...renderIssueGroup("Cross-Domain Decisions", decisionLines),
		...renderIssueGroup("Risk Proposals", riskLines),
		...renderIssueGroup("Context Gaps", collectContextGapLines(entries)),
		...renderIssueGroup("Unresolved Issues", unresolvedLines),
	];

	return {
		kind: "review_packet_markdown",
		content: lines.join("\n").trimEnd(),
		pathHint: "final_proposal.md",
	};
}

export function renderSynthesisProposal(entries: readonly LedgerEntry[]): RenderedArtifact {
	return renderSynthesisProposalFromProjection(projectIssueStates(entries), entries);
}

export function renderQueryResponse(entries: readonly LedgerEntry[]): RenderedArtifact {
	const domainArtifact = renderDomainReport(entries);
	return {
		kind: "query_response_markdown",
		content: domainArtifact.content,
		pathHint: "query_response.md",
	};
}

export { renderDomainReportFromProjection, renderSynthesisProposalFromProjection };

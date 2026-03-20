import type {
	AgentId,
	ClosureProposal,
	IssueId,
	IssueState,
	LedgerAction,
	LedgerEntry,
	RoomId,
	TurnId,
} from "@the-hive/protocol/engine";

import type { IssueProjection } from "./types";

const TERMINAL_ISSUE_STATES = new Set<IssueState>(["resolved", "deferred", "risk_proposed"]);

export function buildEmptyIssueProjection(): IssueProjection {
	return {
		issues: new Map(),
		decisions: [],
		relations: [],
	};
}

export function isTerminalIssueState(state: IssueState): boolean {
	return TERMINAL_ISSUE_STATES.has(state);
}

export function normalizeIssueTitle(title: string): string {
	return title.trim().replace(/\s+/g, " ").toLowerCase();
}

export function buildDeterministicTurnId(
	roomId: RoomId,
	roundNumber: number,
	agentId: AgentId,
): TurnId {
	return `${roomId}:round:${roundNumber}:agent:${agentId}` as TurnId;
}

export function actionTouchesIssue(action: LedgerAction, issueId: IssueId): boolean {
	switch (action.kind) {
		case "create_issue":
			return action.issueId === issueId;
		case "challenge":
		case "propose_resolution":
		case "propose_closure":
		case "reopen_issue":
			return action.targetIssueId === issueId;
		case "record_decision":
			return action.targetIssueId === issueId;
		case "link_issues":
			return action.sourceId === issueId || action.targetId === issueId;
		case "request_context":
			return false;
	}

	return false;
}

export function getLatestIssueEntry(
	entries: readonly LedgerEntry[],
	issueId: IssueId,
): LedgerEntry | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry && actionTouchesIssue(entry.action, issueId)) {
			return entry;
		}
	}

	return undefined;
}

export function voidOpenClosureProposals(
	proposals: readonly ClosureProposal[],
	issueId: IssueId,
): readonly ClosureProposal[] {
	let changed = false;
	const next = proposals.map((proposal) => {
		if (proposal.issueId !== issueId || proposal.voided) {
			return proposal;
		}

		changed = true;
		return {
			...proposal,
			voided: true,
		};
	});

	return changed ? next : proposals;
}

export function formatLedgerEntry(entry: LedgerEntry): string {
	const prefix = `#${entry.seq}`;

	switch (entry.action.kind) {
		case "create_issue":
			return `${prefix} Issue created: ${entry.action.title}`;
		case "challenge":
			return entry.action.evidence
				? `${prefix} Challenge: ${entry.action.argument} (evidence: ${entry.action.evidence})`
				: `${prefix} Challenge: ${entry.action.argument}`;
		case "propose_resolution":
			return entry.action.evidence
				? `${prefix} Resolution proposed: ${entry.action.proposal} (evidence: ${entry.action.evidence})`
				: `${prefix} Resolution proposed: ${entry.action.proposal}`;
		case "propose_closure":
			return `${prefix} Closure proposed as ${entry.action.closureType}: ${entry.action.rationale}`;
		case "reopen_issue":
			return entry.action.newEvidence
				? `${prefix} Reopened: ${entry.action.reason} (evidence: ${entry.action.newEvidence})`
				: `${prefix} Reopened: ${entry.action.reason}`;
		case "request_context":
			return `${prefix} Context requested: ${entry.action.description}`;
		case "record_decision":
			return `${prefix} Decision recorded: ${entry.action.decision}`;
		case "link_issues":
			return `${prefix} Linked issue ${entry.action.sourceId} ${entry.action.relation} ${entry.action.targetId}`;
	}

	return prefix;
}

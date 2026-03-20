import type {
	ClosureProposal,
	DecisionRecord,
	IssueRecord,
	IssueRelation,
	LedgerAction,
	LedgerEntry,
	ParsedTurn,
	RoomControlAction,
	RoomKind,
} from "@the-hive/protocol/engine";

import {
	actionTouchesIssue,
	buildEmptyIssueProjection,
	getLatestIssueEntry,
	isTerminalIssueState,
	normalizeIssueTitle,
	voidOpenClosureProposals,
} from "./helpers";
import type {
	IssueProjection,
	LedgerDelta,
	RoomRuntimeState,
	SemanticValidationError,
	SemanticValidationResult,
} from "./types";

interface ProjectionAccumulator {
	readonly issues: Map<IssueRecord["issueId"], IssueRecord>;
	readonly decisions: DecisionRecord[];
	readonly relations: IssueRelation[];
	readonly closureProposals: ClosureProposal[];
}

function cloneIssueRecord(
	issue: IssueRecord,
	overrides: Pick<IssueRecord, "state"> & Partial<Pick<IssueRecord, "closedAtSeq" | "closureType">>,
): IssueRecord {
	return {
		issueId: issue.issueId,
		title: issue.title,
		description: issue.description,
		state: overrides.state,
		createdBy: issue.createdBy,
		createdAtSeq: issue.createdAtSeq,
		...(issue.assumptions ? { assumptions: issue.assumptions } : {}),
		...(overrides.closedAtSeq !== undefined ? { closedAtSeq: overrides.closedAtSeq } : {}),
		...(overrides.closureType !== undefined ? { closureType: overrides.closureType } : {}),
	};
}

function toAccumulator(
	projection: IssueProjection,
	closureProposals: readonly ClosureProposal[],
): ProjectionAccumulator {
	return {
		issues: new Map(projection.issues),
		decisions: [...projection.decisions],
		relations: [...projection.relations],
		closureProposals: [...closureProposals],
	};
}

function toProjection(accumulator: ProjectionAccumulator): IssueProjection {
	return {
		issues: new Map(accumulator.issues),
		decisions: accumulator.decisions,
		relations: accumulator.relations,
	};
}

function applyLedgerEntry(
	accumulator: ProjectionAccumulator,
	entry: LedgerEntry,
): ProjectionAccumulator {
	const issues = new Map(accumulator.issues);
	let closureProposals: readonly ClosureProposal[] = accumulator.closureProposals;

	switch (entry.action.kind) {
		case "create_issue": {
			const record: IssueRecord = {
				issueId: entry.action.issueId,
				title: entry.action.title,
				description: entry.action.description,
				state: "open",
				createdBy: entry.agentId,
				createdAtSeq: entry.seq,
				...(entry.action.assumptions ? { assumptions: entry.action.assumptions } : {}),
			};

			issues.set(entry.action.issueId, record);
			break;
		}
		case "challenge": {
			const issue = issues.get(entry.action.targetIssueId);
			if (issue) {
				issues.set(
					issue.issueId,
					cloneIssueRecord(issue, {
						state: "challenged",
					}),
				);
				closureProposals = voidOpenClosureProposals(closureProposals, entry.action.targetIssueId);
			}
			break;
		}
		case "propose_resolution": {
			const issue = issues.get(entry.action.targetIssueId);
			if (issue) {
				issues.set(
					issue.issueId,
					cloneIssueRecord(issue, {
						state: "proposed_resolution",
					}),
				);
			}
			break;
		}
		case "propose_closure": {
			const issue = issues.get(entry.action.targetIssueId);
			if (issue) {
				issues.set(
					issue.issueId,
					cloneIssueRecord(issue, {
						state: "closure_proposed",
					}),
				);
				closureProposals = [
					...closureProposals,
					{
						issueId: entry.action.targetIssueId,
						proposedBy: entry.agentId,
						rationale: entry.action.rationale,
						closureType: entry.action.closureType,
						seq: entry.seq,
						voided: false,
					},
				];
			}
			break;
		}
		case "reopen_issue": {
			const issue = issues.get(entry.action.targetIssueId);
			if (issue) {
				issues.set(
					issue.issueId,
					cloneIssueRecord(issue, {
						state: "open",
					}),
				);
				closureProposals = voidOpenClosureProposals(closureProposals, entry.action.targetIssueId);
			}
			break;
		}
		case "request_context":
			break;
		case "record_decision":
			accumulator.decisions.push({
				decision: entry.action.decision,
				rationale: entry.action.rationale,
				recordedAtSeq: entry.seq,
				...(entry.action.targetIssueId ? { issueId: entry.action.targetIssueId } : {}),
				...(entry.action.rejectedAlternatives
					? { rejectedAlternatives: entry.action.rejectedAlternatives }
					: {}),
			});
			break;
		case "link_issues":
			accumulator.relations.push({
				sourceId: entry.action.sourceId,
				targetId: entry.action.targetId,
				relation: entry.action.relation,
				createdAtSeq: entry.seq,
			});
			break;
	}

	return {
		issues,
		decisions: accumulator.decisions,
		relations: accumulator.relations,
		closureProposals: [...closureProposals],
	};
}

function projectLedgerState(entries: readonly LedgerEntry[]): {
	readonly projection: IssueProjection;
	readonly closureProposals: readonly ClosureProposal[];
} {
	let accumulator: ProjectionAccumulator = {
		issues: new Map(),
		decisions: [],
		relations: [],
		closureProposals: [],
	};

	for (const entry of entries) {
		accumulator = applyLedgerEntry(accumulator, entry);
	}

	return {
		projection: toProjection(accumulator),
		closureProposals: accumulator.closureProposals,
	};
}

function appendEntryToState(
	projection: IssueProjection,
	closureProposals: readonly ClosureProposal[],
	entry: LedgerEntry,
): {
	readonly projection: IssueProjection;
	readonly closureProposals: readonly ClosureProposal[];
} {
	const next = applyLedgerEntry(toAccumulator(projection, closureProposals), entry);
	return {
		projection: toProjection(next),
		closureProposals: next.closureProposals,
	};
}

function buildValidationError(
	actionIndex: number,
	code: string,
	message: string,
): SemanticValidationError {
	return {
		actionIndex,
		code,
		message,
	};
}

function isDuplicateOpenIssue(
	action: Extract<LedgerAction, { kind: "create_issue" }>,
	projection: IssueProjection,
): boolean {
	const normalizedTitle = normalizeIssueTitle(action.title);

	for (const issue of projection.issues.values()) {
		if (issue.state === "open" && normalizeIssueTitle(issue.title) === normalizedTitle) {
			return true;
		}
	}

	return false;
}

function validateLedgerAction(
	action: LedgerAction,
	actionIndex: number,
	state: RoomRuntimeState,
): SemanticValidationError | null {
	switch (action.kind) {
		case "create_issue":
			return isDuplicateOpenIssue(action, state.issueProjection)
				? buildValidationError(
						actionIndex,
						"duplicate_issue_title",
						`An open issue with title \"${action.title}\" already exists.`,
					)
				: null;
		case "challenge":
			return state.issueProjection.issues.has(action.targetIssueId)
				? null
				: buildValidationError(
						actionIndex,
						"target_issue_missing",
						`Challenge target ${action.targetIssueId} does not exist.`,
					);
		case "propose_resolution":
			return state.issueProjection.issues.has(action.targetIssueId)
				? null
				: buildValidationError(
						actionIndex,
						"target_issue_missing",
						`Resolution target ${action.targetIssueId} does not exist.`,
					);
		case "propose_closure": {
			const issue = state.issueProjection.issues.get(action.targetIssueId);
			if (!issue) {
				return buildValidationError(
					actionIndex,
					"target_issue_missing",
					`Closure target ${action.targetIssueId} does not exist.`,
				);
			}

			if (isTerminalIssueState(issue.state)) {
				return buildValidationError(
					actionIndex,
					"issue_already_terminal",
					`Issue ${action.targetIssueId} is already terminal.`,
				);
			}

			const latestEntry = getLatestIssueEntry(state.ledgerEntries, action.targetIssueId);
			if (
				latestEntry?.action.kind === "propose_closure" &&
				latestEntry.action.rationale === action.rationale &&
				latestEntry.action.closureType === action.closureType
			) {
				return buildValidationError(
					actionIndex,
					"duplicate_closure_proposal",
					`Issue ${action.targetIssueId} already has the same closure proposal since its last change.`,
				);
			}

			return null;
		}
		case "reopen_issue": {
			const issue = state.issueProjection.issues.get(action.targetIssueId);
			if (!issue) {
				return buildValidationError(
					actionIndex,
					"target_issue_missing",
					`Reopen target ${action.targetIssueId} does not exist.`,
				);
			}

			return issue.state !== "open"
				? null
				: buildValidationError(
						actionIndex,
						"issue_already_open",
						`Issue ${action.targetIssueId} is already open.`,
					);
		}
		case "request_context":
			return null;
		case "record_decision":
			return action.targetIssueId && !state.issueProjection.issues.has(action.targetIssueId)
				? buildValidationError(
						actionIndex,
						"target_issue_missing",
						`Decision target ${action.targetIssueId} does not exist.`,
					)
				: null;
		case "link_issues":
			if (action.sourceId === action.targetId) {
				return buildValidationError(
					actionIndex,
					"self_link_not_allowed",
					`Issue ${action.sourceId} cannot link to itself.`,
				);
			}

			if (!state.issueProjection.issues.has(action.sourceId)) {
				return buildValidationError(
					actionIndex,
					"source_issue_missing",
					`Source issue ${action.sourceId} does not exist.`,
				);
			}

			if (!state.issueProjection.issues.has(action.targetId)) {
				return buildValidationError(
					actionIndex,
					"target_issue_missing",
					`Target issue ${action.targetId} does not exist.`,
				);
			}

			return null;
	}

	return null;
}

function validateControlAction(
	action: RoomControlAction,
	actionIndex: number,
	kind: RoomKind,
): SemanticValidationError | null {
	if (action.kind === "propose_room_closure") {
		return null;
	}

	return kind === "synthesis"
		? null
		: buildValidationError(
				actionIndex,
				"invalid_room_control",
				"query_room is only allowed in synthesis rooms.",
			);
}

export function projectIssueStates(entries: readonly LedgerEntry[]): IssueProjection {
	if (entries.length === 0) {
		return buildEmptyIssueProjection();
	}

	return projectLedgerState(entries).projection;
}

export function applyTurnToLedger<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	parsedTurn: ParsedTurn<K>,
): LedgerDelta {
	const newEntries: LedgerEntry[] = [];
	let projection = state.issueProjection;
	let closureProposals = state.closureProposals;
	let nextSeq = state.seq;

	for (const action of parsedTurn.payload.ledgerActions) {
		const entry: LedgerEntry = {
			seq: nextSeq,
			turnId: parsedTurn.turnId,
			agentId: parsedTurn.agentId,
			action,
			timestamp: parsedTurn.timestamp,
		};

		newEntries.push(entry);
		const next = appendEntryToState(projection, closureProposals, entry);
		projection = next.projection;
		closureProposals = next.closureProposals;
		nextSeq += 1;
	}

	return {
		newEntries,
		updatedProjection: projection,
		updatedClosureProposals: closureProposals,
	};
}

export function validateParsedTurn<K extends RoomKind>(
	turn: ParsedTurn<K>,
	state: RoomRuntimeState<K>,
): SemanticValidationResult {
	let workingState: RoomRuntimeState<K> = state;
	const errors: SemanticValidationError[] = [];
	const validActions: LedgerAction[] = [];

	for (const [actionIndex, action] of turn.payload.ledgerActions.entries()) {
		const error = validateLedgerAction(action, actionIndex, workingState);
		if (error) {
			errors.push(error);
			continue;
		}

		validActions.push(action);
		const delta = applyTurnToLedger(workingState, {
			...turn,
			payload: {
				...turn.payload,
				ledgerActions: [action],
				controlActions: [],
			},
		});

		workingState = {
			...workingState,
			ledgerEntries: [...workingState.ledgerEntries, ...delta.newEntries],
			issueProjection: delta.updatedProjection,
			closureProposals: delta.updatedClosureProposals,
			seq: workingState.seq + delta.newEntries.length,
		};
	}

	for (const [index, action] of turn.payload.controlActions.entries()) {
		const error = validateControlAction(
			action,
			turn.payload.ledgerActions.length + index,
			state.kind,
		);
		if (error) {
			errors.push(error);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
		validActions,
	};
}

export function projectClosureProposals(
	entries: readonly LedgerEntry[],
): readonly ClosureProposal[] {
	return projectLedgerState(entries).closureProposals;
}

export function finalizeReadyClosures<K extends RoomKind>(
	state: RoomRuntimeState<K>,
): RoomRuntimeState<K> {
	const latestProposalByIssue = new Map<IssueRecord["issueId"], ClosureProposal>();
	for (const proposal of state.closureProposals) {
		if (proposal.voided) {
			continue;
		}

		const currentProposal = latestProposalByIssue.get(proposal.issueId);
		if (!currentProposal || proposal.seq > currentProposal.seq) {
			latestProposalByIssue.set(proposal.issueId, proposal);
		}
	}

	const updatedIssues = new Map(state.issueProjection.issues);
	const pending = new Map(state.pendingObjectionsByIssue);
	let changed = false;

	for (const proposal of latestProposalByIssue.values()) {
		const pendingAgents = pending.get(proposal.issueId);
		if (pendingAgents && pendingAgents.length > 0) {
			continue;
		}

		const issue = updatedIssues.get(proposal.issueId);
		if (!issue || issue.state !== "closure_proposed") {
			continue;
		}

		updatedIssues.set(
			proposal.issueId,
			cloneIssueRecord(issue, {
				state: proposal.closureType,
				closedAtSeq: proposal.seq,
				closureType: proposal.closureType,
			}),
		);
		pending.delete(proposal.issueId);
		changed = true;
	}

	return changed
		? {
				...state,
				issueProjection: {
					...state.issueProjection,
					issues: updatedIssues,
				},
				pendingObjectionsByIssue: pending,
			}
		: state;
}

export function getIssueEntries(
	entries: readonly LedgerEntry[],
	issueId: IssueRecord["issueId"],
): readonly LedgerEntry[] {
	return entries.filter((entry) => actionTouchesIssue(entry.action, issueId));
}

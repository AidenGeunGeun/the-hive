import type {
	Agent,
	AgentTurnInput,
	AgentTurnOutput,
	ParsedTurn,
	PolicySet,
	RenderedArtifact,
	RoomKind,
	RoomRunOutcome,
	TurnTraceRecord,
} from "@the-hive/protocol/engine";

import { buildDeterministicTurnId, buildEmptyIssueProjection } from "./helpers";
import { applyTurnToLedger, finalizeReadyClosures, validateParsedTurn } from "./ledger";
import {
	domainArtifactPolicy,
	evaluateRoomHealth,
	noOpenObjectionStopPolicy,
	queryBackArtifactPolicy,
	retryOnceThenFailFailurePolicy,
	roundRobinTurnPolicy,
	synthesisArtifactPolicy,
	unresolvedIssueScopedMemoryPolicy,
} from "./policies";
import type {
	FailurePolicy,
	MemoryPolicy,
	RoomKernelInput,
	RoomRuntimeState,
	StopDecision,
	StopPolicy,
	TurnPolicy,
} from "./types";

class RoomKernelError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RoomKernelError";
	}
}

interface ResolvedPolicies {
	readonly turnPolicy: TurnPolicy;
	readonly stopPolicy: StopPolicy;
	readonly memoryPolicy: MemoryPolicy;
	readonly failurePolicy: FailurePolicy;
	readonly artifactPolicy: (state: RoomRuntimeState) => RenderedArtifact;
}

function resolveTurnPolicy(name: string): TurnPolicy {
	if (name === "roundRobinTurnPolicy") {
		return roundRobinTurnPolicy;
	}

	throw new RoomKernelError(`Unsupported turn policy: ${name}`);
}

function resolveStopPolicy(name: string): StopPolicy {
	if (name === "noOpenObjectionStopPolicy") {
		return noOpenObjectionStopPolicy;
	}

	throw new RoomKernelError(`Unsupported stop policy: ${name}`);
}

function resolveMemoryPolicy(name: string): MemoryPolicy {
	if (name === "unresolvedIssueScopedMemoryPolicy") {
		return unresolvedIssueScopedMemoryPolicy;
	}

	throw new RoomKernelError(`Unsupported memory policy: ${name}`);
}

function resolveFailurePolicy(name: string): FailurePolicy {
	if (name === "retryOnceThenFailFailurePolicy") {
		return retryOnceThenFailFailurePolicy;
	}

	throw new RoomKernelError(`Unsupported failure policy: ${name}`);
}

function resolveArtifactPolicy(
	name: string,
	kind: RoomKind,
): (state: RoomRuntimeState) => RenderedArtifact {
	if (name === "domainArtifactPolicy") {
		return domainArtifactPolicy;
	}

	if (name === "synthesisArtifactPolicy") {
		return synthesisArtifactPolicy;
	}

	if (name === "queryBackArtifactPolicy" || kind === "query_back") {
		return queryBackArtifactPolicy;
	}

	throw new RoomKernelError(`Unsupported artifact policy: ${name}`);
}

function resolvePolicies(policies: PolicySet, kind: RoomKind): ResolvedPolicies {
	return {
		turnPolicy: resolveTurnPolicy(policies.turnPolicy),
		stopPolicy: resolveStopPolicy(policies.stopPolicy),
		memoryPolicy: resolveMemoryPolicy(policies.memoryPolicy),
		failurePolicy: resolveFailurePolicy(policies.failurePolicy),
		artifactPolicy: resolveArtifactPolicy(policies.artifactPolicy, kind),
	};
}

function buildInitialState<K extends RoomKind>(input: RoomKernelInput<K>): RoomRuntimeState<K> {
	return {
		roomId: input.spec.roomId,
		kind: input.spec.kind,
		ledgerVersion: 0,
		ledgerEntries: [],
		turnTraces: [],
		currentRound: 0,
		maxRounds: input.spec.maxRounds,
		activeAgents: input.agents.map((agent) => agent.agentId),
		failedAgents: [],
		activeAgentIds: input.agents.map((agent) => agent.agentId),
		failedAgentIds: [],
		pendingObjectionsByIssue: new Map(),
		minHealthyAgents: input.spec.minHealthyAgents,
		issueProjection: buildEmptyIssueProjection(),
		closureProposals: [],
		seq: 1,
	};
}

function removeAgentFromPendingObjections<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	agentId: Agent<K>["agentId"],
): RoomRuntimeState<K> {
	if (state.pendingObjectionsByIssue.size === 0) {
		return state;
	}

	let changed = false;
	const nextPending = new Map(state.pendingObjectionsByIssue);
	for (const [issueId, pendingAgents] of nextPending.entries()) {
		const filtered = pendingAgents.filter((pendingAgentId) => pendingAgentId !== agentId);
		if (filtered.length !== pendingAgents.length) {
			changed = true;
			if (filtered.length === 0) {
				nextPending.delete(issueId);
			} else {
				nextPending.set(issueId, filtered);
			}
		}
	}

	return changed
		? {
				...state,
				pendingObjectionsByIssue: nextPending,
			}
		: state;
}

function applyPendingObjectionUpdates<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	agentId: Agent<K>["agentId"],
	validActions: ParsedTurn<K>["payload"]["ledgerActions"],
): RoomRuntimeState<K> {
	const nextPending = new Map(
		removeAgentFromPendingObjections(state, agentId).pendingObjectionsByIssue,
	);

	for (const action of validActions) {
		switch (action.kind) {
			case "challenge":
			case "reopen_issue":
				nextPending.delete(action.targetIssueId);
				break;
			case "propose_closure": {
				const pendingAgents = state.activeAgentIds.filter(
					(activeAgentId) => activeAgentId !== agentId,
				);
				if (pendingAgents.length > 0) {
					nextPending.set(action.targetIssueId, pendingAgents);
				} else {
					nextPending.delete(action.targetIssueId);
				}
				break;
			}
			default:
				break;
		}
	}

	return finalizeReadyClosures({
		...state,
		pendingObjectionsByIssue: nextPending,
	});
}

function augmentRawResponse(rawResponse: unknown, validationErrors: readonly unknown[]): unknown {
	if (validationErrors.length === 0) {
		return rawResponse;
	}

	return {
		rawResponse,
		semanticValidationErrors: validationErrors,
	};
}

function buildTrace<K extends RoomKind>(
	agentId: Agent<K>["agentId"],
	parsedTurn: ParsedTurn<K> | null,
	roundNumber: number,
	rawResponse: unknown,
	startedAtMs: number,
	completedAtMs: number,
): TurnTraceRecord<K> {
	return {
		turnId:
			parsedTurn?.turnId ?? (`trace:${agentId}:${roundNumber}` as TurnTraceRecord<K>["turnId"]),
		agentId,
		roundNumber,
		parsedTurn,
		rawResponse,
		startedAtMs,
		completedAtMs,
	};
}

function buildFailureTrace<K extends RoomKind>(
	agentId: Agent<K>["agentId"],
	roundNumber: number,
	attempts: number,
	error: unknown,
): TurnTraceRecord<K> {
	const startedAtMs = roundNumber * 1_000 + attempts * 10;
	const completedAtMs = startedAtMs + 1;
	return buildTrace(
		agentId,
		null,
		roundNumber,
		{
			failure: true,
			attempts,
			error:
				error instanceof Error
					? {
							name: error.name,
							message: error.message,
						}
					: { message: String(error) },
		},
		startedAtMs,
		completedAtMs,
	);
}

function updateStateWithTrace<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	trace: TurnTraceRecord<K>,
): RoomRuntimeState<K> {
	return {
		...state,
		turnTraces: [...state.turnTraces, trace],
	};
}

function markAgentFailed<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	agentId: Agent<K>["agentId"],
): RoomRuntimeState<K> {
	if (state.failedAgentIds.includes(agentId)) {
		return state;
	}

	return {
		...state,
		activeAgents: state.activeAgents.filter((activeAgentId) => activeAgentId !== agentId),
		failedAgents: [...state.failedAgents, agentId],
		activeAgentIds: state.activeAgentIds.filter((activeAgentId) => activeAgentId !== agentId),
		failedAgentIds: [...state.failedAgentIds, agentId],
		pendingObjectionsByIssue: removeAgentFromPendingObjections(state, agentId)
			.pendingObjectionsByIssue,
	};
}

export function collectTurn<K extends RoomKind>(
	agent: Agent<K>,
	input: AgentTurnInput,
): Promise<AgentTurnOutput<K>>;
export function collectTurn<K extends RoomKind>(
	agent: Agent<K>,
	memoryView: AgentTurnInput["memoryView"],
): Promise<AgentTurnOutput<K>>;
export async function collectTurn<K extends RoomKind>(
	agent: Agent<K>,
	inputOrMemoryView: AgentTurnInput | AgentTurnInput["memoryView"],
): Promise<AgentTurnOutput<K>> {
	if ("turnId" in inputOrMemoryView) {
		return agent.takeTurn(inputOrMemoryView);
	}

	return agent.takeTurn({
		turnId: `collect:${agent.agentId}` as AgentTurnInput["turnId"],
		roundNumber: 1,
		memoryView: inputOrMemoryView,
		contextBundle: inputOrMemoryView.contextBundle,
	});
}

export async function runRoom<K extends RoomKind>(input: RoomKernelInput<K>) {
	const policies = resolvePolicies(input.spec.policies, input.spec.kind);
	const startedAtMs = Date.now();
	let state = buildInitialState(input);
	let outcome: RoomRunOutcome = "completed";
	let stopReason: StopDecision["reason"] = "continue";

	for (let roundNumber = 1; roundNumber <= input.spec.maxRounds; roundNumber += 1) {
		state = {
			...state,
			currentRound: roundNumber,
		};

		for (const agent of policies.turnPolicy(state, input.agents)) {
			const turnId = buildDeterministicTurnId(state.roomId, roundNumber, agent.agentId);
			const memoryView = policies.memoryPolicy(state, input.systemPrompt, input.contextBundle);
			const turnInput: AgentTurnInput = {
				turnId,
				roundNumber,
				memoryView,
				contextBundle: input.contextBundle,
			};
			const failureResult = await policies.failurePolicy(agent, turnInput);

			if (failureResult.failed) {
				const failureTrace = buildFailureTrace<K>(
					agent.agentId,
					roundNumber,
					failureResult.attempts,
					failureResult.error,
				);
				state = finalizeReadyClosures(
					updateStateWithTrace<K>(markAgentFailed<K>(state, agent.agentId), failureTrace),
				);
				input.onTurnComplete?.(failureTrace);

				const health = evaluateRoomHealth(
					state.activeAgentIds.length,
					state.failedAgentIds.length,
					state.minHealthyAgents,
				);
				if (!health.isHealthy) {
					outcome = "inconclusive";
					return {
						roomId: state.roomId,
						kind: state.kind,
						outcome,
						ledgerEntries: state.ledgerEntries,
						turnTraces: state.turnTraces,
						renderedArtifact: policies.artifactPolicy(state),
						health,
						startedAtMs,
						completedAtMs: Date.now(),
					};
				}

				continue;
			}

			const output = failureResult.output;
			if (!output) {
				throw new RoomKernelError("Failure policy returned no output for a successful turn.");
			}

			let rawResponse = output.rawResponse;
			let validActions: ParsedTurn<K>["payload"]["ledgerActions"] = [];
			if (output.parsedTurn) {
				const validation = validateParsedTurn(output.parsedTurn, state);
				validActions = validation.validActions;
				rawResponse = augmentRawResponse(output.rawResponse, validation.errors);
				if (validation.validActions.length > 0) {
					const sanitizedTurn: ParsedTurn<K> = {
						...output.parsedTurn,
						payload: {
							...output.parsedTurn.payload,
							ledgerActions: validation.validActions,
						},
					};
					const delta = applyTurnToLedger(state, sanitizedTurn);
					state = {
						...state,
						ledgerVersion: state.ledgerVersion + delta.newEntries.length,
						ledgerEntries: [...state.ledgerEntries, ...delta.newEntries],
						issueProjection: delta.updatedProjection,
						closureProposals: delta.updatedClosureProposals,
						seq: state.seq + delta.newEntries.length,
					};
				}
			}
			state = applyPendingObjectionUpdates(state, agent.agentId, validActions);

			const trace = buildTrace(
				agent.agentId,
				output.parsedTurn,
				roundNumber,
				rawResponse,
				output.timing.startedAtMs,
				output.timing.completedAtMs,
			);
			state = updateStateWithTrace(state, trace);
			input.onTurnComplete?.(trace);

			const health = evaluateRoomHealth(
				state.activeAgentIds.length,
				state.failedAgentIds.length,
				state.minHealthyAgents,
			);
			if (!health.isHealthy) {
				outcome = "inconclusive";
				return {
					roomId: state.roomId,
					kind: state.kind,
					outcome,
					ledgerEntries: state.ledgerEntries,
					turnTraces: state.turnTraces,
					renderedArtifact: policies.artifactPolicy(state),
					health,
					startedAtMs,
					completedAtMs: Date.now(),
				};
			}
		}

		const stopDecision = policies.stopPolicy(state);
		if (stopDecision.shouldStop) {
			stopReason = stopDecision.reason;
			outcome = stopDecision.reason === "all_resolved" ? "completed" : "inconclusive";
			break;
		}
	}

	const health = evaluateRoomHealth(
		state.activeAgentIds.length,
		state.failedAgentIds.length,
		state.minHealthyAgents,
	);
	if (
		stopReason === "continue" &&
		state.currentRound >= state.maxRounds &&
		outcome === "completed"
	) {
		outcome = "inconclusive";
	}

	return {
		roomId: state.roomId,
		kind: state.kind,
		outcome,
		ledgerEntries: state.ledgerEntries,
		turnTraces: state.turnTraces,
		renderedArtifact: policies.artifactPolicy(state),
		health,
		startedAtMs,
		completedAtMs: Date.now(),
	};
}

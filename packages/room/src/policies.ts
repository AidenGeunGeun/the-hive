import type {
	Agent,
	AgentTurnInput,
	RenderedArtifact,
	RoomHealth,
	RoomKind,
} from "@the-hive/protocol/engine";

import { isTerminalIssueState } from "./helpers";
import { unresolvedIssueScopedMemoryPolicy } from "./memory";
import {
	renderDomainReportFromProjection,
	renderQueryResponse,
	renderSynthesisProposalFromProjection,
} from "./render";
import type { FailurePolicyResult, RoomRuntimeState, StopDecision } from "./types";

export function roundRobinTurnPolicy<K extends RoomKind>(
	state: RoomRuntimeState<K>,
	agents: readonly Agent<K>[],
): readonly Agent<K>[] {
	return agents.filter((agent) => !state.failedAgentIds.includes(agent.agentId));
}

export function evaluateRoomHealth(state: RoomRuntimeState): RoomHealth;
export function evaluateRoomHealth(
	activeCount: number,
	failedCount: number,
	minHealthy: number,
): RoomHealth;
export function evaluateRoomHealth(
	activeCountOrState: number | RoomRuntimeState,
	failedCount?: number,
	minHealthy?: number,
): RoomHealth {
	if (typeof activeCountOrState !== "number") {
		return {
			totalAgents:
				activeCountOrState.activeAgentIds.length + activeCountOrState.failedAgentIds.length,
			activeAgents: activeCountOrState.activeAgentIds.length,
			failedAgents: activeCountOrState.failedAgentIds.length,
			minHealthyAgents: activeCountOrState.minHealthyAgents,
			isHealthy: activeCountOrState.activeAgentIds.length >= activeCountOrState.minHealthyAgents,
		};
	}

	const activeCount = activeCountOrState;
	const resolvedFailedCount = failedCount ?? 0;
	const resolvedMinHealthy = minHealthy ?? 0;
	return {
		totalAgents: activeCount + resolvedFailedCount,
		activeAgents: activeCount,
		failedAgents: resolvedFailedCount,
		minHealthyAgents: resolvedMinHealthy,
		isHealthy: activeCount >= resolvedMinHealthy,
	};
}

export function evaluateStop<K extends RoomKind>(state: RoomRuntimeState<K>): StopDecision {
	const health = evaluateRoomHealth(
		state.activeAgentIds.length,
		state.failedAgentIds.length,
		state.minHealthyAgents,
	);
	if (!health.isHealthy) {
		return {
			shouldStop: true,
			reason: "below_quorum",
		};
	}

	const allTerminal = [...state.issueProjection.issues.values()].every((issue) =>
		isTerminalIssueState(issue.state),
	);
	const pendingOpenChallenge = [...state.pendingObjectionsByIssue.values()].some(
		(agentIds) => agentIds.length > 0,
	);

	if (allTerminal && !pendingOpenChallenge) {
		return {
			shouldStop: true,
			reason: "all_resolved",
		};
	}

	if (state.currentRound >= state.maxRounds) {
		return {
			shouldStop: true,
			reason: "max_rounds",
		};
	}

	return {
		shouldStop: false,
		reason: "continue",
	};
}

export function noOpenObjectionStopPolicy<K extends RoomKind>(
	state: RoomRuntimeState<K>,
): StopDecision {
	return evaluateStop(state);
}

export async function retryOnceThenFailFailurePolicy<K extends RoomKind>(
	agent: Agent<K>,
	input: AgentTurnInput,
): Promise<FailurePolicyResult<K>> {
	try {
		return {
			output: await agent.takeTurn(input),
			failed: false,
			attempts: 1,
		};
	} catch {
		try {
			return {
				output: await agent.takeTurn(input),
				failed: false,
				attempts: 2,
			};
		} catch (error) {
			return {
				output: null,
				failed: true,
				attempts: 2,
				error,
			};
		}
	}
}

export function domainArtifactPolicy<K extends RoomKind>(
	state: RoomRuntimeState<K>,
): RenderedArtifact {
	return renderDomainReportFromProjection(state.issueProjection, state.ledgerEntries);
}

export function synthesisArtifactPolicy<K extends RoomKind>(
	state: RoomRuntimeState<K>,
): RenderedArtifact {
	return renderSynthesisProposalFromProjection(state.issueProjection, state.ledgerEntries);
}

export function queryBackArtifactPolicy<K extends RoomKind>(
	state: RoomRuntimeState<K>,
): RenderedArtifact {
	return renderQueryResponse(state.ledgerEntries);
}

export { unresolvedIssueScopedMemoryPolicy };

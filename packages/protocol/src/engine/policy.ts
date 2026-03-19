import type { AgentIdentity } from "./agent.js";
import type { ContextBundle } from "./context.js";
import type { RoomHealth } from "./health.js";
import type { Ledger, Turn } from "./ledger.js";

export interface TurnPolicy {
	selectNext(agents: readonly AgentIdentity[], history: readonly Turn[]): AgentIdentity;
}

export interface StopPolicy {
	shouldStop(ledger: Ledger, roundNumber: number, maxRounds: number, health: RoomHealth): boolean;
}

export interface MemoryPolicy {
	buildView(ledger: Ledger, forAgent: AgentIdentity): string;
}

export interface FailurePolicy {
	onAgentError(
		agent: AgentIdentity,
		error: unknown,
		retryCount: number,
		health: RoomHealth,
	): "retry" | "skip" | "terminate";
}

export interface ArtifactPolicy {
	render(ledger: Ledger, context: ContextBundle): string;
}

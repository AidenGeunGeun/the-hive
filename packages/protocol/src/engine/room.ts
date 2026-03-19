import type { AgentIdentity } from "./agent.js";
import type {
	ArtifactPolicy,
	FailurePolicy,
	MemoryPolicy,
	StopPolicy,
	TurnPolicy,
} from "./policy.js";

export interface RoomConfig {
	readonly roomId: string;
	readonly domain: string;
	readonly maxRounds: number;
	readonly minHealthyAgents: number;
	readonly agents: readonly AgentIdentity[];
	readonly turnPolicy: TurnPolicy;
	readonly stopPolicy: StopPolicy;
	readonly memoryPolicy: MemoryPolicy;
	readonly failurePolicy: FailurePolicy;
	readonly artifactPolicy: ArtifactPolicy;
}

export type RoomStatus = "idle" | "running" | "completed" | "terminated";

export interface RoomState {
	readonly roomId: string;
	readonly status: RoomStatus;
	readonly currentRound: number;
	readonly healthyAgentCount: number;
}

export interface RoomResult {
	readonly roomId: string;
	readonly conclusive: boolean;
	readonly terminationReason: "all_resolved" | "max_rounds" | "health_failure";
	readonly artifact: string;
}

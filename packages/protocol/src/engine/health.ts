export type HealthStatus = "healthy" | "degraded" | "below_quorum";

export interface RoomHealth {
	readonly totalAgents: number;
	readonly healthyAgents: number;
	readonly failedAgents: readonly string[];
	readonly minHealthyAgents: number;
	readonly status: HealthStatus;
}

export interface ProviderConfig {
	readonly id: string;
	readonly type: string;
	readonly model: string;
}

export interface AgentConfig {
	readonly id: string;
	readonly persona: string;
	readonly domain: string;
	readonly provider: ProviderConfig;
	readonly systemPromptPath: string;
}

export interface RoomPolicyConfig {
	readonly maxRounds: number;
	readonly minHealthyAgents: number;
	readonly memoryPolicy: "unresolved_issue_scoped" | "full_history";
}

export interface TeamConfig {
	readonly id: string;
	readonly domain: string;
	readonly agents: readonly AgentConfig[];
	readonly leadProvider: ProviderConfig;
	readonly roomPolicy: RoomPolicyConfig;
}

export interface HiveConfig {
	readonly teams: readonly TeamConfig[];
	readonly synthesisPolicy: RoomPolicyConfig;
	readonly maxIterations: number;
	readonly maxQueryBacks: number;
}

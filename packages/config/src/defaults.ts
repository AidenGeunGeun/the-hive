import type { HiveConfig, RoomPolicyConfig } from "./schema.js";

export const DEFAULT_ROOM_POLICY: RoomPolicyConfig = {
	maxRounds: 10,
	minHealthyAgents: 2,
	memoryPolicy: "unresolved_issue_scoped",
};

export const DEFAULT_CONFIG: HiveConfig = {
	teams: [],
	synthesisPolicy: { ...DEFAULT_ROOM_POLICY, maxRounds: 8 },
	maxIterations: 3,
	maxQueryBacks: 3,
};

// @the-hive/protocol/engine
// Internal shared contracts — can change freely.
// CLI must NEVER import from this entrypoint.

export type { Agent, AgentIdentity, AgentResult } from "./agent.js";
export type {
	TurnPolicy,
	StopPolicy,
	MemoryPolicy,
	FailurePolicy,
	ArtifactPolicy,
} from "./policy.js";
export type { Ledger, Issue, IssueStatus, TurnAction, Turn } from "./ledger.js";
export type { ContextBundle, ContextSection, StalenessMetadata } from "./context.js";
export type { RoomConfig, RoomState, RoomResult } from "./room.js";
export type { RoomHealth, HealthStatus } from "./health.js";
export type { ActionType } from "./actions.js";

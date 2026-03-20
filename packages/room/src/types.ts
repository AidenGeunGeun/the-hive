import type {
	Agent,
	AgentId,
	AgentTurnInput,
	AgentTurnOutput,
	ClosureProposal,
	ContextBundle,
	DecisionRecord,
	IssueId,
	IssueRecord,
	IssueRelation,
	LedgerAction,
	LedgerEntry,
	RoomKind,
	RoomSpec,
	TurnTraceRecord,
} from "@the-hive/protocol/engine";

export interface RoomKernelInput<K extends RoomKind = RoomKind> {
	readonly spec: RoomSpec<K>;
	readonly agents: readonly Agent<K>[];
	readonly contextBundle: ContextBundle;
	readonly systemPrompt: string;
	readonly onTurnComplete?: (trace: TurnTraceRecord<K>) => void;
}

export interface IssueProjection {
	readonly issues: ReadonlyMap<IssueId, IssueRecord>;
	readonly decisions: readonly DecisionRecord[];
	readonly relations: readonly IssueRelation[];
}

export interface RoomRuntimeState<K extends RoomKind = RoomKind> {
	readonly roomId: RoomSpec<K>["roomId"];
	readonly kind: K;
	readonly ledgerVersion: number;
	readonly ledgerEntries: readonly LedgerEntry[];
	readonly turnTraces: readonly TurnTraceRecord<K>[];
	readonly currentRound: number;
	readonly maxRounds: number;
	readonly activeAgents: readonly AgentId[];
	readonly failedAgents: readonly AgentId[];
	readonly activeAgentIds: readonly AgentId[];
	readonly failedAgentIds: readonly AgentId[];
	readonly pendingObjectionsByIssue: ReadonlyMap<IssueId, readonly AgentId[]>;
	readonly minHealthyAgents: number;
	readonly issueProjection: IssueProjection;
	readonly closureProposals: readonly ClosureProposal[];
	readonly seq: number;
}

export interface LedgerDelta {
	readonly newEntries: readonly LedgerEntry[];
	readonly updatedProjection: IssueProjection;
	readonly updatedClosureProposals: readonly ClosureProposal[];
}

export interface SemanticValidationError {
	readonly actionIndex: number;
	readonly code: string;
	readonly message: string;
}

export interface SemanticValidationResult {
	readonly valid: boolean;
	readonly errors: readonly SemanticValidationError[];
	readonly validActions: readonly LedgerAction[];
}

export interface StopDecision {
	readonly shouldStop: boolean;
	readonly reason: "all_resolved" | "max_rounds" | "below_quorum" | "continue";
}

export interface FailurePolicyResult<K extends RoomKind = RoomKind> {
	readonly output: AgentTurnOutput<K> | null;
	readonly failed: boolean;
	readonly attempts: number;
	readonly error?: unknown;
}

export type TurnPolicy = <K extends RoomKind>(
	state: RoomRuntimeState<K>,
	agents: readonly Agent<K>[],
) => readonly Agent<K>[];

export type StopPolicy = <K extends RoomKind>(state: RoomRuntimeState<K>) => StopDecision;

export type MemoryPolicy = <K extends RoomKind>(
	state: RoomRuntimeState<K>,
	systemPrompt: string,
	contextBundle: ContextBundle,
) => AgentTurnInput["memoryView"];

export type FailurePolicy = <K extends RoomKind>(
	agent: Agent<K>,
	input: AgentTurnInput,
) => Promise<FailurePolicyResult<K>>;

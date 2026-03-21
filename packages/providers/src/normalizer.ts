import type { ToolCall } from "@mariozechner/pi-ai";
import type {
	AgentId,
	IssueId,
	LedgerAction,
	ParsedTurn,
	RoomKind,
	SubmitTurnPayload,
	TurnId,
} from "@the-hive/protocol/engine";
import { SUBMIT_TURN_TOOL_NAME, type SubmitTurnParameters } from "./tool-schema";
import type { ProviderNormalizationError } from "./types";

class NormalizerError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NormalizerError";
	}
}

interface RawLedgerAction {
	readonly kind: string;
	readonly issueId?: string;
	readonly targetIssueId?: string;
	readonly title?: string;
	readonly description?: string;
	readonly assumptions?: readonly string[];
	readonly argument?: string;
	readonly evidence?: string;
	readonly proposal?: string;
	readonly rationale?: string;
	readonly closureType?: string;
	readonly reason?: string;
	readonly newEvidence?: string;
	readonly justification?: string;
	readonly decision?: string;
	readonly rejectedAlternatives?: readonly string[];
	readonly sourceId?: string;
	readonly targetId?: string;
	readonly relation?: string;
}

interface RawControlAction {
	readonly kind: string;
	readonly targetRoomId?: string;
	readonly question?: string;
	readonly relevantIssueIds?: readonly string[];
}

function normalizeLedgerAction(raw: RawLedgerAction): LedgerAction {
	switch (raw.kind) {
		case "create_issue":
			return {
				kind: "create_issue",
				issueId: (raw.issueId ?? "") as IssueId,
				title: raw.title ?? "",
				description: raw.description ?? "",
				...(raw.assumptions ? { assumptions: raw.assumptions } : {}),
			};

		case "challenge":
			return {
				kind: "challenge",
				targetIssueId: (raw.targetIssueId ?? "") as IssueId,
				argument: raw.argument ?? "",
				...(raw.evidence ? { evidence: raw.evidence } : {}),
			};

		case "propose_resolution":
			return {
				kind: "propose_resolution",
				targetIssueId: (raw.targetIssueId ?? "") as IssueId,
				proposal: raw.proposal ?? "",
				...(raw.evidence ? { evidence: raw.evidence } : {}),
			};

		case "propose_closure":
			return {
				kind: "propose_closure",
				targetIssueId: (raw.targetIssueId ?? "") as IssueId,
				rationale: raw.rationale ?? "",
				closureType: (raw.closureType ?? "resolved") as "resolved" | "deferred" | "risk_proposed",
			};

		case "reopen_issue":
			return {
				kind: "reopen_issue",
				targetIssueId: (raw.targetIssueId ?? "") as IssueId,
				reason: raw.reason ?? "",
				...(raw.newEvidence ? { newEvidence: raw.newEvidence } : {}),
			};

		case "request_context":
			return {
				kind: "request_context",
				description: raw.description ?? "",
				justification: raw.justification ?? "",
			};

		case "record_decision":
			return {
				kind: "record_decision",
				...(raw.targetIssueId ? { targetIssueId: raw.targetIssueId as IssueId } : {}),
				decision: raw.decision ?? "",
				rationale: raw.rationale ?? "",
				...(raw.rejectedAlternatives ? { rejectedAlternatives: raw.rejectedAlternatives } : {}),
			};

		case "link_issues":
			return {
				kind: "link_issues",
				sourceId: (raw.sourceId ?? "") as IssueId,
				targetId: (raw.targetId ?? "") as IssueId,
				relation: (raw.relation ?? "blocks") as "blocks" | "depends_on" | "duplicates",
			};

		default:
			throw new NormalizerError(`Unknown ledger action kind: ${raw.kind}`);
	}
}

function normalizePayload<K extends RoomKind>(args: SubmitTurnParameters): SubmitTurnPayload<K> {
	const ledgerActions = args.ledgerActions.map((raw) =>
		normalizeLedgerAction(raw as unknown as RawLedgerAction),
	);

	const controlActions = (args.controlActions ?? []).map((raw) => {
		const action = raw as unknown as RawControlAction;
		if (action.kind === "propose_room_closure") {
			return { kind: "propose_room_closure" as const };
		}
		if (action.kind === "query_room") {
			return {
				kind: "query_room" as const,
				targetRoomId: action.targetRoomId ?? "",
				question: action.question ?? "",
				relevantIssueIds: action.relevantIssueIds ?? [],
			};
		}
		throw new NormalizerError(`Unknown control action kind: ${action.kind}`);
	});

	return {
		summary: args.summary,
		ledgerActions,
		controlActions: controlActions as SubmitTurnPayload<K>["controlActions"],
	};
}

function isNormalizationError(
	value: ParsedTurn | ProviderNormalizationError,
): value is ProviderNormalizationError {
	return "code" in value && "message" in value;
}

export interface NormalizeToolCallInput {
	readonly toolCall: ToolCall;
	readonly turnId: TurnId;
	readonly agentId: AgentId;
	readonly roundNumber: number;
}

export function normalizeToolCall<K extends RoomKind = RoomKind>(
	input: NormalizeToolCallInput,
): ParsedTurn<K> | ProviderNormalizationError {
	const { toolCall, turnId, agentId, roundNumber } = input;

	if (toolCall.name !== SUBMIT_TURN_TOOL_NAME) {
		return {
			code: "unknown_tool",
			message: `Expected tool "${SUBMIT_TURN_TOOL_NAME}", got "${toolCall.name}"`,
			rawToolCall: toolCall,
		};
	}

	const args = toolCall.arguments as SubmitTurnParameters;

	if (!args.summary || typeof args.summary !== "string") {
		return {
			code: "missing_required_field",
			message: "submit_turn requires a 'summary' string field",
			rawToolCall: toolCall,
		};
	}

	if (!Array.isArray(args.ledgerActions)) {
		return {
			code: "missing_required_field",
			message: "submit_turn requires a 'ledgerActions' array",
			rawToolCall: toolCall,
		};
	}

	try {
		const payload = normalizePayload<K>(args);
		return {
			turnId,
			agentId,
			roundNumber,
			payload,
			timestamp: Date.now(),
		};
	} catch (error) {
		return {
			code: "invalid_arguments",
			message: error instanceof Error ? error.message : String(error),
			rawToolCall: toolCall,
		};
	}
}

export { isNormalizationError };

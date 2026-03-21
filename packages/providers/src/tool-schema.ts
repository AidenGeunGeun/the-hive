import { StringEnum } from "@mariozechner/pi-ai";
import type { Tool } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";

/**
 * Schema for the `submit_turn` tool — the single tool available to deliberation agents.
 *
 * Uses TypeBox for cross-provider JSON Schema generation.
 * StringEnum used for `kind` fields (broader provider compatibility than Type.Literal).
 */

const CreateIssueActionSchema = Type.Object(
	{
		kind: StringEnum(["create_issue"], {
			description: "Create a new issue for deliberation",
		}),
		issueId: Type.String({
			description: "Unique UUID for this issue. Generate a new UUID v4.",
		}),
		title: Type.String({ description: "Short title for the issue" }),
		description: Type.String({ description: "Detailed description of the issue" }),
		assumptions: Type.Optional(
			Type.Array(Type.String(), {
				description: "Assumptions underlying this issue",
			}),
		),
	},
	{ description: "Raise a new issue for the group to deliberate on" },
);

const ChallengeActionSchema = Type.Object(
	{
		kind: StringEnum(["challenge"], {
			description: "Challenge an existing issue or proposal",
		}),
		targetIssueId: Type.String({ description: "The issueId being challenged" }),
		argument: Type.String({ description: "The argument against the current state" }),
		evidence: Type.Optional(Type.String({ description: "Supporting evidence for the challenge" })),
	},
	{ description: "Challenge a claim or proposal on an existing issue" },
);

const ProposeResolutionActionSchema = Type.Object(
	{
		kind: StringEnum(["propose_resolution"], {
			description: "Propose a resolution for an issue",
		}),
		targetIssueId: Type.String({ description: "The issueId being resolved" }),
		proposal: Type.String({ description: "The proposed resolution" }),
		evidence: Type.Optional(Type.String({ description: "Supporting evidence for the proposal" })),
	},
	{ description: "Propose a concrete resolution for an issue" },
);

const ProposeClosureActionSchema = Type.Object(
	{
		kind: StringEnum(["propose_closure"], {
			description: "Propose closing an issue",
		}),
		targetIssueId: Type.String({ description: "The issueId to close" }),
		rationale: Type.String({ description: "Why this issue should be closed" }),
		closureType: StringEnum(["resolved", "deferred", "risk_proposed"], {
			description:
				"How to close: resolved (fixed), deferred (punt), risk_proposed (accept risk — human decides)",
		}),
	},
	{ description: "Propose closing an issue with a specific disposition" },
);

const ReopenIssueActionSchema = Type.Object(
	{
		kind: StringEnum(["reopen_issue"], {
			description: "Reopen a previously closed issue",
		}),
		targetIssueId: Type.String({ description: "The issueId to reopen" }),
		reason: Type.String({ description: "Why this issue needs to be reopened" }),
		newEvidence: Type.Optional(Type.String({ description: "New evidence justifying the reopen" })),
	},
	{ description: "Reopen a non-open issue with new evidence or reasoning" },
);

const RequestContextActionSchema = Type.Object(
	{
		kind: StringEnum(["request_context"], {
			description: "Request additional context from the system",
		}),
		description: Type.String({ description: "What context is needed" }),
		justification: Type.String({ description: "Why this context is needed for deliberation" }),
	},
	{ description: "Request additional documentation or context that is missing" },
);

const RecordDecisionActionSchema = Type.Object(
	{
		kind: StringEnum(["record_decision"], {
			description: "Record an architectural decision",
		}),
		targetIssueId: Type.Optional(
			Type.String({ description: "The issueId this decision relates to, if any" }),
		),
		decision: Type.String({ description: "The decision that was made" }),
		rationale: Type.String({ description: "Why this decision was made" }),
		rejectedAlternatives: Type.Optional(
			Type.Array(Type.String(), {
				description: "Alternatives that were considered and rejected",
			}),
		),
	},
	{ description: "Record an architectural decision reached during deliberation" },
);

const LinkIssuesActionSchema = Type.Object(
	{
		kind: StringEnum(["link_issues"], {
			description: "Link two related issues",
		}),
		sourceId: Type.String({ description: "The source issue ID" }),
		targetId: Type.String({ description: "The target issue ID (must differ from sourceId)" }),
		relation: StringEnum(["blocks", "depends_on", "duplicates"], {
			description: "How the source relates to the target",
		}),
	},
	{ description: "Declare a relationship between two issues" },
);

const LedgerActionSchema = Type.Union(
	[
		CreateIssueActionSchema,
		ChallengeActionSchema,
		ProposeResolutionActionSchema,
		ProposeClosureActionSchema,
		ReopenIssueActionSchema,
		RequestContextActionSchema,
		RecordDecisionActionSchema,
		LinkIssuesActionSchema,
	],
	{
		description: "A deliberation action. Must include a 'kind' field to indicate the action type.",
	},
);

const ProposeRoomClosureSchema = Type.Object(
	{
		kind: StringEnum(["propose_room_closure"], {
			description: "Vote to end this deliberation room",
		}),
	},
	{ description: "Propose ending the room (one-way vote)" },
);

const QueryRoomSchema = Type.Object(
	{
		kind: StringEnum(["query_room"], {
			description: "Query another room for information (synthesis rooms only)",
		}),
		targetRoomId: Type.String({ description: "The room ID to query" }),
		question: Type.String({ description: "The question to ask" }),
		relevantIssueIds: Type.Array(Type.String(), {
			description: "Issue IDs relevant to this query",
		}),
	},
	{ description: "Send a query-back to a domain room (synthesis rooms only)" },
);

const SynthesisControlActionSchema = Type.Union([ProposeRoomClosureSchema, QueryRoomSchema], {
	description: "propose_room_closure to end the room, or query_room to query a domain room.",
});

const NonSynthesisControlActionSchema = ProposeRoomClosureSchema;

function buildSubmitTurnSchema(isSynthesis: boolean) {
	return Type.Object({
		summary: Type.String({
			description:
				"Brief summary of your deliberation this turn. What you considered, what you concluded.",
		}),
		ledgerActions: Type.Array(LedgerActionSchema, {
			description:
				"Deliberation actions to take this turn. At least one action is expected. Each must have a 'kind' field.",
		}),
		controlActions: Type.Array(
			isSynthesis ? SynthesisControlActionSchema : NonSynthesisControlActionSchema,
			{
				description: isSynthesis
					? "Room control actions. Use propose_room_closure when all issues are resolved. Use query_room to query domain rooms."
					: "Room control actions. Use propose_room_closure when all issues are resolved.",
				default: [],
			},
		),
	});
}

export type SubmitTurnParameters = Static<ReturnType<typeof buildSubmitTurnSchema>>;

export const SUBMIT_TURN_TOOL_NAME = "submit_turn";

const TOOL_DESCRIPTION =
	"Submit your deliberation turn. You MUST call this tool exactly once per turn. Include at least one ledger action: raise an issue, challenge a claim, propose a resolution, propose closure, or record a decision. If you have nothing new to contribute, propose closure on resolved issues.";

export const submitTurnTool: Tool = {
	name: SUBMIT_TURN_TOOL_NAME,
	description: TOOL_DESCRIPTION,
	parameters: buildSubmitTurnSchema(false),
};

export const submitTurnToolSynthesis: Tool = {
	name: SUBMIT_TURN_TOOL_NAME,
	description: TOOL_DESCRIPTION,
	parameters: buildSubmitTurnSchema(true),
};

export function getSubmitTurnTool(roomKind: string): Tool {
	return roomKind === "synthesis" ? submitTurnToolSynthesis : submitTurnTool;
}

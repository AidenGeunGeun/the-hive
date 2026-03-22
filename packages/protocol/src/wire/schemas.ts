export interface StringSchema {
	readonly type: "string";
	readonly optional?: boolean;
}

export interface NumberSchema {
	readonly type: "number";
	readonly optional?: boolean;
}

export interface UnknownSchema {
	readonly type: "unknown";
	readonly optional?: boolean;
}

export interface LiteralSchema {
	readonly type: "literal";
	readonly value: string | number | boolean | null;
	readonly optional?: boolean;
}

export interface ArraySchema {
	readonly type: "array";
	readonly items: SchemaNode;
	readonly optional?: boolean;
}

export interface SchemaPropertyMap {
	readonly [key: string]: SchemaNode;
}

export interface ObjectSchema {
	readonly type: "object";
	readonly properties: SchemaPropertyMap;
	readonly optional?: boolean;
}

export interface UnionSchema {
	readonly type: "union";
	readonly anyOf: readonly SchemaNode[];
	readonly optional?: boolean;
}

export type SchemaNode =
	| ArraySchema
	| LiteralSchema
	| NumberSchema
	| ObjectSchema
	| StringSchema
	| UnionSchema
	| UnknownSchema;

const stringSchema = { type: "string" } as const satisfies StringSchema;
const optionalStringSchema = { type: "string", optional: true } as const satisfies StringSchema;
const numberSchema = { type: "number" } as const satisfies NumberSchema;
const unknownSchema = { type: "unknown" } as const satisfies UnknownSchema;
const stringArraySchema = { type: "array", items: stringSchema } as const satisfies ArraySchema;
const optionalStringArraySchema = {
	type: "array",
	items: stringSchema,
	optional: true,
} as const satisfies ArraySchema;
const optionalNumberSchema = { type: "number", optional: true } as const satisfies NumberSchema;

export const externalTaskStateSchema = {
	type: "union",
	anyOf: [
		{ type: "literal", value: "submitted" },
		{ type: "literal", value: "running" },
		{ type: "literal", value: "awaiting_review" },
		{ type: "literal", value: "approved" },
		{ type: "literal", value: "rejected" },
		{ type: "literal", value: "failed" },
		{ type: "literal", value: "cancelled" },
	],
} as const satisfies UnionSchema;

export const issueStateViewSchema = {
	type: "union",
	anyOf: [
		{ type: "literal", value: "open" },
		{ type: "literal", value: "challenged" },
		{ type: "literal", value: "proposed_resolution" },
		{ type: "literal", value: "closure_proposed" },
		{ type: "literal", value: "resolved" },
		{ type: "literal", value: "deferred" },
		{ type: "literal", value: "risk_proposed" },
	],
} as const satisfies UnionSchema;

export const roomKindViewSchema = {
	type: "union",
	anyOf: [
		{ type: "literal", value: "domain" },
		{ type: "literal", value: "synthesis" },
		{ type: "literal", value: "query_back" },
	],
} as const satisfies UnionSchema;

export const bundleInputRefSchema = {
	type: "object",
	properties: {
		path: stringSchema,
	},
} as const satisfies ObjectSchema;

export const protocolVersionSchema = {
	type: "object",
	properties: {
		major: numberSchema,
		minor: numberSchema,
	},
} as const satisfies ObjectSchema;

export const roomSummaryViewSchema = {
	type: "object",
	properties: {
		roomId: stringSchema,
		roomKind: roomKindViewSchema,
		outcome: {
			type: "union",
			anyOf: [
				{ type: "literal", value: "running" },
				{ type: "literal", value: "completed" },
				{ type: "literal", value: "inconclusive" },
				{ type: "literal", value: "failed" },
			],
		},
		startedAtMs: numberSchema,
		completedAtMs: optionalNumberSchema,
	},
} as const satisfies ObjectSchema;

export const taskSnapshotViewSchema = {
	type: "object",
	properties: {
		taskId: stringSchema,
		state: externalTaskStateSchema,
		prompt: stringSchema,
		currentPhase: optionalStringSchema,
		roomSummaries: {
			type: "array",
			items: roomSummaryViewSchema,
			optional: true,
		},
		createdAtMs: numberSchema,
		updatedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const issueSummaryViewSchema = {
	type: "object",
	properties: {
		issueId: stringSchema,
		title: stringSchema,
		state: issueStateViewSchema,
		domain: optionalStringSchema,
	},
} as const satisfies ObjectSchema;

export const riskProposalViewSchema = {
	type: "object",
	properties: {
		issueId: stringSchema,
		title: stringSchema,
		rationale: stringSchema,
		proposedBy: stringSchema,
	},
} as const satisfies ObjectSchema;

export const contextGapViewSchema = {
	type: "object",
	properties: {
		description: stringSchema,
		justification: stringSchema,
		requestedBy: stringSchema,
	},
} as const satisfies ObjectSchema;

export const evidenceTraceLinkViewSchema = {
	type: "object",
	properties: {
		issueId: stringSchema,
		sectionRef: optionalStringSchema,
		evidence: optionalStringSchema,
		excerpt: optionalStringSchema,
	},
} as const satisfies ObjectSchema;

export const decisionChangeViewSchema = {
	type: "object",
	properties: {
		issueId: optionalStringSchema,
		decision: stringSchema,
		rationale: stringSchema,
	},
} as const satisfies ObjectSchema;

export const reviewPacketDiffViewSchema = {
	type: "object",
	properties: {
		fromVersion: numberSchema,
		toVersion: numberSchema,
		addedIssues: { type: "array", items: issueSummaryViewSchema },
		removedIssues: { type: "array", items: issueSummaryViewSchema },
		changedDecisions: { type: "array", items: decisionChangeViewSchema },
		proposalDiff: stringSchema,
	},
} as const satisfies ObjectSchema;

export const reviewPacketViewSchema = {
	type: "object",
	properties: {
		taskId: stringSchema,
		version: numberSchema,
		proposalMarkdown: stringSchema,
		unresolvedIssues: { type: "array", items: issueSummaryViewSchema },
		riskProposals: { type: "array", items: riskProposalViewSchema },
		contextGaps: { type: "array", items: contextGapViewSchema },
		evidenceLinks: { type: "array", items: evidenceTraceLinkViewSchema },
		diffFromPrevious: {
			type: "object",
			properties: reviewPacketDiffViewSchema.properties,
			optional: true,
		},
		generatedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const submitTaskCommandSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "submit_task" },
		commandId: stringSchema,
		taskId: stringSchema,
		prompt: stringSchema,
		bundleInput: bundleInputRefSchema,
		requestedDomains: optionalStringArraySchema,
		configProfile: optionalStringSchema,
		submittedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const approveTaskCommandSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "approve_task" },
		commandId: stringSchema,
		taskId: stringSchema,
		submittedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const rejectTaskCommandSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "reject_task" },
		commandId: stringSchema,
		taskId: stringSchema,
		feedback: stringArraySchema,
		submittedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const cancelTaskCommandSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "cancel_task" },
		commandId: stringSchema,
		taskId: stringSchema,
		submittedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const subscribeTaskCommandSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "subscribe_task" },
		commandId: stringSchema,
		taskId: stringSchema,
	},
} as const satisfies ObjectSchema;

export const getTaskSnapshotCommandSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "get_task_snapshot" },
		commandId: stringSchema,
		taskId: stringSchema,
	},
} as const satisfies ObjectSchema;

export const wireCommandSchema = {
	type: "union",
	anyOf: [
		submitTaskCommandSchema,
		approveTaskCommandSchema,
		rejectTaskCommandSchema,
		cancelTaskCommandSchema,
		subscribeTaskCommandSchema,
		getTaskSnapshotCommandSchema,
	],
} as const satisfies UnionSchema;

export const wireCommandEnvelopeSchema = {
	type: "object",
	properties: {
		protocolVersion: protocolVersionSchema,
		command: wireCommandSchema,
	},
} as const satisfies ObjectSchema;

export const taskStateChangedEventSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "task_state_changed" },
		taskId: stringSchema,
		fromState: externalTaskStateSchema,
		toState: externalTaskStateSchema,
		changedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const roomStartedEventSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "room_started" },
		taskId: stringSchema,
		roomId: stringSchema,
		roomKind: roomKindViewSchema,
		agentIds: stringArraySchema,
		startedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const roomCompletedEventSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "room_completed" },
		taskId: stringSchema,
		roomId: stringSchema,
		roomKind: roomKindViewSchema,
		outcome: {
			type: "union",
			anyOf: [
				{ type: "literal", value: "completed" },
				{ type: "literal", value: "inconclusive" },
			],
		},
		completedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const taskReviewReadyEventSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "task_review_ready" },
		taskId: stringSchema,
		reviewPacket: reviewPacketViewSchema,
		readyAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const wireErrorCodeSchema = {
	type: "union",
	anyOf: [
		{ type: "literal", value: "UNKNOWN_COMMAND" },
		{ type: "literal", value: "INVALID_PAYLOAD" },
		{ type: "literal", value: "TASK_NOT_FOUND" },
		{ type: "literal", value: "INVALID_STATE_TRANSITION" },
		{ type: "literal", value: "PROTOCOL_VERSION_MISMATCH" },
	],
} as const satisfies UnionSchema;

export const taskFailureCodeSchema = {
	type: "union",
	anyOf: [
		{ type: "literal", value: "context_build_failed" },
		{ type: "literal", value: "room_failed" },
		{ type: "literal", value: "render_failed" },
		{ type: "literal", value: "max_iterations_exceeded" },
		{ type: "literal", value: "internal_error" },
	],
} as const satisfies UnionSchema;

export const taskFailedEventSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "task_failed" },
		taskId: stringSchema,
		errorCode: taskFailureCodeSchema,
		message: stringSchema,
		failedAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const taskCancelledEventSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "task_cancelled" },
		taskId: stringSchema,
		cancelledAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const taskSnapshotEventSchema = {
	type: "object",
	properties: {
		kind: { type: "literal", value: "task_snapshot" },
		commandId: stringSchema,
		snapshot: taskSnapshotViewSchema,
		sentAtMs: numberSchema,
	},
} as const satisfies ObjectSchema;

export const wireEventSchema = {
	type: "union",
	anyOf: [
		taskStateChangedEventSchema,
		roomStartedEventSchema,
		roomCompletedEventSchema,
		taskReviewReadyEventSchema,
		taskFailedEventSchema,
		taskCancelledEventSchema,
		taskSnapshotEventSchema,
	],
} as const satisfies UnionSchema;

export const wireEventEnvelopeSchema = {
	type: "object",
	properties: {
		protocolVersion: protocolVersionSchema,
		event: wireEventSchema,
	},
} as const satisfies ObjectSchema;

export const wireErrorSchema = {
	type: "object",
	properties: {
		code: wireErrorCodeSchema,
		message: stringSchema,
		details: { ...unknownSchema, optional: true },
	},
} as const satisfies ObjectSchema;

export const wireErrorEnvelopeSchema = {
	type: "object",
	properties: {
		protocolVersion: protocolVersionSchema,
		commandId: stringSchema,
		error: wireErrorSchema,
	},
} as const satisfies ObjectSchema;

export const wireServerMessageSchema = {
	type: "union",
	anyOf: [wireEventEnvelopeSchema, wireErrorEnvelopeSchema],
} as const satisfies UnionSchema;

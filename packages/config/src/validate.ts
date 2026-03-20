import type {
	AgentTemplateConfig,
	ConfigLoadError,
	DefaultsConfig,
	EvaluationConfig,
	HiveConfig,
	ModelSelectionConfig,
	ModelSelectionReferenceConfig,
	PolicyConfig,
	ProviderProfileConfig,
	RoomTemplateConfig,
	ServerConfig,
	StorageConfig,
	ValidationError,
	ValidationResult,
} from "./types";

const allowedTurnPolicies = ["round_robin"] as const;
const allowedStopPolicies = ["no_open_objections"] as const;
const allowedMemoryPolicies = ["unresolved_issue_scoped"] as const;
const allowedFailurePolicies = ["retry_once_then_fail"] as const;
const allowedArtifactPolicies = [
	"domain_report_markdown",
	"synthesis_review_packet_markdown",
	"query_back_answer_markdown",
] as const;

interface ValidationContext {
	readonly errors: ValidationError[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addError(context: ValidationContext, path: string, message: string, code: string): void {
	context.errors.push({ path, message, code });
}

function readRequiredObject(
	value: unknown,
	path: string,
	context: ValidationContext,
): UnknownRecord | undefined {
	if (!isRecord(value)) {
		addError(context, path, "Expected object", "invalid_type");
		return undefined;
	}

	return value;
}

function readRequiredString(
	record: UnknownRecord,
	key: string,
	path: string,
	context: ValidationContext,
): string | undefined {
	const value = record[key];
	if (typeof value !== "string") {
		addError(context, path, "Expected string", "invalid_type");
		return undefined;
	}

	return value;
}

function readOptionalString(
	record: UnknownRecord,
	key: string,
	path: string,
	context: ValidationContext,
): string | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "string") {
		addError(context, path, "Expected string", "invalid_type");
		return undefined;
	}

	return value;
}

function readRequiredNumber(
	record: UnknownRecord,
	key: string,
	path: string,
	context: ValidationContext,
): number | undefined {
	const value = record[key];
	if (typeof value !== "number" || Number.isNaN(value)) {
		addError(context, path, "Expected number", "invalid_type");
		return undefined;
	}

	return value;
}

function readOptionalNumber(
	record: UnknownRecord,
	key: string,
	path: string,
	context: ValidationContext,
): number | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "number" || Number.isNaN(value)) {
		addError(context, path, "Expected number", "invalid_type");
		return undefined;
	}

	return value;
}

function readOptionalBoolean(
	record: UnknownRecord,
	key: string,
	path: string,
	context: ValidationContext,
): boolean | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== "boolean") {
		addError(context, path, "Expected boolean", "invalid_type");
		return undefined;
	}

	return value;
}

function readStringArray(
	value: unknown,
	path: string,
	context: ValidationContext,
): readonly string[] | undefined {
	if (!Array.isArray(value)) {
		addError(context, path, "Expected string[]", "invalid_type");
		return undefined;
	}

	const items: string[] = [];
	for (const [index, item] of value.entries()) {
		if (typeof item !== "string") {
			addError(context, `${path}[${index}]`, "Expected string", "invalid_type");
			continue;
		}

		items.push(item);
	}

	return items;
}

function validatePolicyIdentifier(
	value: string | undefined,
	allowedValues: readonly string[],
	path: string,
	context: ValidationContext,
): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (!allowedValues.includes(value)) {
		addError(context, path, `Unsupported policy identifier: ${value}`, "unsupported_policy");
		return undefined;
	}

	return value;
}

function parseServerConfig(value: unknown, context: ValidationContext): ServerConfig | undefined {
	const record = readRequiredObject(value, "server", context);
	if (!record) {
		return undefined;
	}

	const port = readRequiredNumber(record, "port", "server.port", context);
	const host = readRequiredString(record, "host", "server.host", context);
	const headless = readOptionalBoolean(record, "headless", "server.headless", context);
	if (port === undefined || host === undefined) {
		return undefined;
	}

	return headless === undefined ? { port, host } : { port, host, headless };
}

function parseStorageConfig(value: unknown, context: ValidationContext): StorageConfig | undefined {
	const record = readRequiredObject(value, "storage", context);
	if (!record) {
		return undefined;
	}

	const dbPath = readRequiredString(record, "dbPath", "storage.dbPath", context);
	if (dbPath === undefined) {
		return undefined;
	}

	return { dbPath };
}

function parseModelSelectionConfig(
	value: unknown,
	path: string,
	context: ValidationContext,
): ModelSelectionConfig | undefined {
	const record = readRequiredObject(value, path, context);
	if (!record) {
		return undefined;
	}

	const modelId = readRequiredString(record, "modelId", `${path}.modelId`, context);
	const alias = readOptionalString(record, "alias", `${path}.alias`, context);
	const maxContextTokens = readOptionalNumber(
		record,
		"maxContextTokens",
		`${path}.maxContextTokens`,
		context,
	);
	const costPerMTokInput = readOptionalNumber(
		record,
		"costPerMTokInput",
		`${path}.costPerMTokInput`,
		context,
	);
	const costPerMTokOutput = readOptionalNumber(
		record,
		"costPerMTokOutput",
		`${path}.costPerMTokOutput`,
		context,
	);

	if (modelId === undefined) {
		return undefined;
	}

	return {
		modelId,
		...(alias === undefined ? {} : { alias }),
		...(maxContextTokens === undefined ? {} : { maxContextTokens }),
		...(costPerMTokInput === undefined ? {} : { costPerMTokInput }),
		...(costPerMTokOutput === undefined ? {} : { costPerMTokOutput }),
	};
}

function parseProviders(
	value: unknown,
	context: ValidationContext,
): readonly ProviderProfileConfig[] | undefined {
	if (!Array.isArray(value)) {
		addError(context, "providers", "Expected array", "invalid_type");
		return undefined;
	}

	const providers: ProviderProfileConfig[] = [];
	const providerIds = new Set<string>();
	for (const [index, item] of value.entries()) {
		const path = `providers[${index}]`;
		const record = readRequiredObject(item, path, context);
		if (!record) {
			continue;
		}

		const providerId = readRequiredString(record, "providerId", `${path}.providerId`, context);
		const apiKeyEnvVar = readRequiredString(
			record,
			"apiKeyEnvVar",
			`${path}.apiKeyEnvVar`,
			context,
		);

		const modelValue = record.models;
		if (!Array.isArray(modelValue)) {
			addError(context, `${path}.models`, "Expected array", "invalid_type");
			continue;
		}

		const models = modelValue
			.map((model, modelIndex) =>
				parseModelSelectionConfig(model, `${path}.models[${modelIndex}]`, context),
			)
			.filter((model): model is ModelSelectionConfig => model !== undefined);

		if (providerId !== undefined && providerIds.has(providerId)) {
			addError(
				context,
				`${path}.providerId`,
				`Duplicate provider id: ${providerId}`,
				"duplicate_provider_id",
			);
		}
		if (providerId !== undefined) {
			providerIds.add(providerId);
		}

		if (providerId === undefined || apiKeyEnvVar === undefined) {
			continue;
		}

		providers.push({
			providerId,
			apiKeyEnvVar,
			models,
		});
	}

	return providers;
}

function parseModelSelectionReference(
	value: unknown,
	path: string,
	context: ValidationContext,
): ModelSelectionReferenceConfig | undefined {
	const record = readRequiredObject(value, path, context);
	if (!record) {
		return undefined;
	}

	const providerId = readRequiredString(record, "providerId", `${path}.providerId`, context);
	const modelId = readRequiredString(record, "modelId", `${path}.modelId`, context);
	if (providerId === undefined || modelId === undefined) {
		return undefined;
	}

	return { providerId, modelId };
}

function parseAgentTemplate(
	value: unknown,
	path: string,
	context: ValidationContext,
): AgentTemplateConfig | undefined {
	const record = readRequiredObject(value, path, context);
	if (!record) {
		return undefined;
	}

	const persona = readRequiredString(record, "persona", `${path}.persona`, context);
	const systemPromptRef = readRequiredString(
		record,
		"systemPromptRef",
		`${path}.systemPromptRef`,
		context,
	);
	const modelSelection = parseModelSelectionReference(
		record.modelSelection,
		`${path}.modelSelection`,
		context,
	);
	if (persona === undefined || systemPromptRef === undefined || modelSelection === undefined) {
		return undefined;
	}

	return { persona, modelSelection, systemPromptRef };
}

function parsePolicies(
	record: UnknownRecord,
	path: string,
	context: ValidationContext,
): PolicyConfig | undefined {
	const turnPolicy = validatePolicyIdentifier(
		readRequiredString(record, "turnPolicy", `${path}.turnPolicy`, context),
		allowedTurnPolicies,
		`${path}.turnPolicy`,
		context,
	);
	const stopPolicy = validatePolicyIdentifier(
		readRequiredString(record, "stopPolicy", `${path}.stopPolicy`, context),
		allowedStopPolicies,
		`${path}.stopPolicy`,
		context,
	);
	const memoryPolicy = validatePolicyIdentifier(
		readRequiredString(record, "memoryPolicy", `${path}.memoryPolicy`, context),
		allowedMemoryPolicies,
		`${path}.memoryPolicy`,
		context,
	);
	const failurePolicy = validatePolicyIdentifier(
		readRequiredString(record, "failurePolicy", `${path}.failurePolicy`, context),
		allowedFailurePolicies,
		`${path}.failurePolicy`,
		context,
	);
	const artifactPolicy = validatePolicyIdentifier(
		readRequiredString(record, "artifactPolicy", `${path}.artifactPolicy`, context),
		allowedArtifactPolicies,
		`${path}.artifactPolicy`,
		context,
	);

	if (
		turnPolicy === undefined ||
		stopPolicy === undefined ||
		memoryPolicy === undefined ||
		failurePolicy === undefined ||
		artifactPolicy === undefined
	) {
		return undefined;
	}

	return {
		turnPolicy,
		stopPolicy,
		memoryPolicy,
		failurePolicy,
		artifactPolicy,
	};
}

function parseRooms(
	value: unknown,
	context: ValidationContext,
): readonly RoomTemplateConfig[] | undefined {
	if (!Array.isArray(value)) {
		addError(context, "rooms", "Expected array", "invalid_type");
		return undefined;
	}

	const rooms: RoomTemplateConfig[] = [];
	const roomIds = new Set<string>();
	for (const [index, item] of value.entries()) {
		const path = `rooms[${index}]`;
		const record = readRequiredObject(item, path, context);
		if (!record) {
			continue;
		}

		const id = readRequiredString(record, "id", `${path}.id`, context);
		const kind = readRequiredString(record, "kind", `${path}.kind`, context);
		const maxRounds = readRequiredNumber(record, "maxRounds", `${path}.maxRounds`, context);
		const minHealthyAgents = readRequiredNumber(
			record,
			"minHealthyAgents",
			`${path}.minHealthyAgents`,
			context,
		);
		const policies = parsePolicies(record, path, context);

		const agentTemplateValue = record.agentTemplates;
		if (!Array.isArray(agentTemplateValue)) {
			addError(context, `${path}.agentTemplates`, "Expected array", "invalid_type");
			continue;
		}

		const agentTemplates = agentTemplateValue
			.map((agentTemplate, agentIndex) =>
				parseAgentTemplate(agentTemplate, `${path}.agentTemplates[${agentIndex}]`, context),
			)
			.filter((agentTemplate): agentTemplate is AgentTemplateConfig => agentTemplate !== undefined);

		if (
			typeof kind === "string" &&
			kind !== "domain" &&
			kind !== "synthesis" &&
			kind !== "query_back"
		) {
			addError(context, `${path}.kind`, `Unsupported room kind: ${kind}`, "invalid_room_kind");
		}
		if (id !== undefined && roomIds.has(id)) {
			addError(context, `${path}.id`, `Duplicate room id: ${id}`, "duplicate_room_id");
		}
		if (id !== undefined) {
			roomIds.add(id);
		}
		if (maxRounds !== undefined && maxRounds <= 0) {
			addError(context, `${path}.maxRounds`, "maxRounds must be > 0", "invalid_max_rounds");
		}
		if (minHealthyAgents !== undefined && minHealthyAgents < 1) {
			addError(
				context,
				`${path}.minHealthyAgents`,
				"minHealthyAgents must be >= 1",
				"invalid_min_healthy_agents",
			);
		}
		if (minHealthyAgents !== undefined && minHealthyAgents > agentTemplates.length) {
			addError(
				context,
				`${path}.minHealthyAgents`,
				"minHealthyAgents must be <= agentTemplates.length",
				"invalid_min_healthy_agents",
			);
		}

		if (
			id === undefined ||
			kind === undefined ||
			(kind !== "domain" && kind !== "synthesis" && kind !== "query_back") ||
			maxRounds === undefined ||
			minHealthyAgents === undefined ||
			policies === undefined
		) {
			continue;
		}

		rooms.push({
			id,
			kind,
			maxRounds,
			minHealthyAgents,
			...policies,
			agentTemplates,
		});
	}

	return rooms;
}

function parseEvaluationConfig(
	value: unknown,
	context: ValidationContext,
): EvaluationConfig | undefined {
	const record = readRequiredObject(value, "evaluation", context);
	if (!record) {
		return undefined;
	}

	const maxCostMultiplier = readRequiredNumber(
		record,
		"maxCostMultiplier",
		"evaluation.maxCostMultiplier",
		context,
	);
	const maxLatencyMultiplier = readRequiredNumber(
		record,
		"maxLatencyMultiplier",
		"evaluation.maxLatencyMultiplier",
		context,
	);
	const holdoutTaskIds =
		record.holdoutTaskIds === undefined
			? undefined
			: readStringArray(record.holdoutTaskIds, "evaluation.holdoutTaskIds", context);

	if (maxCostMultiplier === undefined || maxLatencyMultiplier === undefined) {
		return undefined;
	}

	return holdoutTaskIds === undefined
		? { maxCostMultiplier, maxLatencyMultiplier }
		: { maxCostMultiplier, maxLatencyMultiplier, holdoutTaskIds };
}

function parseDefaultsConfig(
	value: unknown,
	context: ValidationContext,
): DefaultsConfig | undefined {
	const record = readRequiredObject(value, "defaults", context);
	if (!record) {
		return undefined;
	}

	const maxIterations = readRequiredNumber(
		record,
		"maxIterations",
		"defaults.maxIterations",
		context,
	);
	const queryBackMaxPerSynthesis = readRequiredNumber(
		record,
		"queryBackMaxPerSynthesis",
		"defaults.queryBackMaxPerSynthesis",
		context,
	);
	if (maxIterations !== undefined && maxIterations < 1) {
		addError(
			context,
			"defaults.maxIterations",
			"maxIterations must be >= 1",
			"invalid_max_iterations",
		);
	}
	if (queryBackMaxPerSynthesis !== undefined && queryBackMaxPerSynthesis < 0) {
		addError(
			context,
			"defaults.queryBackMaxPerSynthesis",
			"queryBackMaxPerSynthesis must be >= 0",
			"invalid_query_back_cap",
		);
	}

	if (maxIterations === undefined || queryBackMaxPerSynthesis === undefined) {
		return undefined;
	}

	return { maxIterations, queryBackMaxPerSynthesis };
}

function validateModelReferences(
	providers: readonly ProviderProfileConfig[],
	rooms: readonly RoomTemplateConfig[],
	context: ValidationContext,
): void {
	const configuredModels = new Map<string, ReadonlySet<string>>();
	for (const provider of providers) {
		configuredModels.set(
			provider.providerId,
			new Set(provider.models.map((modelSelection) => modelSelection.modelId)),
		);
	}

	for (const [roomIndex, room] of rooms.entries()) {
		for (const [agentIndex, agentTemplate] of room.agentTemplates.entries()) {
			const providerModels = configuredModels.get(agentTemplate.modelSelection.providerId);
			if (!providerModels || !providerModels.has(agentTemplate.modelSelection.modelId)) {
				addError(
					context,
					`rooms[${roomIndex}].agentTemplates[${agentIndex}].modelSelection`,
					"Referenced model selection does not resolve to a configured provider/model",
					"unresolved_model_selection",
				);
			}
		}
	}
}

export function validateConfig(input: unknown): ValidationResult<HiveConfig> {
	const context: ValidationContext = { errors: [] };
	const root = readRequiredObject(input, "", context);
	if (!root) {
		return { ok: false, errors: context.errors };
	}

	const server = parseServerConfig(root.server, context);
	const storage = parseStorageConfig(root.storage, context);
	const providers = parseProviders(root.providers, context);
	const rooms = parseRooms(root.rooms, context);
	const evaluation = parseEvaluationConfig(root.evaluation, context);
	const defaults = parseDefaultsConfig(root.defaults, context);

	if (providers && rooms) {
		validateModelReferences(providers, rooms, context);
	}

	if (
		context.errors.length > 0 ||
		server === undefined ||
		storage === undefined ||
		providers === undefined ||
		rooms === undefined ||
		evaluation === undefined ||
		defaults === undefined
	) {
		return { ok: false, errors: context.errors };
	}

	return {
		ok: true,
		value: {
			server,
			storage,
			providers,
			rooms,
			evaluation,
			defaults,
		},
	};
}

export function toValidationLoadError(
	path: string,
	validationErrors: readonly ValidationError[],
): ConfigLoadError {
	return {
		kind: "validation_error",
		message: "Configuration failed validation",
		path,
		validationErrors,
	};
}

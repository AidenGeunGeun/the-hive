import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	SimpleStreamOptions,
	StopReason,
} from "@mariozechner/pi-ai";
import type {
	ModelSelection,
	ParsedTurn,
	RoomKind,
	TurnTiming,
	TurnUsage,
} from "@the-hive/protocol/engine";

// ---- Registry config ----

export interface ModelOverride {
	readonly baseUrl?: string;
	readonly apiKey?: string;
	readonly maxContextWindowTokens?: number;
	readonly maxOutputTokens?: number;
}

export interface ProviderRuntimeProfile {
	readonly providerId: string;
	readonly modelIds: readonly string[];
	readonly apiKey?: string;
	readonly baseUrl?: string;
}

/**
 * Providers-local runtime config for registry construction.
 * Server maps validated HiveConfig into this shape at composition time.
 */
export interface ProviderRegistryConfig {
	readonly profiles: readonly ProviderRuntimeProfile[];
	readonly defaultProviderId?: string;
	readonly modelOverrides?: Readonly<Record<string, ModelOverride>>;
}

// ---- Capability ----

export interface ProviderCapability {
	readonly providerId: string;
	readonly modelId: string;
	readonly supportsStrictSchemas: boolean;
	readonly supportsStreamingToolArgs: boolean;
	readonly supportsReasoning: boolean;
	readonly maxContextWindowTokens: number;
}

// ---- Model handle ----

export interface ModelHandle {
	readonly piAiModel: Model<Api>;
	readonly capability: ProviderCapability;
}

// ---- Registry ----

export interface ProviderRegistry {
	resolveModel(selection: ModelSelection): ModelHandle;
}

// ---- Turn result ----

export type ProviderStopReason = StopReason | "validation_failed";

export interface ProviderTurnResult<K extends RoomKind = RoomKind> {
	readonly parsedTurn: ParsedTurn<K> | null;
	readonly rawResponse: AssistantMessage;
	readonly usage: TurnUsage;
	readonly timing: TurnTiming;
	readonly stopReason: ProviderStopReason;
	readonly retried: boolean;
	readonly validationError?: string;
}

// ---- Normalization ----

export interface ProviderNormalizationError {
	readonly code: "no_tool_call" | "unknown_tool" | "invalid_arguments" | "missing_required_field";
	readonly message: string;
	readonly rawToolCall?: unknown;
}

// ---- Injection ----

export type CompleteFn = <TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options?: SimpleStreamOptions,
) => Promise<AssistantMessage>;

export interface ProviderAgentDeps {
	readonly registry: ProviderRegistry;
	readonly complete: CompleteFn;
	readonly roomKind: RoomKind;
}

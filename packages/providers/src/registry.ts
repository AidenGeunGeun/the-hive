import { type Api, type KnownProvider, type Model, getModel } from "@mariozechner/pi-ai";
import type { ModelSelection } from "@the-hive/protocol/engine";
import type {
	ModelHandle,
	ProviderCapability,
	ProviderRegistry,
	ProviderRegistryConfig,
} from "./types";

class ProviderRegistryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderRegistryError";
	}
}

function deriveStrictSchemaSupport(api: string): boolean {
	return api === "openai-completions" || api === "openai-responses" || api === "anthropic-messages";
}

function buildCapability(model: Model<Api>, selection: ModelSelection): ProviderCapability {
	return {
		providerId: selection.providerId,
		modelId: selection.modelId,
		supportsStrictSchemas: deriveStrictSchemaSupport(model.api),
		supportsStreamingToolArgs: model.api !== "google-generative-ai",
		supportsReasoning: model.reasoning,
		maxContextWindowTokens: model.contextWindow,
	};
}

function applyModelOverrides(
	model: Model<Api>,
	registryConfig: ProviderRegistryConfig,
	selection: ModelSelection,
): Model<Api> {
	const overrideKey = `${selection.providerId}/${selection.modelId}`;
	const overrides = registryConfig.modelOverrides;
	if (!overrides) {
		return model;
	}

	const override = overrides[overrideKey];
	if (!override) {
		return model;
	}

	return {
		...model,
		...(override.baseUrl ? { baseUrl: override.baseUrl } : {}),
		...(override.maxContextWindowTokens ? { contextWindow: override.maxContextWindowTokens } : {}),
		...(override.maxOutputTokens ? { maxTokens: override.maxOutputTokens } : {}),
	};
}

export function resolveModel(selection: ModelSelection): ModelHandle {
	let piAiModel: Model<Api>;
	try {
		piAiModel = getModel(selection.providerId as KnownProvider, selection.modelId as never);
	} catch (error) {
		throw new ProviderRegistryError(
			`Failed to resolve model: provider="${selection.providerId}" model="${selection.modelId}". ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return {
		piAiModel,
		capability: buildCapability(piAiModel, selection),
	};
}

export function createProviderRegistry(registryConfig: ProviderRegistryConfig): ProviderRegistry {
	const cache = new Map<string, ModelHandle>();

	return {
		resolveModel(selection: ModelSelection): ModelHandle {
			const cacheKey = `${selection.providerId}:${selection.modelId}`;
			const cached = cache.get(cacheKey);
			if (cached) {
				return cached;
			}

			let piAiModel: Model<Api>;
			try {
				piAiModel = getModel(selection.providerId as KnownProvider, selection.modelId as never);
			} catch (error) {
				throw new ProviderRegistryError(
					`Failed to resolve model: provider="${selection.providerId}" model="${selection.modelId}". ${error instanceof Error ? error.message : String(error)}`,
				);
			}

			piAiModel = applyModelOverrides(piAiModel, registryConfig, selection);

			const handle: ModelHandle = {
				piAiModel,
				capability: buildCapability(piAiModel, selection),
			};

			cache.set(cacheKey, handle);
			return handle;
		},
	};
}

export function createDefaultProviderRegistry(): ProviderRegistry {
	return createProviderRegistry({ profiles: [] });
}

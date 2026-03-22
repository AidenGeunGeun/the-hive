import type { HiveConfig, PolicyConfig, RoomTemplateConfig } from "@the-hive/config";
import { type PolicySet, type RoomSpec, createAgentId } from "@the-hive/protocol/engine";
import type { ProviderRegistryConfig } from "@the-hive/providers";

import type { DomainRoomJobPayload } from "./dispatch";

const TURN_POLICY_NAMES: Readonly<Record<string, PolicySet["turnPolicy"]>> = {
	round_robin: "roundRobinTurnPolicy",
};

const STOP_POLICY_NAMES: Readonly<Record<string, PolicySet["stopPolicy"]>> = {
	no_open_objections: "noOpenObjectionStopPolicy",
};

const MEMORY_POLICY_NAMES: Readonly<Record<string, PolicySet["memoryPolicy"]>> = {
	unresolved_issue_scoped: "unresolvedIssueScopedMemoryPolicy",
};

const FAILURE_POLICY_NAMES: Readonly<Record<string, PolicySet["failurePolicy"]>> = {
	retry_once_then_fail: "retryOnceThenFailFailurePolicy",
};

const ARTIFACT_POLICY_NAMES: Readonly<Record<string, PolicySet["artifactPolicy"]>> = {
	domain_artifact: "domainArtifactPolicy",
	domain_report_markdown: "domainArtifactPolicy",
	synthesis_artifact: "synthesisArtifactPolicy",
	synthesis_review_packet_markdown: "synthesisArtifactPolicy",
	query_back_artifact: "queryBackArtifactPolicy",
	query_back_answer_markdown: "queryBackArtifactPolicy",
};

class ConfigMapperError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ConfigMapperError";
	}
}

function requireMappedPolicy<T extends string>(
	map: Readonly<Record<string, T>>,
	key: string,
	kind: string,
): T {
	const mapped = map[key];
	if (!mapped) {
		throw new ConfigMapperError(`Unsupported ${kind}: ${key}`);
	}

	return mapped;
}

function selectDomainTemplate(
	rooms: readonly RoomTemplateConfig[],
	domain: string,
): RoomTemplateConfig {
	const domainTemplates = rooms.filter((room) => room.kind === "domain");
	if (domainTemplates.length === 0) {
		throw new ConfigMapperError("Expected at least one domain room template");
	}

	const matched = domainTemplates.find((room) => room.id === domain || room.id.includes(domain));
	const fallback = domainTemplates[0];
	if (!fallback) {
		throw new ConfigMapperError("Expected a fallback domain room template");
	}

	return matched ?? fallback;
}

export function mapToProviderRegistryConfig(config: HiveConfig): ProviderRegistryConfig {
	return {
		profiles: config.providers.map((provider) => {
			const apiKey = process.env[provider.apiKeyEnvVar];
			return {
				providerId: provider.providerId,
				modelIds: provider.models.map((model) => model.modelId),
				...(apiKey ? { apiKey } : {}),
			};
		}),
		...(config.providers[0] ? { defaultProviderId: config.providers[0].providerId } : {}),
	};
}

export function mapPolicyNames(configPolicies: PolicyConfig): PolicySet {
	return {
		turnPolicy: requireMappedPolicy(TURN_POLICY_NAMES, configPolicies.turnPolicy, "turn policy"),
		stopPolicy: requireMappedPolicy(STOP_POLICY_NAMES, configPolicies.stopPolicy, "stop policy"),
		memoryPolicy: requireMappedPolicy(
			MEMORY_POLICY_NAMES,
			configPolicies.memoryPolicy,
			"memory policy",
		),
		failurePolicy: requireMappedPolicy(
			FAILURE_POLICY_NAMES,
			configPolicies.failurePolicy,
			"failure policy",
		),
		artifactPolicy: requireMappedPolicy(
			ARTIFACT_POLICY_NAMES,
			configPolicies.artifactPolicy,
			"artifact policy",
		),
	};
}

export function buildRoomSpecFromJob(
	config: HiveConfig,
	jobPayload: DomainRoomJobPayload,
): RoomSpec<"domain"> {
	const template = selectDomainTemplate(config.rooms, jobPayload.domain);

	return {
		roomId: jobPayload.roomId,
		kind: "domain",
		agentSpecs: template.agentTemplates.map((agentTemplate) => ({
			agentId: createAgentId(),
			persona: agentTemplate.persona,
			modelSelection: {
				providerId: agentTemplate.modelSelection.providerId,
				modelId: agentTemplate.modelSelection.modelId,
			},
			systemPromptRef: agentTemplate.systemPromptRef,
		})),
		maxRounds: template.maxRounds,
		minHealthyAgents: template.minHealthyAgents,
		policies: mapPolicyNames(template),
	};
}

import type { HiveConfig } from "./types";

export function buildDefaultConfig(): HiveConfig {
	return {
		server: {
			port: 4096,
			host: "127.0.0.1",
			headless: false,
		},
		storage: {
			dbPath: ".the-hive/the-hive.sqlite",
		},
		providers: [
			{
				providerId: "local-dev",
				apiKeyEnvVar: "LOCAL_DEV_API_KEY",
				models: [
					{
						modelId: "baseline",
						alias: "default",
						maxContextTokens: 128000,
					},
				],
			},
		],
		rooms: [
			{
				id: "domain-default",
				kind: "domain",
				maxRounds: 6,
				minHealthyAgents: 2,
				turnPolicy: "round_robin",
				stopPolicy: "no_open_objections",
				memoryPolicy: "unresolved_issue_scoped",
				failurePolicy: "retry_once_then_fail",
				artifactPolicy: "domain_report_markdown",
				agentTemplates: [
					{
						persona: "critic",
						modelSelection: {
							providerId: "local-dev",
							modelId: "baseline",
						},
						systemPromptRef: "prompts/personas/critic.md",
					},
					{
						persona: "builder",
						modelSelection: {
							providerId: "local-dev",
							modelId: "baseline",
						},
						systemPromptRef: "prompts/personas/builder.md",
					},
					{
						persona: "skeptic",
						modelSelection: {
							providerId: "local-dev",
							modelId: "baseline",
						},
						systemPromptRef: "prompts/personas/skeptic.md",
					},
				],
			},
			{
				id: "synthesis-default",
				kind: "synthesis",
				maxRounds: 6,
				minHealthyAgents: 1,
				turnPolicy: "round_robin",
				stopPolicy: "no_open_objections",
				memoryPolicy: "unresolved_issue_scoped",
				failurePolicy: "retry_once_then_fail",
				artifactPolicy: "synthesis_review_packet_markdown",
				agentTemplates: [
					{
						persona: "team_lead",
						modelSelection: {
							providerId: "local-dev",
							modelId: "baseline",
						},
						systemPromptRef: "prompts/team-lead.md",
					},
				],
			},
			{
				id: "query-back-default",
				kind: "query_back",
				maxRounds: 3,
				minHealthyAgents: 1,
				turnPolicy: "round_robin",
				stopPolicy: "no_open_objections",
				memoryPolicy: "unresolved_issue_scoped",
				failurePolicy: "retry_once_then_fail",
				artifactPolicy: "query_back_answer_markdown",
				agentTemplates: [
					{
						persona: "clarifier",
						modelSelection: {
							providerId: "local-dev",
							modelId: "baseline",
						},
						systemPromptRef: "prompts/personas/clarifier.md",
					},
				],
			},
		],
		evaluation: {
			maxCostMultiplier: 1.5,
			maxLatencyMultiplier: 2,
		},
		defaults: {
			maxIterations: 2,
			queryBackMaxPerSynthesis: 3,
		},
	};
}

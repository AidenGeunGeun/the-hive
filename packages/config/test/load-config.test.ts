import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildDefaultConfig, loadConfig } from "../src/index.ts";

class ConfigLoadTestError extends TypeError {}

const tempDirectories: string[] = [];

async function writeTempFile(name: string, content: string): Promise<string> {
	const directoryPath = await mkdtemp(join(tmpdir(), "the-hive-config-"));
	tempDirectories.push(directoryPath);
	const filePath = join(directoryPath, name);
	await writeFile(filePath, content, "utf8");
	return filePath;
}

afterEach(async () => {
	await Promise.all(
		tempDirectories
			.splice(0)
			.map((directoryPath) => rm(directoryPath, { recursive: true, force: true })),
	);
});

describe("loadConfig", () => {
	it("loads a valid JSON config file", async () => {
		const filePath = await writeTempFile(
			"valid.json",
			JSON.stringify(buildDefaultConfig(), null, 2),
		);

		const result = await loadConfig(filePath);
		expect("kind" in result).toBe(false);
		if ("kind" in result) {
			throw new ConfigLoadTestError(`Expected config, received ${result.kind}`);
		}

		expect(result.defaults.maxIterations).toBeGreaterThan(0);
	});

	it("loads a valid JSONC config file", async () => {
		const filePath = await writeTempFile(
			"valid.jsonc",
			`// leading comment
{
			/* inline comment */
			"server": {
				"port": 4096,
				"host": "127.0.0.1",
			},
			"storage": {
				"dbPath": ".the-hive/the-hive.sqlite",
			},
			"providers": [
				{
					"providerId": "local-dev",
					"apiKeyEnvVar": "LOCAL_DEV_API_KEY",
					"models": [
						{
							"modelId": "baseline",
							"alias": "default",
						},
					],
				},
			],
			"rooms": [
				{
					"id": "domain-default",
					"kind": "domain",
					"maxRounds": 6,
					"minHealthyAgents": 2,
					"turnPolicy": "round_robin",
					"stopPolicy": "no_open_objections",
					"memoryPolicy": "unresolved_issue_scoped",
					"failurePolicy": "retry_once_then_fail",
					"artifactPolicy": "domain_report_markdown",
					"agentTemplates": [
						{
							"persona": "critic",
							"modelSelection": {
								"providerId": "local-dev",
								"modelId": "baseline",
							},
							"systemPromptRef": "prompts/personas/critic.md",
						},
						{
							"persona": "builder",
							"modelSelection": {
								"providerId": "local-dev",
								"modelId": "baseline",
							},
							"systemPromptRef": "prompts/personas/builder.md",
						},
					],
				},
				{
					"id": "synthesis-default",
					"kind": "synthesis",
					"maxRounds": 6,
					"minHealthyAgents": 1,
					"turnPolicy": "round_robin",
					"stopPolicy": "no_open_objections",
					"memoryPolicy": "unresolved_issue_scoped",
					"failurePolicy": "retry_once_then_fail",
					"artifactPolicy": "synthesis_review_packet_markdown",
					"agentTemplates": [
						{
							"persona": "team_lead",
							"modelSelection": {
								"providerId": "local-dev",
								"modelId": "baseline",
							},
							"systemPromptRef": "prompts/team-lead.md",
						},
					],
				},
				{
					"id": "query-back-default",
					"kind": "query_back",
					"maxRounds": 3,
					"minHealthyAgents": 1,
					"turnPolicy": "round_robin",
					"stopPolicy": "no_open_objections",
					"memoryPolicy": "unresolved_issue_scoped",
					"failurePolicy": "retry_once_then_fail",
					"artifactPolicy": "query_back_answer_markdown",
					"agentTemplates": [
						{
							"persona": "clarifier",
							"modelSelection": {
								"providerId": "local-dev",
								"modelId": "baseline",
							},
							"systemPromptRef": "prompts/personas/clarifier.md",
						},
					],
				},
			],
			"evaluation": {
				"maxCostMultiplier": 1.5,
				"maxLatencyMultiplier": 2,
			},
			"defaults": {
				"maxIterations": 2,
				"queryBackMaxPerSynthesis": 3,
			},
}
`,
		);

		const result = await loadConfig(filePath);
		expect("kind" in result).toBe(false);
		if ("kind" in result) {
			throw new ConfigLoadTestError(`Expected config, received ${result.kind}`);
		}

		expect(result.rooms).toHaveLength(3);
	});

	it("returns a parse error for invalid JSON", async () => {
		const filePath = await writeTempFile("invalid.json", "{ invalid json }");

		const result = await loadConfig(filePath);
		expect(result).toMatchObject({
			kind: "parse_error",
			path: filePath,
		});
	});

	it("returns validation errors for invalid configs", async () => {
		const baseConfig = buildDefaultConfig();
		const invalidConfig = {
			...baseConfig,
			rooms: baseConfig.rooms.map((room, index) =>
				index === 0 ? { ...room, maxRounds: 0 } : room,
			),
		};
		const filePath = await writeTempFile(
			"invalid-config.json",
			JSON.stringify(invalidConfig, null, 2),
		);

		const result = await loadConfig(filePath);
		expect(result).toMatchObject({
			kind: "validation_error",
			path: filePath,
		});
		if (!("kind" in result) || result.kind !== "validation_error") {
			throw new ConfigLoadTestError("Expected validation_error result");
		}
		if (!result.validationErrors) {
			throw new ConfigLoadTestError("Expected validation errors to be present");
		}

		expect(result.validationErrors.some((error) => error.path === "rooms[0].maxRounds")).toBe(true);
	});
});

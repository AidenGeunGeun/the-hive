import { describe, expect, it } from "vitest";

import { buildDefaultConfig, validateConfig } from "../src/index.ts";
import type { HiveConfig } from "../src/index.ts";

class ConfigValidationTestError extends TypeError {}

function cloneConfig(config: HiveConfig): HiveConfig {
	return {
		...config,
		providers: config.providers.map((provider) => ({
			...provider,
			models: provider.models.map((model) => ({ ...model })),
		})),
		rooms: config.rooms.map((room) => ({
			...room,
			agentTemplates: room.agentTemplates.map((agentTemplate) => ({
				...agentTemplate,
				modelSelection: { ...agentTemplate.modelSelection },
			})),
		})),
		evaluation: {
			...config.evaluation,
			holdoutTaskIds: config.evaluation.holdoutTaskIds
				? [...config.evaluation.holdoutTaskIds]
				: undefined,
		},
		defaults: { ...config.defaults },
		server: { ...config.server },
		storage: { ...config.storage },
	};
}

function expectValidationError(config: HiveConfig, path: string): void {
	const result = validateConfig(config);
	expect(result.ok).toBe(false);
	if (result.ok) {
		throw new ConfigValidationTestError("Expected config validation to fail");
	}

	expect(result.errors.some((error) => error.path === path)).toBe(true);
}

describe("validateConfig", () => {
	it("accepts the default config", () => {
		const result = validateConfig(buildDefaultConfig());
		expect(result).toEqual({ ok: true, value: buildDefaultConfig() });
	});

	it("rejects maxRounds of zero", () => {
		const baseConfig = cloneConfig(buildDefaultConfig());
		const config: HiveConfig = {
			...baseConfig,
			rooms: baseConfig.rooms.map((room, index) =>
				index === 0 ? { ...room, maxRounds: 0 } : room,
			),
		};

		expectValidationError(config, "rooms[0].maxRounds");
	});

	it("rejects minHealthyAgents of zero", () => {
		const baseConfig = cloneConfig(buildDefaultConfig());
		const config: HiveConfig = {
			...baseConfig,
			rooms: baseConfig.rooms.map((room, index) =>
				index === 0 ? { ...room, minHealthyAgents: 0 } : room,
			),
		};

		expectValidationError(config, "rooms[0].minHealthyAgents");
	});

	it("rejects duplicate room ids", () => {
		const baseConfig = cloneConfig(buildDefaultConfig());
		const config: HiveConfig = {
			...baseConfig,
			rooms: baseConfig.rooms.map((room, index) =>
				index === 1 ? { ...room, id: baseConfig.rooms[0].id } : room,
			),
		};

		expectValidationError(config, "rooms[1].id");
	});

	it("rejects negative query-back caps", () => {
		const baseConfig = cloneConfig(buildDefaultConfig());
		const config: HiveConfig = {
			...baseConfig,
			defaults: { ...baseConfig.defaults, queryBackMaxPerSynthesis: -1 },
		};

		expectValidationError(config, "defaults.queryBackMaxPerSynthesis");
	});

	it("rejects unresolved model references", () => {
		const baseConfig = cloneConfig(buildDefaultConfig());
		const config: HiveConfig = {
			...baseConfig,
			rooms: baseConfig.rooms.map((room, roomIndex) =>
				roomIndex === 0
					? {
							...room,
							agentTemplates: room.agentTemplates.map((agentTemplate, agentIndex) =>
								agentIndex === 0
									? {
											...agentTemplate,
											modelSelection: {
												providerId: "missing-provider",
												modelId: agentTemplate.modelSelection.modelId,
											},
										}
									: agentTemplate,
							),
						}
					: room,
			),
		};

		expectValidationError(config, "rooms[0].agentTemplates[0].modelSelection");
	});
});

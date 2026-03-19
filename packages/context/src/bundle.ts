import type { ContextBundle } from "@the-hive/protocol/engine";

export function buildBundle(_sourcePaths: readonly string[]): ContextBundle {
	// TODO: Parse sources, detect staleness, assemble bundle
	return {
		id: crypto.randomUUID(),
		version: 1,
		sections: [],
		createdAt: Date.now(),
	};
}

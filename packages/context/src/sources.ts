import type { ContextSection } from "@the-hive/protocol/engine";

export function parseAgentsMd(_path: string): ContextSection {
	// TODO: Parse AGENTS.md file into a ContextSection
	throw new Error("Not implemented");
}

export function parseApiSchema(_path: string): ContextSection {
	// TODO: Parse OpenAPI/GraphQL schema into a ContextSection
	throw new Error("Not implemented");
}

export function parseDependencyManifest(_path: string): ContextSection {
	// TODO: Parse package.json/go.mod/Cargo.toml into a ContextSection
	throw new Error("Not implemented");
}

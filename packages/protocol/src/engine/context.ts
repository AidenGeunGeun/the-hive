export type ContextSectionKind =
	| "agents_md"
	| "architecture_doc"
	| "openapi"
	| "graphql"
	| "db_schema"
	| "dependency_manifest"
	| "query_response_artifact";

export interface StalenessMetadata {
	readonly lastVerifiedAtMs: number;
	readonly source: "file_mtime" | "explicit" | "unknown";
}

export interface ContextSection {
	readonly sectionId: string;
	readonly kind: ContextSectionKind;
	readonly sourceRef: string;
	readonly domainTags: readonly string[];
	readonly content: string;
	readonly checksum: string;
	readonly staleness: StalenessMetadata;
}

export interface ContextBundle {
	readonly bundleId: string;
	readonly version: number;
	readonly createdAtMs: number;
	readonly rootRef: string;
	readonly sections: readonly ContextSection[];
}

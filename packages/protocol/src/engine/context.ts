export interface StalenessMetadata {
	readonly lastVerified: number;
	readonly source: string;
}

export interface ContextSection {
	readonly id: string;
	readonly domain: string;
	readonly content: string;
	readonly sourceType: "agents_md" | "api_schema" | "dependency_manifest" | "db_schema" | "architecture_doc";
	readonly staleness: StalenessMetadata;
}

export interface ContextBundle {
	readonly id: string;
	readonly version: number;
	readonly sections: readonly ContextSection[];
	readonly createdAt: number;
}

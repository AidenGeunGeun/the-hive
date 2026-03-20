export type RoomKind = "domain" | "synthesis" | "query_back";

export interface ServerConfig {
	readonly port: number;
	readonly host: string;
	readonly headless?: boolean;
}

export interface StorageConfig {
	readonly dbPath: string;
}

export interface ModelSelectionConfig {
	readonly modelId: string;
	readonly alias?: string;
	readonly maxContextTokens?: number;
	readonly costPerMTokInput?: number;
	readonly costPerMTokOutput?: number;
}

export interface ProviderProfileConfig {
	readonly providerId: string;
	readonly apiKeyEnvVar: string;
	readonly models: readonly ModelSelectionConfig[];
}

export interface ModelSelectionReferenceConfig {
	readonly providerId: string;
	readonly modelId: string;
}

export interface AgentTemplateConfig {
	readonly persona: string;
	readonly modelSelection: ModelSelectionReferenceConfig;
	readonly systemPromptRef: string;
}

export interface PolicyConfig {
	readonly turnPolicy: string;
	readonly stopPolicy: string;
	readonly memoryPolicy: string;
	readonly failurePolicy: string;
	readonly artifactPolicy: string;
}

export interface RoomTemplateConfig extends PolicyConfig {
	readonly id: string;
	readonly kind: RoomKind;
	readonly maxRounds: number;
	readonly minHealthyAgents: number;
	readonly agentTemplates: readonly AgentTemplateConfig[];
}

export interface EvaluationConfig {
	readonly maxCostMultiplier: number;
	readonly maxLatencyMultiplier: number;
	readonly holdoutTaskIds?: readonly string[];
}

export interface DefaultsConfig {
	readonly maxIterations: number;
	readonly queryBackMaxPerSynthesis: number;
}

export interface HiveConfig {
	readonly server: ServerConfig;
	readonly storage: StorageConfig;
	readonly providers: readonly ProviderProfileConfig[];
	readonly rooms: readonly RoomTemplateConfig[];
	readonly evaluation: EvaluationConfig;
	readonly defaults: DefaultsConfig;
}

export interface ValidationError {
	readonly path: string;
	readonly message: string;
	readonly code: string;
}

export interface ValidationSuccess<T> {
	readonly ok: true;
	readonly value: T;
}

export interface ValidationFailure {
	readonly ok: false;
	readonly errors: readonly ValidationError[];
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export interface ConfigLoadError {
	readonly kind: "io_error" | "parse_error" | "validation_error";
	readonly message: string;
	readonly path?: string;
	readonly validationErrors?: readonly ValidationError[];
}

import type { HiveConfig } from "./schema.js";
import { DEFAULT_CONFIG } from "./defaults.js";

export function loadConfig(_path?: string): HiveConfig {
	// TODO: Load from file, validate, merge with defaults
	return DEFAULT_CONFIG;
}

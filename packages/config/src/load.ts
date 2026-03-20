import { readFile } from "node:fs/promises";

import { normalizeJsonc } from "./jsonc";
import type { ConfigLoadError, HiveConfig } from "./types";
import { toValidationLoadError, validateConfig } from "./validate";

export async function loadConfig(path: string): Promise<HiveConfig | ConfigLoadError> {
	let fileContents: string;
	try {
		fileContents = await readFile(path, "utf8");
	} catch (error) {
		return {
			kind: "io_error",
			message: error instanceof Error ? error.message : "Unable to read config file",
			path,
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(normalizeJsonc(fileContents));
	} catch (error) {
		return {
			kind: "parse_error",
			message: error instanceof Error ? error.message : "Invalid JSON",
			path,
		};
	}

	const validationResult = validateConfig(parsed);
	if (!validationResult.ok) {
		return toValidationLoadError(path, validationResult.errors);
	}

	return validationResult.value;
}

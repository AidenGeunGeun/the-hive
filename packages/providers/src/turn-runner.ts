import type {
	Api,
	AssistantMessage,
	Context,
	Model,
	ToolCall,
	ToolResultMessage,
} from "@mariozechner/pi-ai";
import { validateToolCall } from "@mariozechner/pi-ai";
import { isContextOverflow } from "@mariozechner/pi-ai";
import type {
	AgentId,
	MemoryView,
	RoomKind,
	TurnId,
	TurnTiming,
	TurnUsage,
} from "@the-hive/protocol/engine";
import { isNormalizationError, normalizeToolCall } from "./normalizer";
import { buildContext } from "./prompt-builder";
import { SUBMIT_TURN_TOOL_NAME, getSubmitTurnTool } from "./tool-schema";
import type { CompleteFn, ProviderTurnResult } from "./types";

class ProviderTurnError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProviderTurnError";
	}
}

/**
 * Extract the first submit_turn tool call from an AssistantMessage.
 * Returns null if no tool call is found.
 */
function extractToolCall(message: AssistantMessage): ToolCall | null {
	for (const content of message.content) {
		if (content.type === "toolCall" && content.name === SUBMIT_TURN_TOOL_NAME) {
			return content;
		}
	}
	return null;
}

/**
 * Convert pi-ai's Usage into our TurnUsage.
 */
function mapUsage(message: AssistantMessage): TurnUsage {
	return {
		inputTokens: message.usage.input,
		outputTokens: message.usage.output,
		totalTokens: message.usage.totalTokens,
		costUsd: message.usage.cost.total,
	};
}

/**
 * Build timing from start/end timestamps.
 */
function buildTiming(startedAtMs: number, completedAtMs: number): TurnTiming {
	return {
		startedAtMs,
		completedAtMs,
		latencyMs: completedAtMs - startedAtMs,
	};
}

/**
 * Build a tool result error message to send back to the model on retry.
 */
function buildToolResultError(toolCallId: string, errorMessage: string): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName: SUBMIT_TURN_TOOL_NAME,
		content: [
			{
				type: "text",
				text: `Error: ${errorMessage}\n\nPlease fix the arguments and call submit_turn again.`,
			},
		],
		isError: true,
		timestamp: Date.now(),
	};
}

/**
 * Run a single provider turn: call pi-ai, validate, normalize, optionally retry once.
 *
 * Flow:
 * 1. Build pi-ai Context from MemoryView
 * 2. Call completeSimple
 * 3. Check for context overflow or error
 * 4. Extract submit_turn tool call
 * 5. Validate tool call arguments against TypeBox schema
 * 6. If invalid: send tool result error back → retry once
 * 7. Normalize to ParsedTurn
 * 8. Return result with usage/timing
 */
export async function runProviderTurn<K extends RoomKind>(options: {
	readonly model: Model<Api>;
	readonly complete: CompleteFn;
	readonly turnId: TurnId;
	readonly agentId: AgentId;
	readonly roundNumber: number;
	readonly memoryView: MemoryView;
	readonly roomKind: K;
	readonly maxOutputTokens?: number;
}): Promise<ProviderTurnResult<K>> {
	const startedAtMs = Date.now();
	const context = buildContext(options.memoryView, options.roomKind);

	const firstResponse = await options.complete(options.model, context, {
		maxTokens: options.maxOutputTokens ?? options.model.maxTokens,
	});

	if (isContextOverflow(firstResponse, options.model.contextWindow)) {
		throw new ProviderTurnError(
			`Context overflow: input exceeds model's ${options.model.contextWindow} token limit`,
		);
	}

	if (firstResponse.stopReason === "error") {
		throw new ProviderTurnError(`Provider error: ${firstResponse.errorMessage ?? "unknown error"}`);
	}

	const firstToolCall = extractToolCall(firstResponse);

	if (!firstToolCall) {
		const completedAtMs = Date.now();
		return {
			parsedTurn: null,
			rawResponse: firstResponse,
			usage: mapUsage(firstResponse),
			timing: buildTiming(startedAtMs, completedAtMs),
			stopReason: firstResponse.stopReason,
			retried: false,
			validationError: "Model did not call submit_turn tool",
		};
	}

	const tool = getSubmitTurnTool(options.roomKind);

	let validatedArgs: unknown;
	try {
		validatedArgs = validateToolCall([tool], firstToolCall);
	} catch (validationError) {
		// Validation failed — retry once with error feedback
		const errorMsg =
			validationError instanceof Error ? validationError.message : String(validationError);
		const retryResult = await retryWithFeedback(
			options,
			context,
			firstResponse,
			firstToolCall,
			errorMsg,
			startedAtMs,
		);
		return retryResult;
	}

	// Normalize to ParsedTurn
	const normResult = normalizeToolCall<K>({
		toolCall: { ...firstToolCall, arguments: validatedArgs as Record<string, unknown> },
		turnId: options.turnId,
		agentId: options.agentId,
		roundNumber: options.roundNumber,
	});

	const completedAtMs = Date.now();

	if (isNormalizationError(normResult)) {
		return {
			parsedTurn: null,
			rawResponse: firstResponse,
			usage: mapUsage(firstResponse),
			timing: buildTiming(startedAtMs, completedAtMs),
			stopReason: "validation_failed",
			retried: false,
			validationError: normResult.message,
		};
	}

	return {
		parsedTurn: normResult,
		rawResponse: firstResponse,
		usage: mapUsage(firstResponse),
		timing: buildTiming(startedAtMs, completedAtMs),
		stopReason: firstResponse.stopReason,
		retried: false,
	};
}

/**
 * Retry a failed turn once by sending the error back as a tool result.
 */
async function retryWithFeedback<K extends RoomKind>(
	options: {
		readonly model: Model<Api>;
		readonly complete: CompleteFn;
		readonly turnId: TurnId;
		readonly agentId: AgentId;
		readonly roundNumber: number;
		readonly memoryView: MemoryView;
		readonly roomKind: K;
		readonly maxOutputTokens?: number;
	},
	originalContext: Context,
	firstResponse: AssistantMessage,
	failedToolCall: ToolCall,
	errorMessage: string,
	startedAtMs: number,
): Promise<ProviderTurnResult<K>> {
	const retryContext: Context = {
		...originalContext,
		messages: [
			...originalContext.messages,
			firstResponse,
			buildToolResultError(failedToolCall.id, errorMessage),
		],
	};

	const retryResponse = await options.complete(options.model, retryContext, {
		maxTokens: options.maxOutputTokens ?? options.model.maxTokens,
	});

	// Check for provider-level failures on retry too
	if (isContextOverflow(retryResponse, options.model.contextWindow)) {
		throw new ProviderTurnError(
			`Context overflow on retry: input exceeds model's ${options.model.contextWindow} token limit`,
		);
	}

	if (retryResponse.stopReason === "error") {
		throw new ProviderTurnError(
			`Provider error on retry: ${retryResponse.errorMessage ?? "unknown error"}`,
		);
	}

	const retryToolCall = extractToolCall(retryResponse);
	const completedAtMs = Date.now();

	// Combine usage from both calls
	const combinedUsage: TurnUsage = {
		inputTokens: firstResponse.usage.input + retryResponse.usage.input,
		outputTokens: firstResponse.usage.output + retryResponse.usage.output,
		totalTokens: firstResponse.usage.totalTokens + retryResponse.usage.totalTokens,
		costUsd: firstResponse.usage.cost.total + retryResponse.usage.cost.total,
	};

	if (!retryToolCall) {
		return {
			parsedTurn: null,
			rawResponse: retryResponse,
			usage: combinedUsage,
			timing: buildTiming(startedAtMs, completedAtMs),
			stopReason: retryResponse.stopReason,
			retried: true,
			validationError: "Retry also failed: model did not call submit_turn",
		};
	}

	const tool = getSubmitTurnTool(options.roomKind);
	let validatedArgs: unknown;
	try {
		validatedArgs = validateToolCall([tool], retryToolCall);
	} catch (retryValidationError) {
		return {
			parsedTurn: null,
			rawResponse: retryResponse,
			usage: combinedUsage,
			timing: buildTiming(startedAtMs, completedAtMs),
			stopReason: "validation_failed",
			retried: true,
			validationError: `Retry validation failed: ${retryValidationError instanceof Error ? retryValidationError.message : String(retryValidationError)}`,
		};
	}

	const normResult = normalizeToolCall<K>({
		toolCall: { ...retryToolCall, arguments: validatedArgs as Record<string, unknown> },
		turnId: options.turnId,
		agentId: options.agentId,
		roundNumber: options.roundNumber,
	});

	if (isNormalizationError(normResult)) {
		return {
			parsedTurn: null,
			rawResponse: retryResponse,
			usage: combinedUsage,
			timing: buildTiming(startedAtMs, completedAtMs),
			stopReason: "validation_failed",
			retried: true,
			validationError: normResult.message,
		};
	}

	return {
		parsedTurn: normResult,
		rawResponse: retryResponse,
		usage: combinedUsage,
		timing: buildTiming(startedAtMs, completedAtMs),
		stopReason: retryResponse.stopReason,
		retried: true,
	};
}

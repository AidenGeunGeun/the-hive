import type { Api, AssistantMessage, Context, Model, Usage } from "@mariozechner/pi-ai";
import type {
	AgentId,
	AgentSpec,
	AgentTurnInput,
	ContextBundle,
	IssueId,
	MemoryView,
	TurnId,
} from "@the-hive/protocol/engine";
import { describe, expect, it, vi } from "vitest";
import {
	SUBMIT_TURN_TOOL_NAME,
	buildContext,
	createProviderAgent,
	getSubmitTurnTool,
	isNormalizationError,
	normalizeToolCall,
} from "../src/index";
import type { CompleteFn, ProviderAgentDeps, ProviderRegistry } from "../src/index";

// ---- Fixtures ----

const TEST_AGENT_ID = "agent-test-1" as AgentId;
const TEST_TURN_ID = "turn-test-1" as TurnId;
const TEST_ISSUE_ID = "issue-aaaa-bbbb-cccc-dddd" as IssueId;

function buildTestSpec(overrides?: Partial<AgentSpec>): AgentSpec {
	return {
		agentId: TEST_AGENT_ID,
		persona: "test-persona",
		modelSelection: { providerId: "openai", modelId: "gpt-4o-mini" },
		systemPromptRef: "inline:test",
		...overrides,
	};
}

function buildTestUsage(): Usage {
	return {
		input: 100,
		output: 50,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 150,
		cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
	};
}

function buildTestContextBundle(): ContextBundle {
	return {
		bundleId: "bundle-1",
		version: 1,
		createdAtMs: Date.now(),
		rootRef: "/project",
		sections: [
			{
				sectionId: "s1",
				kind: "agents_md",
				sourceRef: "/project/AGENTS.md",
				domainTags: ["all"],
				content: "# Test Project\nTest rules.",
				checksum: "abc123",
				staleness: { lastVerifiedAtMs: Date.now(), source: "explicit" },
			},
		],
	};
}

function buildTestMemoryView(overrides?: Partial<MemoryView>): MemoryView {
	return {
		systemPrompt: "You are a test deliberation agent.",
		contextBundle: buildTestContextBundle(),
		ledgerSummary: [],
		unresolvedIssueDetails: [],
		resolvedIssueSummaries: [],
		turnCounterMessage: "Turn 1/5",
		...overrides,
	};
}

function buildMockResponse(
	toolCallArgs: Record<string, unknown> | null,
	overrides?: Partial<AssistantMessage>,
): AssistantMessage {
	const content: AssistantMessage["content"] = toolCallArgs
		? [{ type: "toolCall", id: "call-1", name: SUBMIT_TURN_TOOL_NAME, arguments: toolCallArgs }]
		: [{ type: "text", text: "I have nothing to add." }];

	return {
		role: "assistant",
		content,
		api: "openai-completions",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: buildTestUsage(),
		stopReason: toolCallArgs ? "toolUse" : "stop",
		timestamp: Date.now(),
		...overrides,
	};
}

function createMockRegistry(): ProviderRegistry {
	return {
		resolveModel: () => ({
			piAiModel: {
				id: "gpt-4o-mini",
				name: "GPT-4o Mini",
				api: "openai-completions",
				provider: "openai",
				baseUrl: "https://api.openai.com/v1",
				reasoning: false,
				input: ["text"],
				cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
			} as Model<Api>,
			capability: {
				providerId: "openai",
				modelId: "gpt-4o-mini",
				supportsStrictSchemas: true,
				supportsStreamingToolArgs: true,
				supportsReasoning: false,
				maxContextWindowTokens: 128000,
			},
		}),
	};
}

function buildDeps(
	mockComplete: CompleteFn,
	roomKind: "domain" | "synthesis" | "query_back" = "domain",
): ProviderAgentDeps {
	return { registry: createMockRegistry(), complete: mockComplete, roomKind };
}

function validToolCallArgs(overrides?: Record<string, unknown>) {
	return {
		summary: "Found a performance issue",
		ledgerActions: [
			{
				kind: "create_issue",
				issueId: TEST_ISSUE_ID,
				title: "N+1 query problem",
				description: "The API has N+1 queries in the user list endpoint",
			},
		],
		controlActions: [],
		...overrides,
	};
}

// ---- Normalizer ----

describe("normalizeToolCall", () => {
	it("normalizes a valid create_issue action", () => {
		const result = normalizeToolCall({
			toolCall: {
				type: "toolCall",
				id: "c1",
				name: SUBMIT_TURN_TOOL_NAME,
				arguments: validToolCallArgs(),
			},
			turnId: TEST_TURN_ID,
			agentId: TEST_AGENT_ID,
			roundNumber: 1,
		});

		expect(isNormalizationError(result)).toBe(false);
		if (!isNormalizationError(result)) {
			expect(result.turnId).toBe(TEST_TURN_ID);
			expect(result.agentId).toBe(TEST_AGENT_ID);
			expect(result.roundNumber).toBe(1);
			expect(result.payload.summary).toBe("Found a performance issue");
			expect(result.payload.ledgerActions).toHaveLength(1);
			expect(result.payload.ledgerActions[0]?.kind).toBe("create_issue");
		}
	});

	it("normalizes multiple action types in one turn", () => {
		const result = normalizeToolCall({
			toolCall: {
				type: "toolCall",
				id: "c1",
				name: SUBMIT_TURN_TOOL_NAME,
				arguments: {
					summary: "Challenged and proposed",
					ledgerActions: [
						{
							kind: "challenge",
							targetIssueId: TEST_ISSUE_ID,
							argument: "Won't scale",
							evidence: "See benchmarks",
						},
						{
							kind: "propose_resolution",
							targetIssueId: TEST_ISSUE_ID,
							proposal: "Use event sourcing",
						},
					],
					controlActions: [],
				},
			},
			turnId: TEST_TURN_ID,
			agentId: TEST_AGENT_ID,
			roundNumber: 2,
		});

		expect(isNormalizationError(result)).toBe(false);
		if (!isNormalizationError(result)) {
			expect(result.payload.ledgerActions).toHaveLength(2);
			expect(result.payload.ledgerActions[0]?.kind).toBe("challenge");
			expect(result.payload.ledgerActions[1]?.kind).toBe("propose_resolution");
		}
	});

	it("normalizes propose_closure with control action", () => {
		const result = normalizeToolCall({
			toolCall: {
				type: "toolCall",
				id: "c1",
				name: SUBMIT_TURN_TOOL_NAME,
				arguments: {
					summary: "Closing",
					ledgerActions: [
						{
							kind: "propose_closure",
							targetIssueId: TEST_ISSUE_ID,
							rationale: "Consensus",
							closureType: "resolved",
						},
					],
					controlActions: [{ kind: "propose_room_closure" }],
				},
			},
			turnId: TEST_TURN_ID,
			agentId: TEST_AGENT_ID,
			roundNumber: 3,
		});

		expect(isNormalizationError(result)).toBe(false);
		if (!isNormalizationError(result)) {
			const action = result.payload.ledgerActions[0];
			expect(action?.kind).toBe("propose_closure");
			if (action?.kind === "propose_closure") {
				expect(action.closureType).toBe("resolved");
			}
			expect(result.payload.controlActions).toHaveLength(1);
			expect(result.payload.controlActions[0]?.kind).toBe("propose_room_closure");
		}
	});

	it("normalizes all 8 action kinds", () => {
		const fixtures: Record<string, Record<string, unknown>> = {
			create_issue: { issueId: TEST_ISSUE_ID, title: "t", description: "d" },
			challenge: { targetIssueId: TEST_ISSUE_ID, argument: "a" },
			propose_resolution: { targetIssueId: TEST_ISSUE_ID, proposal: "p" },
			propose_closure: { targetIssueId: TEST_ISSUE_ID, rationale: "r", closureType: "resolved" },
			reopen_issue: { targetIssueId: TEST_ISSUE_ID, reason: "r" },
			request_context: { description: "d", justification: "j" },
			record_decision: { decision: "d", rationale: "r" },
			link_issues: { sourceId: TEST_ISSUE_ID, targetId: "issue-2", relation: "blocks" },
		};

		for (const [kind, fields] of Object.entries(fixtures)) {
			const result = normalizeToolCall({
				toolCall: {
					type: "toolCall",
					id: "c1",
					name: SUBMIT_TURN_TOOL_NAME,
					arguments: {
						summary: `Testing ${kind}`,
						ledgerActions: [{ kind, ...fields }],
						controlActions: [],
					},
				},
				turnId: TEST_TURN_ID,
				agentId: TEST_AGENT_ID,
				roundNumber: 1,
			});
			expect(isNormalizationError(result), `Failed for kind: ${kind}`).toBe(false);
			if (!isNormalizationError(result)) {
				expect(result.payload.ledgerActions[0]?.kind).toBe(kind);
			}
		}
	});

	it("rejects unknown tool name", () => {
		const result = normalizeToolCall({
			toolCall: { type: "toolCall", id: "c1", name: "wrong", arguments: {} },
			turnId: TEST_TURN_ID,
			agentId: TEST_AGENT_ID,
			roundNumber: 1,
		});
		expect(isNormalizationError(result)).toBe(true);
		if (isNormalizationError(result)) {
			expect(result.code).toBe("unknown_tool");
		}
	});

	it("rejects missing summary", () => {
		const result = normalizeToolCall({
			toolCall: {
				type: "toolCall",
				id: "c1",
				name: SUBMIT_TURN_TOOL_NAME,
				arguments: { ledgerActions: [], controlActions: [] },
			},
			turnId: TEST_TURN_ID,
			agentId: TEST_AGENT_ID,
			roundNumber: 1,
		});
		expect(isNormalizationError(result)).toBe(true);
		if (isNormalizationError(result)) {
			expect(result.code).toBe("missing_required_field");
		}
	});

	it("rejects missing ledgerActions", () => {
		const result = normalizeToolCall({
			toolCall: {
				type: "toolCall",
				id: "c1",
				name: SUBMIT_TURN_TOOL_NAME,
				arguments: { summary: "test" },
			},
			turnId: TEST_TURN_ID,
			agentId: TEST_AGENT_ID,
			roundNumber: 1,
		});
		expect(isNormalizationError(result)).toBe(true);
		if (isNormalizationError(result)) {
			expect(result.code).toBe("missing_required_field");
		}
	});
});

// ---- Prompt builder ----

describe("buildContext", () => {
	it("builds a valid pi-ai Context from MemoryView", () => {
		const ctx = buildContext(buildTestMemoryView(), "domain");
		expect(ctx.systemPrompt).toContain("You are a test deliberation agent.");
		expect(ctx.systemPrompt).toContain("Test Project");
		expect(ctx.messages).toHaveLength(1);
		expect(ctx.messages[0]?.role).toBe("user");
		expect(ctx.tools).toHaveLength(1);
		expect(ctx.tools?.[0]?.name).toBe(SUBMIT_TURN_TOOL_NAME);
	});

	it("includes turn counter in user message", () => {
		const ctx = buildContext(buildTestMemoryView({ turnCounterMessage: "Turn 3/10" }), "domain");
		const msg = ctx.messages[0];
		if (msg?.role === "user") {
			expect(typeof msg.content === "string" ? msg.content : "").toContain("Turn 3/10");
		}
	});

	it("includes ledger summary when issues exist", () => {
		const ctx = buildContext(
			buildTestMemoryView({
				ledgerSummary: [{ issueId: TEST_ISSUE_ID, title: "Cache invalidation", state: "open" }],
			}),
			"domain",
		);
		const msg = ctx.messages[0];
		if (msg?.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : "";
			expect(text).toContain("Cache invalidation");
			expect(text).toContain("open");
		}
	});

	it("shows placeholder when no issues exist", () => {
		const ctx = buildContext(buildTestMemoryView(), "domain");
		const msg = ctx.messages[0];
		if (msg?.role === "user") {
			expect(typeof msg.content === "string" ? msg.content : "").toContain("No issues raised yet");
		}
	});

	it("includes staleness metadata in system prompt", () => {
		const ctx = buildContext(buildTestMemoryView(), "domain");
		expect(ctx.systemPrompt).toContain("Staleness:");
		expect(ctx.systemPrompt).toContain("explicit");
	});
});

// ---- Provider agent ----

describe("createProviderAgent", () => {
	it("produces valid AgentTurnOutput from mock provider", async () => {
		const mockComplete: CompleteFn = vi
			.fn()
			.mockResolvedValue(buildMockResponse(validToolCallArgs()));
		const agent = createProviderAgent(buildTestSpec(), buildDeps(mockComplete));

		const output = await agent.takeTurn({
			turnId: TEST_TURN_ID,
			roundNumber: 1,
			memoryView: buildTestMemoryView(),
			contextBundle: buildTestContextBundle(),
		});

		expect(output.turnId).toBe(TEST_TURN_ID);
		expect(output.agentId).toBe(TEST_AGENT_ID);
		expect(output.parsedTurn).not.toBeNull();
		expect(output.parsedTurn?.payload.ledgerActions).toHaveLength(1);
		expect(output.parsedTurn?.payload.ledgerActions[0]?.kind).toBe("create_issue");
		expect(output.usage?.inputTokens).toBe(100);
		expect(output.timing.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("returns null parsedTurn when model skips tool call", async () => {
		const mockComplete: CompleteFn = vi.fn().mockResolvedValue(buildMockResponse(null));
		const agent = createProviderAgent(buildTestSpec(), buildDeps(mockComplete));

		const output = await agent.takeTurn({
			turnId: TEST_TURN_ID,
			roundNumber: 1,
			memoryView: buildTestMemoryView(),
			contextBundle: buildTestContextBundle(),
		});

		expect(output.parsedTurn).toBeNull();
	});

	it("retries once on invalid tool args then succeeds", async () => {
		const invalid = buildMockResponse({ ledgerActions: [{ kind: "create_issue", title: "t" }] });
		const valid = buildMockResponse(validToolCallArgs({ summary: "Fixed" }));

		const mockComplete: CompleteFn = vi
			.fn()
			.mockResolvedValueOnce(invalid)
			.mockResolvedValueOnce(valid);
		const agent = createProviderAgent(buildTestSpec(), buildDeps(mockComplete));

		const output = await agent.takeTurn({
			turnId: TEST_TURN_ID,
			roundNumber: 1,
			memoryView: buildTestMemoryView(),
			contextBundle: buildTestContextBundle(),
		});

		expect(mockComplete).toHaveBeenCalledTimes(2);
		expect(output.parsedTurn).not.toBeNull();
	});

	it("propagates provider errors", async () => {
		const mockComplete: CompleteFn = vi
			.fn()
			.mockResolvedValue(
				buildMockResponse(null, { stopReason: "error", errorMessage: "Rate limited" }),
			);
		const agent = createProviderAgent(buildTestSpec(), buildDeps(mockComplete));

		await expect(
			agent.takeTurn({
				turnId: TEST_TURN_ID,
				roundNumber: 1,
				memoryView: buildTestMemoryView(),
				contextBundle: buildTestContextBundle(),
			}),
		).rejects.toThrow("Rate limited");
	});

	it("throws on retry provider error instead of misclassifying", async () => {
		const invalid = buildMockResponse({ ledgerActions: [{ kind: "create_issue", title: "t" }] });
		const retryError = buildMockResponse(null, {
			stopReason: "error",
			errorMessage: "Service unavailable",
		});

		const mockComplete: CompleteFn = vi
			.fn()
			.mockResolvedValueOnce(invalid)
			.mockResolvedValueOnce(retryError);
		const agent = createProviderAgent(buildTestSpec(), buildDeps(mockComplete));

		await expect(
			agent.takeTurn({
				turnId: TEST_TURN_ID,
				roundNumber: 1,
				memoryView: buildTestMemoryView(),
				contextBundle: buildTestContextBundle(),
			}),
		).rejects.toThrow("Service unavailable");
	});

	it("handles record_decision with optional targetIssueId", async () => {
		const mockComplete: CompleteFn = vi.fn().mockResolvedValue(
			buildMockResponse({
				summary: "Decision",
				ledgerActions: [
					{
						kind: "record_decision",
						decision: "Use PostgreSQL",
						rationale: "Mature",
						rejectedAlternatives: ["MongoDB"],
					},
				],
				controlActions: [],
			}),
		);
		const agent = createProviderAgent(buildTestSpec(), buildDeps(mockComplete));

		const output = await agent.takeTurn({
			turnId: TEST_TURN_ID,
			roundNumber: 1,
			memoryView: buildTestMemoryView(),
			contextBundle: buildTestContextBundle(),
		});

		const action = output.parsedTurn?.payload.ledgerActions[0];
		expect(action?.kind).toBe("record_decision");
		if (action?.kind === "record_decision") {
			expect(action.targetIssueId).toBeUndefined();
			expect(action.rejectedAlternatives).toEqual(["MongoDB"]);
		}
	});

	it("handles synthesis room with query_room", async () => {
		const mockComplete: CompleteFn = vi.fn().mockResolvedValue(
			buildMockResponse({
				summary: "Need info",
				ledgerActions: [
					{ kind: "request_context", description: "API docs", justification: "Required" },
				],
				controlActions: [
					{
						kind: "query_room",
						targetRoomId: "room-1",
						question: "Rate limits?",
						relevantIssueIds: [TEST_ISSUE_ID],
					},
				],
			}),
		);
		const agent = createProviderAgent(buildTestSpec(), buildDeps(mockComplete, "synthesis"));

		const output = await agent.takeTurn({
			turnId: TEST_TURN_ID,
			roundNumber: 1,
			memoryView: buildTestMemoryView(),
			contextBundle: buildTestContextBundle(),
		});

		expect(output.parsedTurn?.payload.controlActions).toHaveLength(1);
		const ctrl = output.parsedTurn?.payload.controlActions[0];
		if (ctrl?.kind === "query_room") {
			expect(ctrl.targetRoomId).toBe("room-1");
		}
	});
});

// ---- Room-kind tool schema ----

describe("getSubmitTurnTool", () => {
	it("domain tool excludes query_room", () => {
		expect(JSON.stringify(getSubmitTurnTool("domain").parameters)).not.toContain("query_room");
	});

	it("synthesis tool includes query_room", () => {
		expect(JSON.stringify(getSubmitTurnTool("synthesis").parameters)).toContain("query_room");
	});

	it("query_back tool excludes query_room", () => {
		expect(JSON.stringify(getSubmitTurnTool("query_back").parameters)).not.toContain("query_room");
	});
});

describe("buildContext room-kind filtering", () => {
	it("domain context excludes query_room from tool", () => {
		expect(JSON.stringify(buildContext(buildTestMemoryView(), "domain").tools)).not.toContain(
			"query_room",
		);
	});

	it("synthesis context includes query_room in tool", () => {
		expect(JSON.stringify(buildContext(buildTestMemoryView(), "synthesis").tools)).toContain(
			"query_room",
		);
	});
});

// ---- Persona injection ----

describe("persona injection", () => {
	it("injects persona into system prompt", async () => {
		let capturedContext: Context | undefined;
		const mockComplete: CompleteFn = vi.fn().mockImplementation((_model, ctx) => {
			capturedContext = ctx as Context;
			return Promise.resolve(buildMockResponse(validToolCallArgs()));
		});

		const agent = createProviderAgent(
			buildTestSpec({ persona: "security" }),
			buildDeps(mockComplete),
		);
		await agent.takeTurn({
			turnId: TEST_TURN_ID,
			roundNumber: 1,
			memoryView: buildTestMemoryView(),
			contextBundle: buildTestContextBundle(),
		});

		expect(capturedContext?.systemPrompt).toContain("security");
		expect(capturedContext?.systemPrompt).toContain("Your Role");
	});

	it("leaves system prompt unchanged when persona is empty", async () => {
		let capturedContext: Context | undefined;
		const mockComplete: CompleteFn = vi.fn().mockImplementation((_model, ctx) => {
			capturedContext = ctx as Context;
			return Promise.resolve(buildMockResponse(validToolCallArgs()));
		});

		const agent = createProviderAgent(buildTestSpec({ persona: "" }), buildDeps(mockComplete));
		await agent.takeTurn({
			turnId: TEST_TURN_ID,
			roundNumber: 1,
			memoryView: buildTestMemoryView(),
			contextBundle: buildTestContextBundle(),
		});

		expect(capturedContext?.systemPrompt).not.toContain("Your Role");
	});
});

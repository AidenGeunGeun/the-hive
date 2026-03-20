import type {
	AgentId,
	ContextBundle,
	IssueId,
	LedgerEntry,
	ParsedTurn,
	RoomKind,
	RoomSpec,
	SubmitTurnPayload,
} from "@the-hive/protocol/engine";
import { describe, expect, it } from "vitest";

import {
	EchoAgent,
	FaultyAgent,
	type RoomRuntimeState,
	ScriptedAgent,
	applyTurnToLedger,
	evaluateStop,
	finalizeReadyClosures,
	projectClosureProposals,
	projectIssueStates,
	renderDomainReport,
	renderSynthesisProposal,
	runRoom,
	unresolvedIssueScopedMemoryPolicy,
	validateParsedTurn,
} from "../src/index";

function asAgentId(value: string): AgentId {
	return value as AgentId;
}

function asIssueId(value: string): IssueId {
	return value as IssueId;
}

function createContextBundle(): ContextBundle {
	return {
		bundleId: "bundle-1",
		version: 1,
		createdAtMs: 1,
		rootRef: "/tmp/context",
		sections: [],
	};
}

function createRoomSpec<K extends RoomKind>(
	kind: K,
	maxRounds = 3,
	minHealthyAgents = 1,
): RoomSpec<K> {
	return {
		roomId: `room:${kind}` as RoomSpec<K>["roomId"],
		kind,
		agentSpecs: [],
		maxRounds,
		minHealthyAgents,
		policies: {
			turnPolicy: "roundRobinTurnPolicy",
			stopPolicy: "noOpenObjectionStopPolicy",
			memoryPolicy: "unresolvedIssueScopedMemoryPolicy",
			failurePolicy: "retryOnceThenFailFailurePolicy",
			artifactPolicy: kind === "synthesis" ? "synthesisArtifactPolicy" : "domainArtifactPolicy",
		},
	};
}

function createPayload<K extends RoomKind = RoomKind>(
	overrides: Partial<SubmitTurnPayload<K>> = {},
): SubmitTurnPayload<K> {
	return {
		summary: "summary",
		ledgerActions: [],
		controlActions: [],
		...overrides,
	};
}

function createParsedTurn<K extends RoomKind = RoomKind>(
	agentId: AgentId,
	payload: SubmitTurnPayload<K>,
	roundNumber = 1,
): ParsedTurn<K> {
	return {
		turnId: `turn:${agentId}:${roundNumber}` as ParsedTurn<K>["turnId"],
		agentId,
		roundNumber,
		payload,
		timestamp: roundNumber * 100,
	};
}

function buildState<K extends RoomKind>(
	kind: K,
	entries: Parameters<typeof projectIssueStates>[0] = [],
	options: Partial<
		Pick<RoomRuntimeState<K>, "currentRound" | "maxRounds" | "minHealthyAgents">
	> = {},
): RoomRuntimeState<K> {
	const agentIds = [asAgentId("agent:a"), asAgentId("agent:b"), asAgentId("agent:c")];
	return finalizeReadyClosures({
		roomId: `room:${kind}` as RoomRuntimeState<K>["roomId"],
		kind,
		ledgerVersion: entries.length,
		ledgerEntries: entries,
		turnTraces: [],
		currentRound: options.currentRound ?? 1,
		maxRounds: options.maxRounds ?? 3,
		activeAgents: agentIds,
		failedAgents: [],
		activeAgentIds: agentIds,
		failedAgentIds: [],
		pendingObjectionsByIssue: new Map(),
		minHealthyAgents: options.minHealthyAgents ?? 1,
		issueProjection: projectIssueStates(entries),
		closureProposals: projectClosureProposals(entries),
		seq: entries.length + 1,
	});
}

describe("room kernel", () => {
	it("produces deterministic ledger entries and traces for scripted agents", async () => {
		const issueId = asIssueId("issue:deterministic");
		const agentsFactory = () => [
			new ScriptedAgent({
				agentId: asAgentId("agent:a"),
				turns: [
					createPayload({
						ledgerActions: [
							{
								kind: "create_issue",
								issueId,
								title: "Cache invalidation",
								description: "Need a cache strategy",
							},
						],
					}),
					null,
				],
			}),
			new ScriptedAgent({
				agentId: asAgentId("agent:b"),
				turns: [
					createPayload({
						ledgerActions: [
							{
								kind: "propose_resolution",
								targetIssueId: issueId,
								proposal: "Use tagged invalidation",
							},
						],
					}),
					createPayload({
						ledgerActions: [
							{
								kind: "propose_closure",
								targetIssueId: issueId,
								rationale: "Strategy agreed",
								closureType: "resolved",
							},
						],
					}),
				],
			}),
		];

		const firstRun = await runRoom({
			spec: createRoomSpec("domain"),
			agents: agentsFactory(),
			contextBundle: createContextBundle(),
			systemPrompt: "You are a domain reviewer.",
		});
		const secondRun = await runRoom({
			spec: createRoomSpec("domain"),
			agents: agentsFactory(),
			contextBundle: createContextBundle(),
			systemPrompt: "You are a domain reviewer.",
		});

		expect(JSON.stringify(firstRun.ledgerEntries)).toBe(JSON.stringify(secondRun.ledgerEntries));
		expect(JSON.stringify(firstRun.turnTraces)).toBe(JSON.stringify(secondRun.turnTraces));
	});

	it("records valid turns into the ledger and traces", async () => {
		const issueId = asIssueId("issue:lifecycle");
		const result = await runRoom({
			spec: createRoomSpec("domain", 1),
			agents: [
				new EchoAgent({
					agentId: asAgentId("agent:a"),
					payload: createPayload({
						ledgerActions: [
							{
								kind: "create_issue",
								issueId,
								title: "API edge case",
								description: "Need a fallback.",
							},
						],
					}),
				}),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.ledgerEntries).toHaveLength(1);
		expect(result.turnTraces).toHaveLength(1);
		expect(result.ledgerEntries[0]?.action.kind).toBe("create_issue");
	});

	it("echo agents return the same payload on every turn", async () => {
		const agent = new EchoAgent({
			agentId: asAgentId("agent:echo"),
			payload: createPayload({
				ledgerActions: [
					{
						kind: "request_context",
						description: "Need throughput data",
						justification: "Sizing depends on it",
					},
				],
			}),
		});
		const firstTurn = await agent.takeTurn({
			turnId: "turn:echo:1" as never,
			roundNumber: 1,
			memoryView: unresolvedIssueScopedMemoryPolicy(
				buildState("domain"),
				"system",
				createContextBundle(),
			),
			contextBundle: createContextBundle(),
		});
		const secondTurn = await agent.takeTurn({
			turnId: "turn:echo:2" as never,
			roundNumber: 2,
			memoryView: unresolvedIssueScopedMemoryPolicy(
				buildState("domain"),
				"system",
				createContextBundle(),
			),
			contextBundle: createContextBundle(),
		});

		expect(firstTurn.parsedTurn?.payload).toEqual(secondTurn.parsedTurn?.payload);
	});

	it("records null parsed turns without creating ledger entries", async () => {
		const result = await runRoom({
			spec: createRoomSpec("domain"),
			agents: [new ScriptedAgent({ agentId: asAgentId("agent:a"), turns: [null] })],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.ledgerEntries).toHaveLength(0);
		expect(result.turnTraces).toHaveLength(1);
		expect(result.turnTraces[0]?.parsedTurn).toBeNull();
	});

	it("retries once after an agent error and succeeds on retry", async () => {
		const result = await runRoom({
			spec: createRoomSpec("domain"),
			agents: [
				new FaultyAgent({
					agentId: asAgentId("agent:a"),
					throwOnCalls: [1],
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "request_context",
									description: "Need schema docs",
									justification: "Cannot assess constraints",
								},
							],
						}),
					],
				}),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.ledgerEntries).toHaveLength(1);
		expect(result.health.failedAgents).toBe(0);
	});

	it("marks an agent failed after two errors and stops below quorum", async () => {
		const result = await runRoom({
			spec: createRoomSpec("domain", 3, 1),
			agents: [
				new FaultyAgent({
					agentId: asAgentId("agent:a"),
					throwOnCalls: [1, 2],
					turns: [],
				}),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.outcome).toBe("inconclusive");
		expect(result.health.failedAgents).toBe(1);
		expect(result.turnTraces).toHaveLength(1);
	});

	it("tracks multiple agent failures cumulatively", async () => {
		const result = await runRoom({
			spec: createRoomSpec("domain", 1, 1),
			agents: [
				new FaultyAgent({ agentId: asAgentId("agent:a"), throwOnCalls: [1, 2], turns: [] }),
				new FaultyAgent({ agentId: asAgentId("agent:b"), throwOnCalls: [1, 2], turns: [] }),
				new ScriptedAgent({ agentId: asAgentId("agent:c"), turns: [null] }),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.health.failedAgents).toBe(2);
		expect(result.health.activeAgents).toBe(1);
	});

	it("runs an end-to-end three-agent room to completion", async () => {
		const issueId = asIssueId("issue:integration");
		const traces: string[] = [];
		const result = await runRoom({
			spec: createRoomSpec("domain", 3, 1),
			agents: [
				new ScriptedAgent({
					agentId: asAgentId("agent:create"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "create_issue",
									issueId,
									title: "Queue strategy",
									description: "Need bounded retries",
								},
							],
						}),
						null,
					],
				}),
				new ScriptedAgent({
					agentId: asAgentId("agent:challenge"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "challenge",
									targetIssueId: issueId,
									argument: "Retries can cascade",
								},
							],
						}),
						null,
					],
				}),
				new ScriptedAgent({
					agentId: asAgentId("agent:resolve"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "propose_resolution",
									targetIssueId: issueId,
									proposal: "Use exponential backoff with a dead letter queue",
								},
							],
						}),
						createPayload({
							ledgerActions: [
								{
									kind: "propose_closure",
									targetIssueId: issueId,
									rationale: "Mitigation accepted",
									closureType: "resolved",
								},
							],
						}),
					],
				}),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
			onTurnComplete: (trace) => traces.push(String(trace.turnId)),
		});

		const projection = projectIssueStates(result.ledgerEntries);
		expect(result.outcome).toBe("completed");
		expect(result.renderedArtifact?.kind).toBe("report_markdown");
		expect(result.turnTraces).toHaveLength(9);
		expect(traces).toHaveLength(9);
		expect(result.renderedArtifact?.content).toContain("Queue strategy (resolved)");
		expect(projection.issues.get(issueId)?.state).toBe("closure_proposed");
	});
});

describe("semantic validation and ledger projection", () => {
	it("rejects a challenge for a nonexistent issue", () => {
		const state = buildState("domain");
		const turn = createParsedTurn(
			asAgentId("agent:a"),
			createPayload({
				ledgerActions: [
					{
						kind: "challenge",
						targetIssueId: asIssueId("issue:missing"),
						argument: "Missing issue",
					},
				],
			}),
		);

		expect(validateParsedTurn(turn, state).valid).toBe(false);
	});

	it("rejects self-links", () => {
		const issueId = asIssueId("issue:self");
		const state = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId,
					title: "Self link",
					description: "desc",
				},
				timestamp: 1,
			},
		]);
		const turn = createParsedTurn(
			asAgentId("agent:b"),
			createPayload({
				ledgerActions: [
					{
						kind: "link_issues",
						sourceId: issueId,
						targetId: issueId,
						relation: "depends_on",
					},
				],
			}),
		);

		expect(validateParsedTurn(turn, state).valid).toBe(false);
	});

	it("rejects query_room in domain rooms and accepts it in synthesis rooms", () => {
		const queryAction = {
			kind: "query_room",
			targetRoomId: "room:target" as never,
			question: "Can backend clarify this?",
			relevantIssueIds: [],
		} as const;
		const domainTurn = createParsedTurn(
			asAgentId("agent:a"),
			createPayload<RoomKind>({ controlActions: [queryAction] }),
		);
		const synthesisTurn = createParsedTurn(
			asAgentId("agent:a"),
			createPayload<RoomKind>({ controlActions: [queryAction] }),
		);

		expect(validateParsedTurn(domainTurn, buildState("domain")).valid).toBe(false);
		expect(validateParsedTurn(synthesisTurn, buildState("synthesis")).valid).toBe(true);
	});

	it("partially accepts valid actions and rejects invalid ones in the same turn", () => {
		const issueId = asIssueId("issue:partial");
		const state = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId,
					title: "Partial",
					description: "desc",
				},
				timestamp: 1,
			},
		]);
		const turn = createParsedTurn(
			asAgentId("agent:b"),
			createPayload({
				ledgerActions: [
					{
						kind: "propose_resolution",
						targetIssueId: issueId,
						proposal: "Add retries",
					},
					{
						kind: "challenge",
						targetIssueId: asIssueId("issue:missing"),
						argument: "Invalid",
					},
					{
						kind: "record_decision",
						decision: "Use backoff",
						rationale: "Stable",
						targetIssueId: issueId,
					},
				],
			}),
		);

		const validation = validateParsedTurn(turn, state);
		const sanitizedTurn: typeof turn = {
			...turn,
			payload: {
				...turn.payload,
				ledgerActions: validation.validActions,
			},
		};
		const delta = applyTurnToLedger(state, sanitizedTurn);

		expect(validation.valid).toBe(false);
		expect(validation.validActions).toHaveLength(2);
		expect(delta.newEntries).toHaveLength(2);
	});

	it("suppresses duplicate issue titles with case and whitespace normalization", async () => {
		const firstId = asIssueId("issue:one");
		const secondId = asIssueId("issue:two");
		const result = await runRoom({
			spec: createRoomSpec("domain"),
			agents: [
				new ScriptedAgent({
					agentId: asAgentId("agent:a"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "create_issue",
									issueId: firstId,
									title: "Cache Policy",
									description: "desc",
								},
							],
						}),
					],
				}),
				new ScriptedAgent({
					agentId: asAgentId("agent:b"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "create_issue",
									issueId: secondId,
									title: "  cache   policy  ",
									description: "duplicate",
								},
							],
						}),
					],
				}),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.ledgerEntries).toHaveLength(1);
		expect(result.ledgerEntries[0]?.action.kind).toBe("create_issue");
	});

	it("allows different issue titles to coexist", async () => {
		const result = await runRoom({
			spec: createRoomSpec("domain"),
			agents: [
				new ScriptedAgent({
					agentId: asAgentId("agent:a"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "create_issue",
									issueId: asIssueId("issue:left"),
									title: "Left",
									description: "desc",
								},
							],
						}),
					],
				}),
				new ScriptedAgent({
					agentId: asAgentId("agent:b"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "create_issue",
									issueId: asIssueId("issue:right"),
									title: "Right",
									description: "desc",
								},
							],
						}),
					],
				}),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.ledgerEntries).toHaveLength(2);
	});
});

describe("closure and reopen semantics", () => {
	it("marks closure proposals as pending until the objection window is cleared", () => {
		const issueId = asIssueId("issue:close");
		const initialState = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId,
					title: "Close me",
					description: "desc",
				},
				timestamp: 1,
			},
		]);
		const delta = applyTurnToLedger(
			initialState,
			createParsedTurn(
				asAgentId("agent:b"),
				createPayload({
					ledgerActions: [
						{
							kind: "propose_closure",
							targetIssueId: issueId,
							rationale: "Done",
							closureType: "resolved",
						},
					],
				}),
			),
		);

		expect(delta.updatedProjection.issues.get(issueId)?.state).toBe("closure_proposed");
		expect(
			finalizeReadyClosures({
				...initialState,
				issueProjection: delta.updatedProjection,
				closureProposals: delta.updatedClosureProposals,
			}).issueProjection.issues.get(issueId)?.state,
		).toBe("resolved");
	});

	it("voids pending closure proposals when challenged", () => {
		const issueId = asIssueId("issue:challenge");
		const state = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId,
					title: "Pending closure",
					description: "desc",
				},
				timestamp: 1,
			},
			{
				seq: 2,
				turnId: "turn:2" as never,
				agentId: asAgentId("agent:b"),
				action: {
					kind: "propose_closure",
					targetIssueId: issueId,
					rationale: "Ready",
					closureType: "resolved",
				},
				timestamp: 2,
			},
		]);
		const delta = applyTurnToLedger(
			state,
			createParsedTurn(
				asAgentId("agent:c"),
				createPayload({
					ledgerActions: [
						{
							kind: "challenge",
							targetIssueId: issueId,
							argument: "Not done",
						},
					],
				}),
			),
		);

		expect(delta.updatedProjection.issues.get(issueId)?.state).toBe("challenged");
		expect(
			delta.updatedClosureProposals.some(
				(proposal) => proposal.issueId === issueId && proposal.voided,
			),
		).toBe(true);
	});

	it("rejects repeated identical closure proposals and closure on terminal issues", () => {
		const issueId = asIssueId("issue:repeat-close");
		const state = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId,
					title: "Repeat close",
					description: "desc",
				},
				timestamp: 1,
			},
			{
				seq: 2,
				turnId: "turn:2" as never,
				agentId: asAgentId("agent:b"),
				action: {
					kind: "propose_closure",
					targetIssueId: issueId,
					rationale: "Ready",
					closureType: "resolved",
				},
				timestamp: 2,
			},
		]);
		const repeated = validateParsedTurn(
			createParsedTurn(
				asAgentId("agent:c"),
				createPayload({
					ledgerActions: [
						{
							kind: "propose_closure",
							targetIssueId: issueId,
							rationale: "Ready",
							closureType: "resolved",
						},
					],
				}),
			),
			state,
		);

		expect(repeated.valid).toBe(false);
		expect(repeated.errors[0]?.code).toBe("issue_already_terminal");
	});

	it("reopens terminal issues and rejects reopening open issues", () => {
		const issueId = asIssueId("issue:reopen");
		const resolvedState = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId,
					title: "Reopen",
					description: "desc",
				},
				timestamp: 1,
			},
			{
				seq: 2,
				turnId: "turn:2" as never,
				agentId: asAgentId("agent:b"),
				action: {
					kind: "propose_closure",
					targetIssueId: issueId,
					rationale: "Resolved",
					closureType: "resolved",
				},
				timestamp: 2,
			},
		]);
		const reopenDelta = applyTurnToLedger(
			resolvedState,
			createParsedTurn(
				asAgentId("agent:c"),
				createPayload({
					ledgerActions: [
						{
							kind: "reopen_issue",
							targetIssueId: issueId,
							reason: "New information",
						},
					],
				}),
			),
		);

		expect(reopenDelta.updatedProjection.issues.get(issueId)?.state).toBe("open");

		const openState = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId: asIssueId("issue:open"),
					title: "Open",
					description: "desc",
				},
				timestamp: 1,
			},
		]);
		const invalidReopen = validateParsedTurn(
			createParsedTurn(
				asAgentId("agent:b"),
				createPayload({
					ledgerActions: [
						{
							kind: "reopen_issue",
							targetIssueId: asIssueId("issue:open"),
							reason: "Already open",
						},
					],
				}),
			),
			openState,
		);

		expect(invalidReopen.valid).toBe(false);
	});
});

describe("memory, stop, and artifact policies", () => {
	it("includes unresolved issue details, resolved summaries, and turn counter text", () => {
		const openIssueId = asIssueId("issue:open-memory");
		const resolvedIssueId = asIssueId("issue:resolved-memory");
		const state = buildState(
			"domain",
			[
				{
					seq: 1,
					turnId: "turn:1" as never,
					agentId: asAgentId("agent:a"),
					action: {
						kind: "create_issue",
						issueId: openIssueId,
						title: "Open issue",
						description: "needs discussion",
					},
					timestamp: 1,
				},
				{
					seq: 2,
					turnId: "turn:2" as never,
					agentId: asAgentId("agent:a"),
					action: {
						kind: "create_issue",
						issueId: resolvedIssueId,
						title: "Resolved issue",
						description: "already solved",
					},
					timestamp: 2,
				},
				{
					seq: 3,
					turnId: "turn:3" as never,
					agentId: asAgentId("agent:b"),
					action: {
						kind: "propose_closure",
						targetIssueId: resolvedIssueId,
						rationale: "done",
						closureType: "resolved",
					},
					timestamp: 3,
				},
			],
			{ currentRound: 2, maxRounds: 4 },
		);

		const memory = unresolvedIssueScopedMemoryPolicy(state, "system prompt", createContextBundle());

		expect(memory.unresolvedIssueDetails.map((detail) => detail.issueId)).toContain(openIssueId);
		expect(memory.resolvedIssueSummaries.map((detail) => detail.issueId)).toContain(
			resolvedIssueId,
		);
		expect(memory.turnCounterMessage).toBe("Turn 2/4");
	});

	it("stops when all issues are resolved, on max rounds, and continues when unresolved issues remain", () => {
		const resolvedIssueId = asIssueId("issue:resolved-stop");
		const unresolvedIssueId = asIssueId("issue:open-stop");

		const resolvedState = buildState("domain", [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId: resolvedIssueId,
					title: "Resolved",
					description: "desc",
				},
				timestamp: 1,
			},
			{
				seq: 2,
				turnId: "turn:2" as never,
				agentId: asAgentId("agent:b"),
				action: {
					kind: "propose_closure",
					targetIssueId: resolvedIssueId,
					rationale: "done",
					closureType: "resolved",
				},
				timestamp: 2,
			},
		]);

		expect(evaluateStop(resolvedState).reason).toBe("all_resolved");
		expect(
			evaluateStop(
				buildState(
					"domain",
					[
						{
							seq: 1,
							turnId: "turn:max" as never,
							agentId: asAgentId("agent:a"),
							action: {
								kind: "create_issue",
								issueId: unresolvedIssueId,
								title: "Still open",
								description: "desc",
							},
							timestamp: 1,
						},
					],
					{ currentRound: 3, maxRounds: 3 },
				),
			).reason,
		).toBe("max_rounds");
		expect(
			evaluateStop(
				buildState("domain", [
					{
						seq: 1,
						turnId: "turn:1" as never,
						agentId: asAgentId("agent:a"),
						action: {
							kind: "create_issue",
							issueId: unresolvedIssueId,
							title: "Unresolved",
							description: "desc",
						},
						timestamp: 1,
					},
				]),
			).reason,
		).toBe("continue");
	});

	it("completes successfully when issues resolve on the final round", async () => {
		const issueId = asIssueId("issue:last-round");
		const result = await runRoom({
			spec: createRoomSpec("domain", 2),
			agents: [
				new ScriptedAgent({
					agentId: asAgentId("agent:a"),
					turns: [
						createPayload({
							ledgerActions: [
								{
									kind: "create_issue",
									issueId,
									title: "Final round",
									description: "desc",
								},
							],
						}),
						createPayload({
							ledgerActions: [
								{
									kind: "propose_closure",
									targetIssueId: issueId,
									rationale: "Done at the deadline",
									closureType: "resolved",
								},
							],
						}),
					],
				}),
			],
			contextBundle: createContextBundle(),
			systemPrompt: "system",
		});

		expect(result.outcome).toBe("completed");
	});

	it("renders domain reports and synthesis proposals with the required sections", () => {
		const issueId = asIssueId("issue:artifact");
		const entries: readonly LedgerEntry[] = [
			{
				seq: 1,
				turnId: "turn:1" as never,
				agentId: asAgentId("agent:a"),
				action: {
					kind: "create_issue",
					issueId,
					title: "Artifact issue",
					description: "desc",
				},
				timestamp: 1,
			},
			{
				seq: 2,
				turnId: "turn:2" as never,
				agentId: asAgentId("agent:b"),
				action: {
					kind: "record_decision",
					targetIssueId: issueId,
					decision: "Ship a bounded queue",
					rationale: "Keeps throughput stable",
				},
				timestamp: 2,
			},
			{
				seq: 3,
				turnId: "turn:3" as never,
				agentId: asAgentId("agent:c"),
				action: {
					kind: "request_context",
					description: "Need traffic profile",
					justification: "Sizing depends on it",
				},
				timestamp: 3,
			},
		];

		const domainArtifact = renderDomainReport(entries);
		const synthesisArtifact = renderSynthesisProposal(entries);

		expect(domainArtifact.content).toContain("## Unresolved Issues");
		expect(domainArtifact.content).toContain("## Context Gaps");
		expect(synthesisArtifact.content).toContain("## Proposal");
		expect(synthesisArtifact.content).toContain("## Cross-Domain Decisions");
	});
});

import type {
	Agent,
	AgentId,
	AgentSpec,
	AgentTurnInput,
	AgentTurnOutput,
	RoomKind,
	SubmitTurnPayload,
	TurnTiming,
} from "@the-hive/protocol/engine";

export interface ScriptedAgentOptions<K extends RoomKind = RoomKind> {
	readonly agentId: AgentId;
	readonly spec?: AgentSpec;
	readonly turns: readonly (SubmitTurnPayload<K> | null)[];
	readonly rawResponses?: readonly unknown[];
	readonly timingBaseMs?: number;
}

export interface FaultyAgentOptions<K extends RoomKind = RoomKind> extends ScriptedAgentOptions<K> {
	readonly throwOnCalls: readonly number[];
	readonly errorMessage?: string;
}

export interface EchoAgentOptions<K extends RoomKind = RoomKind> {
	readonly agentId: AgentId;
	readonly spec?: AgentSpec;
	readonly payload: SubmitTurnPayload<K> | null;
	readonly timingBaseMs?: number;
}

class ScriptedAgentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ScriptedAgentError";
	}
}

function buildSpec(agentId: AgentId, spec?: AgentSpec): AgentSpec {
	return (
		spec ?? {
			agentId,
			persona: "scripted",
			modelSelection: {
				providerId: "test",
				modelId: "scripted",
			},
			systemPromptRef: "inline:test",
		}
	);
}

function buildTiming(baseMs: number, callCount: number): TurnTiming {
	const startedAtMs = baseMs + callCount * 10;
	const completedAtMs = startedAtMs + 1;
	return {
		startedAtMs,
		completedAtMs,
		latencyMs: completedAtMs - startedAtMs,
	};
}

export class ScriptedAgent<K extends RoomKind = RoomKind> implements Agent<K> {
	public readonly agentId: AgentId;
	public readonly spec: AgentSpec;

	private readonly turns: readonly (SubmitTurnPayload<K> | null)[];
	private readonly rawResponses: readonly unknown[];
	protected readonly timingBaseMs: number;
	protected callCount = 0;
	protected payloadIndex = 0;

	constructor(options: ScriptedAgentOptions<K>) {
		this.agentId = options.agentId;
		this.spec = buildSpec(options.agentId, options.spec);
		this.turns = options.turns;
		this.rawResponses = options.rawResponses ?? options.turns;
		this.timingBaseMs = options.timingBaseMs ?? 1_000;
	}

	public async takeTurn(input: AgentTurnInput): Promise<AgentTurnOutput<K>> {
		this.callCount += 1;
		const currentIndex = this.payloadIndex;
		if (this.payloadIndex < this.turns.length) {
			this.payloadIndex += 1;
		}

		const payload = this.turns[currentIndex] ?? null;
		const rawResponse = this.rawResponses[currentIndex] ?? payload ?? { exhausted: true };
		return {
			turnId: input.turnId,
			agentId: this.agentId,
			parsedTurn: payload
				? {
						turnId: input.turnId,
						agentId: this.agentId,
						roundNumber: input.roundNumber,
						payload,
						timestamp: input.roundNumber * 100 + currentIndex,
					}
				: null,
			rawResponse,
			timing: buildTiming(this.timingBaseMs, this.callCount),
		};
	}
}

export class FaultyAgent<K extends RoomKind = RoomKind> extends ScriptedAgent<K> {
	private readonly throwOnCalls: ReadonlySet<number>;
	private readonly errorMessage: string;
	private invocationCount = 0;

	constructor(options: FaultyAgentOptions<K>) {
		super(options);
		this.throwOnCalls = new Set(options.throwOnCalls);
		this.errorMessage = options.errorMessage ?? "Scripted failure";
	}

	public override async takeTurn(input: AgentTurnInput): Promise<AgentTurnOutput<K>> {
		this.invocationCount += 1;
		if (this.throwOnCalls.has(this.invocationCount)) {
			throw new ScriptedAgentError(this.errorMessage);
		}

		return super.takeTurn(input);
	}
}

export class EchoAgent<K extends RoomKind = RoomKind> extends ScriptedAgent<K> {
	private readonly payload: SubmitTurnPayload<K> | null;

	constructor(options: EchoAgentOptions<K>) {
		const payload = options.payload;
		const scriptedOptions: ScriptedAgentOptions<K> = {
			agentId: options.agentId,
			turns: [payload],
			...(options.spec ? { spec: options.spec } : {}),
			...(options.timingBaseMs !== undefined ? { timingBaseMs: options.timingBaseMs } : {}),
		};
		super(scriptedOptions);
		this.payload = payload;
	}

	public override async takeTurn(input: AgentTurnInput): Promise<AgentTurnOutput<K>> {
		this.callCount += 1;
		return {
			turnId: input.turnId,
			agentId: this.agentId,
			parsedTurn: this.payload
				? {
						turnId: input.turnId,
						agentId: this.agentId,
						roundNumber: input.roundNumber,
						payload: this.payload,
						timestamp: input.roundNumber * 100,
					}
				: null,
			rawResponse: this.payload ?? { exhausted: true },
			timing: buildTiming(this.timingBaseMs, this.callCount),
		};
	}
}

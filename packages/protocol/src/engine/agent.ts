import type { ContextBundle } from "./context.js";
import type { Turn } from "./ledger.js";

export interface AgentIdentity {
	readonly id: string;
	readonly persona: string;
	readonly domain: string;
	readonly provider: string;
	readonly model: string;
}

export interface AgentResult {
	readonly agentId: string;
	readonly turn: Turn;
	readonly rawResponse: string;
	readonly parseSuccess: boolean;
	readonly tokenUsage: { readonly input: number; readonly output: number };
	readonly latencyMs: number;
}

export interface Agent {
	readonly identity: AgentIdentity;
	execute(
		systemPrompt: string,
		context: ContextBundle,
		ledgerView: string,
		turnNumber: number,
		maxRounds: number,
	): Promise<AgentResult>;
}

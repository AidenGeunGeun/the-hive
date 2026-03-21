import type {
	Agent,
	AgentSpec,
	AgentTurnInput,
	AgentTurnOutput,
	MemoryView,
	RoomKind,
} from "@the-hive/protocol/engine";
import { runProviderTurn } from "./turn-runner";
import type { ModelHandle, ProviderAgentDeps } from "./types";

function augmentMemoryWithPersona(memoryView: MemoryView, spec: AgentSpec): MemoryView {
	if (!spec.persona) {
		return memoryView;
	}

	return {
		...memoryView,
		systemPrompt: `${memoryView.systemPrompt}\n\n## Your Role: ${spec.persona}\n\nYou are the ${spec.persona} specialist. Focus your analysis on ${spec.persona}-related concerns. Challenge proposals from other perspectives when they overlook ${spec.persona} implications.`,
	};
}

export function createProviderAgent<K extends RoomKind>(
	spec: AgentSpec,
	runtimeDeps: ProviderAgentDeps,
): Agent<K> {
	const handle: ModelHandle = runtimeDeps.registry.resolveModel(spec.modelSelection);

	return {
		agentId: spec.agentId,
		spec,

		async takeTurn(input: AgentTurnInput): Promise<AgentTurnOutput<K>> {
			const augmentedMemoryView = augmentMemoryWithPersona(input.memoryView, spec);

			const result = await runProviderTurn<K>({
				model: handle.piAiModel,
				complete: runtimeDeps.complete,
				turnId: input.turnId,
				agentId: spec.agentId,
				roundNumber: input.roundNumber,
				memoryView: augmentedMemoryView,
				roomKind: runtimeDeps.roomKind as K,
			});

			return {
				turnId: input.turnId,
				agentId: spec.agentId,
				parsedTurn: result.parsedTurn,
				rawResponse: result.rawResponse,
				usage: result.usage,
				timing: result.timing,
			};
		},
	};
}

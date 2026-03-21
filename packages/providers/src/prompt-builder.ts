import type { Context, UserMessage } from "@mariozechner/pi-ai";
import type { MemoryView, RoomKind } from "@the-hive/protocol/engine";
import { getSubmitTurnTool } from "./tool-schema";

/**
 * Build the system prompt from MemoryView.
 *
 * Combines the room's system prompt (room-base + persona) with the
 * context bundle content. The context bundle is injected as structured
 * sections so the agent has the documentation it needs.
 */
function buildSystemPrompt(memoryView: MemoryView): string {
	const parts: string[] = [memoryView.systemPrompt];

	if (memoryView.contextBundle.sections.length > 0) {
		parts.push("\n\n## Project Context\n");
		for (const section of memoryView.contextBundle.sections) {
			parts.push(`### ${section.kind}: ${section.sourceRef}`);
			if (section.domainTags.length > 0) {
				parts.push(`Tags: ${section.domainTags.join(", ")}`);
			}
			const ageMs = Date.now() - section.staleness.lastVerifiedAtMs;
			const ageHours = Math.round(ageMs / 3_600_000);
			parts.push(
				ageHours > 0
					? `Staleness: verified ${ageHours}h ago (source: ${section.staleness.source})`
					: `Staleness: recently verified (source: ${section.staleness.source})`,
			);
			parts.push(section.content);
			parts.push("");
		}
	}

	return parts.join("\n");
}

/**
 * Build the user message containing the current deliberation state.
 *
 * This is a fresh snapshot each turn — the memory policy already handles
 * what to include vs. exclude, so we render it directly.
 */
function buildDeliberationMessage(memoryView: MemoryView): string {
	const parts: string[] = [];

	parts.push(memoryView.turnCounterMessage);
	parts.push("");

	if (memoryView.ledgerSummary.length > 0) {
		parts.push("## Current Issue Ledger");
		parts.push("");
		for (const item of memoryView.ledgerSummary) {
			parts.push(`- **${item.title}** [${item.state}] (id: ${item.issueId})`);
		}
		parts.push("");
	} else {
		parts.push("## Current Issue Ledger");
		parts.push("No issues raised yet. You should identify issues in the project context.");
		parts.push("");
	}

	if (memoryView.unresolvedIssueDetails.length > 0) {
		parts.push("## Unresolved Issues (Detail)");
		parts.push("");
		for (const issue of memoryView.unresolvedIssueDetails) {
			parts.push(`### ${issue.title} [${issue.state}] (id: ${issue.issueId})`);
			parts.push(issue.description);
			if (issue.recentEntries.length > 0) {
				parts.push("Recent activity:");
				for (const entry of issue.recentEntries) {
					parts.push(`  - ${entry}`);
				}
			}
			parts.push("");
		}
	}

	if (memoryView.resolvedIssueSummaries.length > 0) {
		parts.push("## Resolved Issues");
		parts.push("");
		for (const issue of memoryView.resolvedIssueSummaries) {
			parts.push(
				`- **${issue.title}** [${issue.state}]: ${issue.resolutionSummary} (id: ${issue.issueId})`,
			);
		}
		parts.push("");
	}

	parts.push("Use the submit_turn tool to take your turn. Include at least one ledger action.");

	return parts.join("\n");
}

/**
 * Convert a MemoryView into a pi-ai Context ready for completion.
 *
 * Each agent turn is a single-shot call:
 * - System prompt: room rules + persona + context bundle
 * - One user message: current deliberation state (ledger, issues, turn counter)
 * - One tool: submit_turn
 *
 * This avoids multi-turn conversation management in the provider layer.
 * The memory policy in the room kernel handles what state to surface.
 */
export function buildContext<K extends RoomKind>(memoryView: MemoryView, roomKind: K): Context {
	const userMessage: UserMessage = {
		role: "user",
		content: buildDeliberationMessage(memoryView),
		timestamp: Date.now(),
	};

	return {
		systemPrompt: buildSystemPrompt(memoryView),
		messages: [userMessage],
		tools: [getSubmitTurnTool(roomKind)],
	};
}

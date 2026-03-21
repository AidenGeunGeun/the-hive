#!/usr/bin/env bun
/**
 * Headless live room harness.
 *
 * Runs a real 3-agent domain room against a live LLM provider.
 * NOT a unit test — makes real API calls and costs real money.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... bun scripts/run-live-room.ts [provider] [model] [--context path] [--max-rounds N]
 *
 * Defaults: provider=openai, model=gpt-4o-mini, max-rounds=3
 *
 * Outputs (written to test/eval/output/):
 *   - ledger.json, traces.json, report.md, summary.json
 */

import * as fs from "node:fs";
import { createAgentId, createRoomId } from "@the-hive/protocol/engine";
import type { AgentSpec, ContextBundle, PolicySet, RoomSpec } from "@the-hive/protocol/engine";
import {
	completeSimple,
	createDefaultProviderRegistry,
	createProviderAgent,
} from "@the-hive/providers";
import { runRoom } from "@the-hive/room";

// Parse CLI args
function parseArgs(argv: readonly string[]) {
	const positional = argv.filter((a) => !a.startsWith("--"));
	const flags = new Map<string, string>();
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg?.startsWith("--") && i + 1 < argv.length) {
			const next = argv[i + 1];
			if (next) {
				flags.set(arg, next);
			}
			i++;
		}
	}
	return {
		providerId: positional[0] ?? "openai",
		modelId: positional[1] ?? "gpt-4o-mini",
		contextFile: flags.get("--context"),
		templateFile: flags.get("--template"),
		maxRounds: Number(flags.get("--max-rounds") ?? "3"),
	};
}

const args = parseArgs(process.argv.slice(2));

console.log("\n--- The Hive: Live Room Harness ---");
console.log(`Provider: ${args.providerId}`);
console.log(`Model: ${args.modelId}`);
console.log(`Max rounds: ${args.maxRounds}`);
if (args.contextFile) {
	console.log(`Context file: ${args.contextFile}`);
}
if (args.templateFile) {
	console.log(`Template file: ${args.templateFile}`);
}
console.log("---\n");

// Load or build context bundle
function loadContextBundle(contextFile: string | undefined): ContextBundle {
	if (contextFile) {
		const raw = fs.readFileSync(contextFile, "utf-8");
		return JSON.parse(raw) as ContextBundle;
	}

	return {
		bundleId: "live-test-bundle",
		version: 1,
		createdAtMs: Date.now(),
		rootRef: "/test-project",
		sections: [
			{
				sectionId: "s1",
				kind: "agents_md",
				sourceRef: "/test-project/AGENTS.md",
				domainTags: ["backend"],
				content: `# Test E-Commerce API

## Overview
A REST API for an e-commerce platform. Currently handles:
- Product catalog (CRUD)
- User authentication (JWT)
- Shopping cart
- Order processing

## Architecture
- Node.js + Express
- PostgreSQL database
- Redis for session cache
- No message queue yet

## Known Issues
- No rate limiting on any endpoint
- Cart operations are not atomic (race conditions possible)
- Product search is full-table-scan (no search index)
- No pagination on list endpoints
- JWT tokens never expire

## Tech Debt
- No integration tests
- Database queries are raw SQL strings (no parameterized queries in some places)
- Error responses are inconsistent (sometimes 500 with stack trace)`,
				checksum: "fixture-1",
				staleness: { lastVerifiedAtMs: Date.now(), source: "explicit" },
			},
		],
	};
}

const contextBundle = loadContextBundle(args.contextFile);

interface RoomTemplate {
	readonly personas: readonly string[];
	readonly policies: PolicySet;
	readonly kind: "domain" | "synthesis" | "query_back";
	readonly minHealthyAgents: number;
	readonly systemPrompt: string;
}

function loadRoomTemplate(templateFile: string | undefined): RoomTemplate {
	if (templateFile) {
		const raw = fs.readFileSync(templateFile, "utf-8");
		return JSON.parse(raw) as RoomTemplate;
	}

	return {
		personas: ["backend", "security", "database"],
		kind: "domain",
		minHealthyAgents: 2,
		policies: {
			turnPolicy: "roundRobinTurnPolicy",
			stopPolicy: "noOpenObjectionStopPolicy",
			memoryPolicy: "unresolvedIssueScopedMemoryPolicy",
			failurePolicy: "retryOnceThenFailFailurePolicy",
			artifactPolicy: "domainArtifactPolicy",
		},
		systemPrompt: `# Room Base Rules

You are a deliberation agent in The Hive. Your purpose is to produce high-quality architectural decisions through adversarial discussion.

## Rules

- Find flaws in other agents' proposals before agreeing. Empty agreement is not allowed.
- Every turn must do at least one of: raise a new concern, propose a concrete solution, challenge a specific claim, or propose closure on a resolved issue.
- If you have nothing new to contribute, propose closure on resolved issues.
- Be specific and concrete. No vague concerns, no hand-waving.
- Reference evidence from the ContextBundle when making claims.
- If you lack context to deliberate on an issue, use request_context.
- Do not restate what another agent already said.
- Do not use filler phrases or pleasantries.`,
	};
}

const template = loadRoomTemplate(args.templateFile);

const agentSpecs: readonly AgentSpec[] = template.personas.map((persona) => ({
	agentId: createAgentId(),
	persona,
	modelSelection: { providerId: args.providerId, modelId: args.modelId },
	systemPromptRef: `inline:${persona}`,
}));

const roomSpec: RoomSpec = {
	roomId: createRoomId(),
	kind: template.kind,
	agentSpecs,
	maxRounds: args.maxRounds,
	minHealthyAgents: template.minHealthyAgents,
	policies: template.policies,
};

const registry = createDefaultProviderRegistry();
const agents = agentSpecs.map((spec) =>
	createProviderAgent(spec, {
		registry,
		complete: completeSimple,
		roomKind: template.kind,
	}),
);

console.log("Starting room...\n");
const startMs = Date.now();

const result = await runRoom({
	spec: roomSpec,
	agents,
	contextBundle,
	systemPrompt: template.systemPrompt,
	onTurnComplete: (trace) => {
		const label = trace.parsedTurn
			? `${trace.parsedTurn.payload.ledgerActions.length} action(s)`
			: "no actions";
		console.log(
			`  [Turn] agent=${trace.agentId.slice(0, 8)}... round=${trace.roundNumber} ${label}`,
		);
	},
});

const durationMs = Date.now() - startMs;

console.log("\n--- Results ---");
console.log(`Outcome: ${result.outcome}`);
console.log(`Turns: ${result.turnTraces.length}`);
console.log(`Health: ${result.health.activeAgents}/${result.health.totalAgents} agents healthy`);
console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s`);

if (result.renderedArtifact) {
	console.log("\n--- Rendered Report ---\n");
	console.log(result.renderedArtifact.content);
}

// Emit JSON outputs
const outputDir = "test/eval/output";
fs.mkdirSync(outputDir, { recursive: true });

const ledgerPath = `${outputDir}/ledger.json`;
fs.writeFileSync(ledgerPath, JSON.stringify(result.ledgerEntries, null, 2));
console.log(`\nLedger JSON: ${ledgerPath} (${result.ledgerEntries.length} entries)`);

const tracePath = `${outputDir}/traces.json`;
fs.writeFileSync(tracePath, JSON.stringify(result.turnTraces, null, 2));
console.log(`Trace JSON: ${tracePath} (${result.turnTraces.length} traces)`);

if (result.renderedArtifact) {
	const reportPath = `${outputDir}/report.md`;
	fs.writeFileSync(reportPath, result.renderedArtifact.content);
	console.log(`Report: ${reportPath}`);
}

// Cost/latency summary
let totalCost = 0;
let totalInputTokens = 0;
let totalOutputTokens = 0;
for (const trace of result.turnTraces) {
	const raw = trace.rawResponse as
		| { usage?: { cost?: { total?: number }; input?: number; output?: number } }
		| undefined;
	if (raw?.usage) {
		totalCost += raw.usage.cost?.total ?? 0;
		totalInputTokens += raw.usage.input ?? 0;
		totalOutputTokens += raw.usage.output ?? 0;
	}
}

const summary = {
	outcome: result.outcome,
	turns: result.turnTraces.length,
	ledgerEntries: result.ledgerEntries.length,
	health: result.health,
	inputTokens: totalInputTokens,
	outputTokens: totalOutputTokens,
	totalCostUsd: totalCost,
	durationMs,
	provider: args.providerId,
	model: args.modelId,
};

const summaryPath = `${outputDir}/summary.json`;
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
console.log(`Summary JSON: ${summaryPath}`);

console.log("\n--- Cost Summary ---");
console.log(`  Input tokens: ${totalInputTokens.toLocaleString()}`);
console.log(`  Output tokens: ${totalOutputTokens.toLocaleString()}`);
console.log(`  Total cost: $${totalCost.toFixed(4)}`);
console.log(`  Latency: ${(durationMs / 1000).toFixed(1)}s`);

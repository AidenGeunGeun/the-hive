import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	createAgentId,
	createIssueId,
	createQueryResponseArtifactId,
	createRoomId,
	createTaskId,
	createTurnId,
} from "../src/engine/index.ts";
import { reviewPacketViewSchema, wireCommandSchema, wireEventSchema } from "../src/wire/index.ts";
import type { WireCommand } from "../src/wire/index.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ProtocolTestError extends TypeError {}

function assertNever(value: never): never {
	throw new ProtocolTestError(`Unhandled command: ${JSON.stringify(value)}`);
}

function describeCommand(command: WireCommand): string {
	switch (command.kind) {
		case "submit_task":
			return command.prompt;
		case "approve_task":
			return command.taskId;
		case "reject_task":
			return command.feedback.join(",");
		case "cancel_task":
			return command.commandId;
		case "subscribe_task":
			return command.taskId;
		case "get_task_snapshot":
			return command.taskId;
		default:
			return assertNever(command);
	}
}

async function collectTypeScriptFiles(directoryPath: string): Promise<readonly string[]> {
	const entries = await readdir(directoryPath, { withFileTypes: true });
	const files = await Promise.all(
		entries.map(async (entry) => {
			const entryPath = join(directoryPath, entry.name);
			if (entry.isDirectory()) {
				return collectTypeScriptFiles(entryPath);
			}

			return entry.name.endsWith(".ts") ? [entryPath] : [];
		}),
	);

	return files.flat();
}

describe("protocol contracts", () => {
	it("handles every wire command kind in a switch", () => {
		const commands: readonly WireCommand[] = [
			{
				kind: "submit_task",
				commandId: "cmd-1",
				taskId: "task-1",
				prompt: "Design the API",
				bundleInput: { path: "/tmp/context" },
				submittedAtMs: 1,
			},
			{
				kind: "approve_task",
				commandId: "cmd-2",
				taskId: "task-2",
				submittedAtMs: 2,
			},
			{
				kind: "reject_task",
				commandId: "cmd-3",
				taskId: "task-3",
				feedback: ["Needs more detail"],
				submittedAtMs: 3,
			},
			{
				kind: "cancel_task",
				commandId: "cmd-4",
				taskId: "task-4",
				submittedAtMs: 4,
			},
			{
				kind: "subscribe_task",
				commandId: "cmd-5",
				taskId: "task-5",
			},
			{
				kind: "get_task_snapshot",
				commandId: "cmd-6",
				taskId: "task-6",
			},
		];

		expect(commands.map(describeCommand)).toEqual([
			"Design the API",
			"task-2",
			"Needs more detail",
			"cmd-4",
			"task-5",
			"task-6",
		]);
	});

	it("creates branded ids from UUIDs", () => {
		const ids = [
			createTaskId(),
			createRoomId(),
			createAgentId(),
			createIssueId(),
			createTurnId(),
			createQueryResponseArtifactId(),
		];

		for (const id of ids) {
			expect(id).toMatch(uuidPattern);
		}
	});

	it("keeps wire types independent from engine imports", async () => {
		const wireDirectory = join(__dirname, "../src/wire");
		const sourceFiles = await collectTypeScriptFiles(wireDirectory);

		for (const sourceFile of sourceFiles) {
			const content = await readFile(sourceFile, "utf8");
			expect(content).not.toMatch(/from\s+["'][^"']*engine[^"']*["']/);
			expect(content).not.toMatch(/from\s+["'][^"']*\/engine\/[^"']*["']/);
		}
	});

	it("exports runtime schemas for wire contracts", () => {
		expect(wireCommandSchema.type).toBe("union");
		expect(wireCommandSchema.anyOf).toHaveLength(6);
		expect(wireEventSchema.type).toBe("union");
		expect(wireEventSchema.anyOf).toHaveLength(6);
		expect(reviewPacketViewSchema.properties.proposalMarkdown).toEqual({ type: "string" });
	});
});

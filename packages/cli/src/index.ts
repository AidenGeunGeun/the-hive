#!/usr/bin/env bun

import type {
	ApproveTaskCommand,
	CancelTaskCommand,
	GetTaskSnapshotCommand,
	SubmitTaskCommand,
	SubscribeTaskCommand,
	WireCommandEnvelope,
	WireEvent,
} from "@the-hive/protocol/wire";

import { connectToServer } from "./client";
import { formatError, formatEvent, formatSnapshot } from "./format";

declare const console: {
	log(message?: unknown): void;
	error(message?: unknown): void;
};

declare const crypto: {
	randomUUID(): string;
};

declare const process: {
	readonly argv: readonly string[];
	exitCode: number;
};

const DEFAULT_SERVER_URL = "ws://localhost:4080";
const FALLBACK_SERVER_URL = "ws://localhost:4096";
const PROTOCOL_VERSION = {
	major: 1,
	minor: 0,
} as const;

type CliCommand =
	| {
			readonly kind: "submit";
			readonly prompt: string;
			readonly bundleInputPath: string;
			readonly serverUrl: string;
	  }
	| { readonly kind: "watch"; readonly taskId: string; readonly serverUrl: string }
	| { readonly kind: "approve"; readonly taskId: string; readonly serverUrl: string }
	| { readonly kind: "cancel"; readonly taskId: string; readonly serverUrl: string }
	| { readonly kind: "snapshot"; readonly taskId: string; readonly serverUrl: string };

function parseArgs(argv: readonly string[]): CliCommand {
	const [commandName, ...rest] = argv;
	const args = [...rest];
	const serverFlagIndex = args.indexOf("--server");
	const serverUrl =
		serverFlagIndex >= 0 && args[serverFlagIndex + 1]
			? (args[serverFlagIndex + 1] ?? DEFAULT_SERVER_URL)
			: DEFAULT_SERVER_URL;
	if (serverFlagIndex >= 0) {
		args.splice(serverFlagIndex, 2);
	}

	switch (commandName) {
		case "submit": {
			const promptIndex = args.indexOf("--prompt");
			const bundleInputIndex = args.indexOf("--bundle-input");
			const prompt = promptIndex >= 0 ? args[promptIndex + 1] : undefined;
			const bundleInputPath = bundleInputIndex >= 0 ? args[bundleInputIndex + 1] : undefined;
			if (!prompt || !bundleInputPath) {
				throw new Error(
					'Usage: hive submit --prompt "..." --bundle-input /path [--server ws://localhost:4080]',
				);
			}
			return {
				kind: "submit",
				prompt,
				bundleInputPath,
				serverUrl,
			};
		}
		case "watch":
		case "approve":
		case "cancel":
		case "snapshot": {
			const taskId = args[0];
			if (!taskId) {
				throw new Error(`Usage: hive ${commandName} <taskId> [--server ws://localhost:4080]`);
			}
			return {
				kind: commandName,
				taskId,
				serverUrl,
			};
		}
		default:
			throw new Error(
				"Usage: hive <submit|watch|approve|cancel|snapshot> [...args] [--server ws://localhost:4080]",
			);
	}
}

function createEnvelope(command: WireCommandEnvelope["command"]): WireCommandEnvelope {
	return {
		protocolVersion: PROTOCOL_VERSION,
		command,
	};
}

function createSubscribeCommand(taskId: string): SubscribeTaskCommand {
	return {
		kind: "subscribe_task",
		commandId: crypto.randomUUID(),
		taskId,
	};
}

function isTerminalState(state: string): boolean {
	return state === "approved" || state === "failed" || state === "cancelled";
}

async function connectWithDefaultFallback(serverUrl: string) {
	try {
		return await connectToServer(serverUrl);
	} catch (error) {
		if (serverUrl !== DEFAULT_SERVER_URL) {
			throw error;
		}
		return connectToServer(FALLBACK_SERVER_URL);
	}
}

async function watchTask(taskId: string, serverUrl: string): Promise<void> {
	const client = await connectWithDefaultFallback(serverUrl);
	try {
		await new Promise<void>((resolve, reject) => {
			client.onError((error) => {
				console.error(formatError(error));
				reject(new Error(error.message));
			});
			client.onEvent((event) => {
				console.log(formatEvent(event));
				if (event.kind === "task_snapshot" && isTerminalState(event.snapshot.state)) {
					resolve();
					return;
				}
				if (event.kind === "task_state_changed" && isTerminalState(event.toState)) {
					resolve();
				}
			});
			client.send(createEnvelope(createSubscribeCommand(taskId)));
		});
	} finally {
		client.close();
	}
}

async function submitTask(
	prompt: string,
	bundleInputPath: string,
	serverUrl: string,
): Promise<void> {
	const client = await connectWithDefaultFallback(serverUrl);
	const taskId = crypto.randomUUID();
	const subscribeCommand = createSubscribeCommand(taskId);
	const submitCommand: SubmitTaskCommand = {
		kind: "submit_task",
		commandId: crypto.randomUUID(),
		taskId,
		prompt,
		bundleInput: { path: bundleInputPath },
		submittedAtMs: Date.now(),
	};
	try {
		await new Promise<void>((resolve, reject) => {
			client.onError((error, commandId) => {
				if (commandId === subscribeCommand.commandId && error.code === "TASK_NOT_FOUND") {
					return;
				}
				console.error(formatError(error));
				reject(new Error(error.message));
			});
			client.onEvent((event) => {
				console.log(formatEvent(event));
				if (event.kind === "task_snapshot" && isTerminalState(event.snapshot.state)) {
					resolve();
					return;
				}
				if (event.kind === "task_state_changed" && isTerminalState(event.toState)) {
					resolve();
				}
			});
			console.log(`task=${taskId}`);
			client.send(createEnvelope(subscribeCommand));
			client.send(createEnvelope(submitCommand));
		});
	} finally {
		client.close();
	}
}

async function approveTask(taskId: string, serverUrl: string): Promise<void> {
	const client = await connectWithDefaultFallback(serverUrl);
	const approveCommand: ApproveTaskCommand = {
		kind: "approve_task",
		commandId: crypto.randomUUID(),
		taskId,
		submittedAtMs: Date.now(),
	};
	try {
		await new Promise<void>((resolve, reject) => {
			client.onError((error) => {
				console.error(formatError(error));
				reject(new Error(error.message));
			});
			client.onEvent((event) => {
				console.log(formatEvent(event));
				if (event.kind === "task_state_changed" && event.toState === "approved") {
					resolve();
				}
			});
			client.send(createEnvelope(createSubscribeCommand(taskId)));
			client.send(createEnvelope(approveCommand));
		});
	} finally {
		client.close();
	}
}

async function cancelTask(taskId: string, serverUrl: string): Promise<void> {
	const client = await connectWithDefaultFallback(serverUrl);
	const cancelCommand: CancelTaskCommand = {
		kind: "cancel_task",
		commandId: crypto.randomUUID(),
		taskId,
		submittedAtMs: Date.now(),
	};
	try {
		await new Promise<void>((resolve, reject) => {
			client.onError((error) => {
				console.error(formatError(error));
				reject(new Error(error.message));
			});
			client.onEvent((event) => {
				console.log(formatEvent(event));
				if (event.kind === "task_state_changed" && event.toState === "cancelled") {
					resolve();
				}
			});
			client.send(createEnvelope(createSubscribeCommand(taskId)));
			client.send(createEnvelope(cancelCommand));
		});
	} finally {
		client.close();
	}
}

async function snapshotTask(taskId: string, serverUrl: string): Promise<void> {
	const client = await connectWithDefaultFallback(serverUrl);
	const command: GetTaskSnapshotCommand = {
		kind: "get_task_snapshot",
		commandId: crypto.randomUUID(),
		taskId,
	};
	try {
		await new Promise<void>((resolve, reject) => {
			client.onError((error) => {
				console.error(formatError(error));
				reject(new Error(error.message));
			});
			client.onEvent((event: WireEvent) => {
				if (event.kind !== "task_snapshot") {
					return;
				}
				console.log(formatSnapshot(event.snapshot));
				resolve();
			});
			client.send(createEnvelope(command));
		});
	} finally {
		client.close();
	}
}

export async function runCli(argv: readonly string[]): Promise<void> {
	const command = parseArgs(argv);
	switch (command.kind) {
		case "submit":
			await submitTask(command.prompt, command.bundleInputPath, command.serverUrl);
			break;
		case "watch":
			await watchTask(command.taskId, command.serverUrl);
			break;
		case "approve":
			await approveTask(command.taskId, command.serverUrl);
			break;
		case "cancel":
			await cancelTask(command.taskId, command.serverUrl);
			break;
		case "snapshot":
			await snapshotTask(command.taskId, command.serverUrl);
			break;
	}
}

if ((import.meta as ImportMeta & { readonly main?: boolean }).main) {
	void runCli(process.argv.slice(2)).catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(message);
		process.exitCode = 1;
	});
}

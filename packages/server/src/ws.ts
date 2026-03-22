import { randomUUID } from "node:crypto";

import type {
	TaskReviewReadyEvent,
	TaskSnapshotEvent,
	WireCommand,
	WireCommandEnvelope,
	WireError,
	WireErrorCode,
	WireEvent,
	WireEventEnvelope,
	WireServerMessage,
} from "@the-hive/protocol/wire";
import { type DatabaseHandle, readReviewPacket } from "@the-hive/storage";

import type { Authority } from "./authority";
import type { WireProjector } from "./projection";

interface ServerWebSocket<TData = unknown> {
	readonly data: TData;
	send(message: string): void;
	close(): void;
}

interface BunServer {
	stop(closeActiveConnections?: boolean): void;
	upgrade(request: Request, options: { readonly data: SocketData }): boolean;
}

declare const Bun: {
	serve<TData>(options: {
		readonly hostname: string;
		readonly port: number;
		fetch(request: Request, server: BunServer): Response | undefined;
		websocket: {
			open(socket: ServerWebSocket<TData>): void;
			close(socket: ServerWebSocket<TData>): void;
			message(
				socket: ServerWebSocket<TData>,
				message: string | ArrayBuffer | Uint8Array,
			): void | Promise<void>;
		};
	}): BunServer;
};

const PROTOCOL_VERSION = {
	major: 1,
	minor: 0,
} as const;

export interface WsServerDeps {
	readonly authority: Authority;
	readonly projector: WireProjector;
	readonly db: DatabaseHandle;
	readonly host: string;
	readonly port: number;
}

export interface WsServer {
	readonly server: BunServer;
	broadcast(taskId: string, events: readonly WireEvent[]): void;
	shutdown(): void;
}

interface SocketData {
	readonly socketId: string;
}

class WsProtocolError extends Error {
	public readonly code: WireErrorCode;
	public readonly details?: unknown;

	constructor(code: WireErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = "WsProtocolError";
		this.code = code;
		this.details = details;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function assertProtocolVersion(protocolVersion: unknown): void {
	if (!isRecord(protocolVersion)) {
		throw new WsProtocolError("INVALID_PAYLOAD", "protocolVersion must be an object");
	}
	if (
		protocolVersion.major !== PROTOCOL_VERSION.major ||
		protocolVersion.minor !== PROTOCOL_VERSION.minor
	) {
		throw new WsProtocolError("PROTOCOL_VERSION_MISMATCH", "Protocol version mismatch", {
			expected: PROTOCOL_VERSION,
			received: protocolVersion,
		});
	}
}

function parseWireCommand(message: string): WireCommandEnvelope {
	let parsed: unknown;
	try {
		parsed = JSON.parse(message);
	} catch (error) {
		throw new WsProtocolError("INVALID_PAYLOAD", "Invalid JSON payload", {
			cause: error instanceof Error ? error.message : String(error),
		});
	}

	if (!isRecord(parsed) || !("command" in parsed)) {
		throw new WsProtocolError("INVALID_PAYLOAD", "Expected a wire command envelope");
	}

	assertProtocolVersion(parsed.protocolVersion);
	if (!isRecord(parsed.command) || typeof parsed.command.kind !== "string") {
		throw new WsProtocolError("INVALID_PAYLOAD", "command.kind must be present");
	}

	const command = parsed.command;
	switch (command.kind) {
		case "submit_task":
			if (
				typeof command.commandId !== "string" ||
				typeof command.taskId !== "string" ||
				typeof command.prompt !== "string" ||
				!isRecord(command.bundleInput) ||
				typeof command.bundleInput.path !== "string" ||
				(command.requestedDomains !== undefined && !isStringArray(command.requestedDomains)) ||
				(command.configProfile !== undefined && typeof command.configProfile !== "string") ||
				typeof command.submittedAtMs !== "number"
			) {
				throw new WsProtocolError("INVALID_PAYLOAD", "Invalid submit_task payload");
			}
			break;
		case "approve_task":
		case "cancel_task":
			if (
				typeof command.commandId !== "string" ||
				typeof command.taskId !== "string" ||
				typeof command.submittedAtMs !== "number"
			) {
				throw new WsProtocolError("INVALID_PAYLOAD", `Invalid ${command.kind} payload`);
			}
			break;
		case "reject_task":
			if (
				typeof command.commandId !== "string" ||
				typeof command.taskId !== "string" ||
				!isStringArray(command.feedback) ||
				typeof command.submittedAtMs !== "number"
			) {
				throw new WsProtocolError("INVALID_PAYLOAD", "Invalid reject_task payload");
			}
			break;
		case "subscribe_task":
		case "get_task_snapshot":
			if (typeof command.commandId !== "string" || typeof command.taskId !== "string") {
				throw new WsProtocolError("INVALID_PAYLOAD", `Invalid ${command.kind} payload`);
			}
			break;
		default:
			throw new WsProtocolError("UNKNOWN_COMMAND", `Unknown command ${command.kind}`);
	}

	return parsed as unknown as WireCommandEnvelope;
}

function toWireErrorEnvelope(commandId: string, error: WireError): WireServerMessage {
	return {
		protocolVersion: PROTOCOL_VERSION,
		commandId,
		error,
	};
}

function toWireEventEnvelope(event: WireEvent): WireEventEnvelope {
	return {
		protocolVersion: PROTOCOL_VERSION,
		event,
	};
}

function sendMessage(socket: ServerWebSocket<SocketData>, message: WireServerMessage): void {
	socket.send(JSON.stringify(message));
}

function mapCommandError(error: unknown): WireError {
	if (error instanceof WsProtocolError) {
		return {
			code: error.code,
			message: error.message,
			...(error.details !== undefined ? { details: error.details } : {}),
		};
	}

	return {
		code: "INVALID_STATE_TRANSITION",
		message: error instanceof Error ? error.message : "Command failed",
		...(error instanceof Error && error.stack ? { details: { stack: error.stack } } : {}),
	};
}

export function createWsServer(deps: WsServerDeps): WsServer {
	const subscriptions = new Map<string, Set<ServerWebSocket<SocketData>>>();
	const trackedSockets = new Set<ServerWebSocket<SocketData>>();

	async function sendSnapshot(
		socket: ServerWebSocket<SocketData>,
		command: Extract<WireCommand, { kind: "subscribe_task" | "get_task_snapshot" }>,
	): Promise<void> {
		const state = deps.authority.getTaskState(command.taskId);
		if (!state) {
			sendMessage(
				socket,
				toWireErrorEnvelope(command.commandId, {
					code: "TASK_NOT_FOUND",
					message: `Task ${command.taskId} was not found`,
				}),
			);
			return;
		}

		const snapshot = await deps.projector.buildTaskSnapshot(command.taskId, state);
		const event: TaskSnapshotEvent = {
			kind: "task_snapshot",
			commandId: command.commandId,
			snapshot,
			sentAtMs: Date.now(),
		};
		sendMessage(socket, toWireEventEnvelope(event));

		if (command.kind === "subscribe_task" && state.reviewPacketVersion > 0) {
			const packetRecord = readReviewPacket(deps.db, command.taskId, state.reviewPacketVersion);
			if (packetRecord) {
				const reviewReadyEvent: TaskReviewReadyEvent = {
					kind: "task_review_ready",
					taskId: command.taskId,
					reviewPacket: JSON.parse(packetRecord.packetJson),
					readyAtMs: packetRecord.createdAtMs,
				};
				sendMessage(socket, toWireEventEnvelope(reviewReadyEvent));
			}
		}
	}

	const server = Bun.serve<SocketData>({
		hostname: deps.host,
		port: deps.port,
		fetch(request: Request, serverInstance: BunServer) {
			if (serverInstance.upgrade(request, { data: { socketId: randomUUID() } })) {
				return undefined as never;
			}
			return new Response("Not found", { status: 404 });
		},
		websocket: {
			open(socket: ServerWebSocket<SocketData>) {
				trackedSockets.add(socket);
			},

			close(socket: ServerWebSocket<SocketData>) {
				trackedSockets.delete(socket);
				for (const taskSubscriptions of subscriptions.values()) {
					taskSubscriptions.delete(socket);
				}
			},

			async message(
				socket: ServerWebSocket<SocketData>,
				message: string | ArrayBuffer | Uint8Array,
			) {
				const rawMessage =
					typeof message === "string"
						? message
						: new TextDecoder().decode(
								message instanceof Uint8Array ? message : new Uint8Array(message),
							);
				let envelope: WireCommandEnvelope | null = null;
				let commandId = "unknown";
				try {
					envelope = parseWireCommand(rawMessage);
					commandId = envelope.command.commandId;
					const command = envelope.command;
					switch (command.kind) {
						case "submit_task":
						case "approve_task":
						case "reject_task":
						case "cancel_task":
							await deps.authority.handleWireCommand(envelope);
							break;
						case "subscribe_task": {
							const taskSubscriptions = subscriptions.get(command.taskId) ?? new Set();
							taskSubscriptions.add(socket);
							subscriptions.set(command.taskId, taskSubscriptions);
							await sendSnapshot(socket, command);
							break;
						}
						case "get_task_snapshot":
							await sendSnapshot(socket, command);
							break;
					}
				} catch (error) {
					sendMessage(socket, toWireErrorEnvelope(commandId, mapCommandError(error)));
				}
			},
		},
	});

	return {
		server,

		broadcast(taskId: string, events: readonly WireEvent[]): void {
			if (events.length === 0) {
				return;
			}
			const taskSubscriptions = subscriptions.get(taskId);
			if (!taskSubscriptions || taskSubscriptions.size === 0) {
				return;
			}

			for (const event of events) {
				const payload = JSON.stringify(toWireEventEnvelope(event));
				for (const socket of taskSubscriptions) {
					socket.send(payload);
				}
			}
		},

		shutdown(): void {
			for (const socket of trackedSockets) {
				socket.close();
			}
			subscriptions.clear();
			server.stop(true);
		},
	};
}

export { PROTOCOL_VERSION, parseWireCommand };

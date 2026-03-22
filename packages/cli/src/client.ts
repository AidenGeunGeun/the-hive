import type {
	WireCommandEnvelope,
	WireError,
	WireEvent,
	WireServerMessage,
} from "@the-hive/protocol/wire";

interface MessageEventLike {
	readonly data: string;
}

interface ErrorEventLike {
	readonly message?: string;
}

interface WebSocketLike {
	onopen: (() => void) | null;
	onerror: ((event: ErrorEventLike) => void) | null;
	onmessage: ((event: MessageEventLike) => void) | null;
	onclose: (() => void) | null;
	send(data: string): void;
	close(): void;
}

declare const WebSocket: {
	new (url: string): WebSocketLike;
};

export interface HiveClient {
	send(envelope: WireCommandEnvelope): void;
	onEvent(handler: (event: WireEvent) => void): void;
	onError(handler: (error: WireError, commandId: string) => void): void;
	close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseServerMessage(rawMessage: string): WireServerMessage {
	const parsed = JSON.parse(rawMessage) as unknown;
	if (!isRecord(parsed)) {
		throw new Error("Server message must be an object");
	}
	if ("error" in parsed) {
		return parsed as unknown as WireServerMessage;
	}
	if ("event" in parsed) {
		return parsed as unknown as WireServerMessage;
	}
	throw new Error("Unknown server message shape");
}

export async function connectToServer(url: string): Promise<HiveClient> {
	const socket = await new Promise<WebSocketLike>((resolve, reject) => {
		const ws = new WebSocket(url);
		let opened = false;
		ws.onopen = () => {
			opened = true;
			resolve(ws);
		};
		ws.onerror = (event) => {
			reject(new Error(event.message ?? `Failed to connect to ${url}`));
		};
		ws.onclose = () => {
			if (!opened) {
				reject(new Error(`Connection to ${url} closed before opening`));
			}
		};
	});

	const eventHandlers: Array<(event: WireEvent) => void> = [];
	const errorHandlers: Array<(error: WireError, commandId: string) => void> = [];

	socket.onmessage = (event) => {
		const message = parseServerMessage(event.data);
		if ("error" in message) {
			for (const handler of errorHandlers) {
				handler(message.error, message.commandId);
			}
			return;
		}

		for (const handler of eventHandlers) {
			handler(message.event);
		}
	};

	return {
		send(envelope: WireCommandEnvelope): void {
			socket.send(JSON.stringify(envelope));
		},

		onEvent(handler: (event: WireEvent) => void): void {
			eventHandlers.push(handler);
		},

		onError(handler: (error: WireError, commandId: string) => void): void {
			errorHandlers.push(handler);
		},

		close(): void {
			socket.close();
		},
	};
}

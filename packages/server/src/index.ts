import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { HiveConfig } from "@the-hive/config";
import { completeSimple, createProviderRegistry } from "@the-hive/providers";
import { closeDatabase, openDatabase, runMigrations } from "@the-hive/storage";

import { createAuthority } from "./authority";
import { mapToProviderRegistryConfig } from "./config-mapper";
import { createDispatcher } from "./dispatch";
import { createWireProjector } from "./projection";
import { createWsServer } from "./ws";

export interface HostHandle {
	readonly url: string;
	readonly shutdown: () => Promise<void>;
}

export async function startHost(config: HiveConfig): Promise<HostHandle> {
	const dbPath = resolve(config.storage.dbPath);
	mkdirSync(dirname(dbPath), { recursive: true });
	const db = openDatabase(dbPath);
	runMigrations(db);

	const projector = createWireProjector(db);
	let dispatcherRef: ReturnType<typeof createDispatcher> | null = null;
	const authority = createAuthority(
		{
			db,
			projector,
			broadcaster: (taskId, events) => {
				wsServer.broadcast(taskId, events);
			},
			dispatcher: (taskId) => {
				dispatcherRef?.kick(taskId);
			},
		},
		config.defaults.maxIterations,
	);
	const wsServer = createWsServer({
		authority,
		projector,
		db,
		host: config.server.host,
		port: config.server.port,
	});
	const dispatcher = createDispatcher({
		db,
		authority,
		config,
		providerRegistry: createProviderRegistry(mapToProviderRegistryConfig(config)),
		completeFn: completeSimple,
	});
	dispatcherRef = dispatcher;
	await dispatcher.recoverIncompleteTasks();

	return {
		url: `ws://${config.server.host}:${config.server.port}`,
		shutdown: async () => {
			wsServer.shutdown();
			dispatcher.shutdown();
			closeDatabase(db);
		},
	};
}

export async function stopHost(host: HostHandle): Promise<void> {
	await host.shutdown();
}

export { createAuthority } from "./authority";
export { buildRoomSpecFromJob, mapPolicyNames, mapToProviderRegistryConfig } from "./config-mapper";
export {
	buildReviewPacket,
	buildStaticFixtureBundle,
	createDispatcher,
	projectIssueStatesFromLedger,
} from "./dispatch";
export { createWireProjector } from "./projection";
export { createWsServer, PROTOCOL_VERSION } from "./ws";

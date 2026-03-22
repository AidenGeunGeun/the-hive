import type { WorkflowState } from "@the-hive/protocol/engine";
import type { WireCommandEnvelope, WireEvent } from "@the-hive/protocol/wire";
import type { DatabaseHandle, PersistableWorkflowEvent, TaskIndexRecord } from "@the-hive/storage";
import {
	appendWorkflowEventsAutoSeq,
	readLatestSnapshot,
	readTaskIndex,
	readWorkflowEvents,
	upsertTaskIndex,
	withWriteTransaction,
} from "@the-hive/storage";
import {
	type WorkflowCommand,
	type WorkflowEvent,
	applyCommand,
	buildInitialState,
	projectState,
} from "@the-hive/workflow";

import type { WireProjector } from "./projection";

interface PhaseFivePlan {
	readonly includeSynthesis: boolean;
	readonly allowQueryBack: boolean;
	readonly allowRerun: boolean;
}

export interface PersistedWorkflowEvent {
	readonly seq: number;
	readonly event: WorkflowEvent;
}

export interface WorkflowCommit {
	readonly taskId: string;
	readonly prevState: WorkflowState;
	readonly nextState: WorkflowState;
	readonly events: readonly PersistedWorkflowEvent[];
	readonly jobs: WorkflowState["pendingJobs"];
}

export interface AuthorityDeps {
	readonly db: DatabaseHandle;
	readonly projector: WireProjector;
	readonly broadcaster: (taskId: string, events: readonly WireEvent[]) => void;
	readonly dispatcher: (taskId: string) => void;
}

export interface Authority {
	handleWireCommand(envelope: WireCommandEnvelope): Promise<void>;
	handleInternalCommand(command: WorkflowCommand): Promise<void>;
	getTaskState(taskId: string): WorkflowState | null;
}

class AuthorityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AuthorityError";
	}
}

function toPersistableWorkflowEvent(event: WorkflowEvent): PersistableWorkflowEvent {
	return {
		eventType: event.kind,
		payloadJson: JSON.stringify(event),
		createdAtMs: event.timestamp,
	};
}

function parseWorkflowEvent(payloadJson: string, eventType: string): WorkflowEvent {
	const parsed = JSON.parse(payloadJson) as WorkflowEvent;
	if (parsed.kind !== eventType) {
		throw new AuthorityError(
			`Workflow event kind mismatch: expected ${eventType}, received ${parsed.kind}`,
		);
	}

	return parsed;
}

function toTaskIndexRecord(
	taskId: string,
	state: WorkflowState,
	latestEventSeq: number,
): TaskIndexRecord {
	return {
		taskId,
		externalState: state.externalState,
		internalPhase: state.internalPhase,
		prompt: state.submission?.prompt ?? "",
		latestEventSeq,
		createdAtMs: state.createdAtMs,
		updatedAtMs: state.updatedAtMs,
	};
}

function translateWireCommand(
	envelope: WireCommandEnvelope,
	phaseFivePlan: PhaseFivePlan,
): WorkflowCommand {
	const { command } = envelope;
	switch (command.kind) {
		case "submit_task":
			return {
				kind: "submit_task",
				commandId: command.commandId,
				taskId: command.taskId as WorkflowCommand["taskId"],
				prompt: command.prompt,
				bundleInputPath: command.bundleInput.path,
				...(command.requestedDomains ? { requestedDomains: command.requestedDomains } : {}),
				...(command.configProfile ? { configProfile: command.configProfile } : {}),
				plan: phaseFivePlan,
				submittedAtMs: command.submittedAtMs,
			};
		case "approve_task":
			return {
				kind: "approve_task",
				commandId: command.commandId,
				taskId: command.taskId as WorkflowCommand["taskId"],
				timestamp: command.submittedAtMs,
			};
		case "reject_task":
			throw new AuthorityError("reject_task is disabled in Phase 5");
		case "cancel_task":
			return {
				kind: "cancel_task",
				commandId: command.commandId,
				taskId: command.taskId as WorkflowCommand["taskId"],
				timestamp: command.submittedAtMs,
			};
		case "subscribe_task":
		case "get_task_snapshot":
			throw new AuthorityError(`${command.kind} is not a workflow write command`);
	}
}

export function createAuthority(deps: AuthorityDeps, maxIterations: number): Authority {
	const stateCache = new Map<string, WorkflowState>();
	const phaseFivePlan: PhaseFivePlan = {
		includeSynthesis: false,
		allowQueryBack: false,
		allowRerun: false,
	} as const;
	let queue = Promise.resolve();

	function loadTaskState(taskId: string): WorkflowState | null {
		const cached = stateCache.get(taskId);
		if (cached) {
			return cached;
		}

		const taskIndex = readTaskIndex(deps.db, taskId);
		if (!taskIndex) {
			return null;
		}

		const snapshotRecord = readLatestSnapshot(deps.db, taskId);
		const snapshot = snapshotRecord
			? (JSON.parse(snapshotRecord.snapshotJson) as WorkflowState)
			: undefined;
		const eventRecords = readWorkflowEvents(deps.db, taskId, snapshotRecord?.eventSeq).map(
			(record) => parseWorkflowEvent(record.payloadJson, record.eventType),
		);
		const state = projectState(eventRecords, snapshot);
		stateCache.set(taskId, state);
		return state;
	}

	async function commitCommand(command: WorkflowCommand): Promise<void> {
		const previousState =
			loadTaskState(command.taskId) ?? buildInitialState(command.taskId, maxIterations);
		const transition = applyCommand(previousState, command);
		if (transition.events.length === 0) {
			return;
		}

		let persistedEvents: readonly PersistedWorkflowEvent[] = [];
		withWriteTransaction(deps.db, () => {
			const records = appendWorkflowEventsAutoSeq(
				deps.db,
				command.taskId,
				transition.events.map(toPersistableWorkflowEvent),
			);
			persistedEvents = records.map((record) => ({
				seq: record.seq,
				event: parseWorkflowEvent(record.payloadJson, record.eventType),
			}));
			const latestEventSeq = records.at(-1)?.seq;
			if (latestEventSeq === undefined) {
				throw new AuthorityError(`Expected persisted workflow events for task ${command.taskId}`);
			}

			upsertTaskIndex(
				deps.db,
				toTaskIndexRecord(command.taskId, transition.newState, latestEventSeq),
			);
		});

		stateCache.set(command.taskId, transition.newState);

		const wireEvents = await deps.projector.projectCommit({
			taskId: command.taskId,
			prevState: previousState,
			nextState: transition.newState,
			events: persistedEvents,
			jobs: transition.jobs,
		});
		deps.broadcaster(command.taskId, wireEvents);
		deps.dispatcher(command.taskId);
	}

	async function enqueue(operation: () => Promise<void>): Promise<void> {
		const next = queue.then(operation, operation);
		queue = next.then(
			() => undefined,
			() => undefined,
		);
		return next;
	}

	return {
		async handleWireCommand(envelope: WireCommandEnvelope): Promise<void> {
			await enqueue(() => {
				return commitCommand(translateWireCommand(envelope, phaseFivePlan));
			});
		},

		async handleInternalCommand(command: WorkflowCommand): Promise<void> {
			await enqueue(() => {
				return commitCommand(command);
			});
		},

		getTaskState(taskId: string): WorkflowState | null {
			return loadTaskState(taskId);
		},
	};
}

import type {
	IssueId,
	PendingJob,
	RoomId,
	RoomRunResult,
	TaskId,
	WorkflowState,
} from "@the-hive/protocol/engine";

const DEFAULT_REQUESTED_DOMAINS = ["general"] as const;

interface WorkflowSubmission {
	readonly prompt: string;
	readonly bundleInputPath: string;
	readonly requestedDomains: readonly string[];
	readonly configProfile?: string;
}

interface WorkflowMetadata {
	readonly processedCommandIds: readonly string[];
	readonly queryBackSequence: number;
	readonly submission?: WorkflowSubmission;
}

interface WorkflowRuntimeState extends WorkflowState {
	readonly _workflow: WorkflowMetadata;
}

interface WorkflowCommandBase {
	readonly kind: string;
	readonly commandId: string;
	readonly taskId: TaskId;
}

interface TimedWorkflowCommandBase extends WorkflowCommandBase {
	readonly timestamp: number;
}

export interface SubmitTaskWorkflowCommand extends WorkflowCommandBase {
	readonly kind: "submit_task";
	readonly prompt: string;
	readonly bundleInputPath: string;
	readonly requestedDomains?: readonly string[];
	readonly configProfile?: string;
	readonly submittedAtMs: number;
}

export interface StartTaskWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "start_task";
}

export interface ContextBundleBuiltWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "context_bundle_built";
	readonly bundleId: string;
}

export interface RoomCompletedWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "room_completed";
	readonly roomId: RoomId;
	readonly result: RoomRunResult;
}

export interface RoomFailedWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "room_failed";
	readonly roomId: RoomId;
	readonly errorCode: string;
	readonly message: string;
}

export interface QueryRoomRequestedWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "query_room_requested";
	readonly synthesisRoomId: RoomId;
	readonly targetRoomId: RoomId;
	readonly question: string;
	readonly relevantIssueIds: readonly IssueId[];
}

export interface QueryResponseRecordedWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "query_response_recorded";
	readonly artifactId: string;
}

export interface ReviewPacketRenderedWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "review_packet_rendered";
	readonly version: number;
}

export interface ApproveTaskWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "approve_task";
}

export interface RejectTaskWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "reject_task";
	readonly feedback: string;
}

export interface CancelTaskWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "cancel_task";
}

export interface TaskFailedWorkflowCommand extends TimedWorkflowCommandBase {
	readonly kind: "task_failed";
	readonly errorCode: string;
	readonly message: string;
}

export type WorkflowCommand =
	| SubmitTaskWorkflowCommand
	| StartTaskWorkflowCommand
	| ContextBundleBuiltWorkflowCommand
	| RoomCompletedWorkflowCommand
	| RoomFailedWorkflowCommand
	| QueryRoomRequestedWorkflowCommand
	| QueryResponseRecordedWorkflowCommand
	| ReviewPacketRenderedWorkflowCommand
	| ApproveTaskWorkflowCommand
	| RejectTaskWorkflowCommand
	| CancelTaskWorkflowCommand
	| TaskFailedWorkflowCommand;

interface WorkflowEventBase {
	readonly kind: string;
	readonly commandId: string;
	readonly taskId: TaskId;
	readonly timestamp: number;
}

export interface TaskSubmittedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "task_submitted";
	readonly prompt: string;
	readonly bundleInputPath: string;
	readonly requestedDomains: readonly string[];
	readonly configProfile?: string;
	readonly maxIterations: number;
}

export interface TaskStartedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "task_started";
	readonly createdAtMs: number;
	readonly iteration: number;
	readonly maxIterations: number;
}

export interface ContextBundleBuiltWorkflowEvent extends WorkflowEventBase {
	readonly kind: "context_bundle_built";
	readonly bundleId: string;
}

export interface RoomJobEnqueuedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "room_job_enqueued";
	readonly job: PendingJob;
}

export interface RoomStartedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "room_started";
	readonly roomId: RoomId;
}

export interface RoomCompletedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "room_completed";
	readonly roomId: RoomId;
	readonly result: RoomRunResult;
}

export interface RoomFailedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "room_failed";
	readonly roomId: RoomId;
	readonly errorCode: string;
	readonly message: string;
	readonly critical: boolean;
}

export interface QueryRoomRequestedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "query_room_requested";
	readonly synthesisRoomId: RoomId;
	readonly targetRoomId: RoomId;
	readonly question: string;
	readonly relevantIssueIds: readonly IssueId[];
}

export interface QueryResponseRecordedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "query_response_recorded";
	readonly artifactId: string;
}

export interface ReviewPacketRenderedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "review_packet_rendered";
	readonly version: number;
}

export interface TaskReviewReadyWorkflowEvent extends WorkflowEventBase {
	readonly kind: "task_review_ready";
	readonly version: number;
}

export interface TaskApprovedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "task_approved";
}

export interface TaskRejectedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "task_rejected";
	readonly feedback: string;
}

export interface TaskCancelledWorkflowEvent extends WorkflowEventBase {
	readonly kind: "task_cancelled";
}

export interface TaskFailedWorkflowEvent extends WorkflowEventBase {
	readonly kind: "task_failed";
	readonly errorCode: string;
	readonly message: string;
}

export type WorkflowEvent =
	| TaskSubmittedWorkflowEvent
	| TaskStartedWorkflowEvent
	| ContextBundleBuiltWorkflowEvent
	| RoomJobEnqueuedWorkflowEvent
	| RoomStartedWorkflowEvent
	| RoomCompletedWorkflowEvent
	| RoomFailedWorkflowEvent
	| QueryRoomRequestedWorkflowEvent
	| QueryResponseRecordedWorkflowEvent
	| ReviewPacketRenderedWorkflowEvent
	| TaskReviewReadyWorkflowEvent
	| TaskApprovedWorkflowEvent
	| TaskRejectedWorkflowEvent
	| TaskCancelledWorkflowEvent
	| TaskFailedWorkflowEvent;

export interface WorkflowTransition {
	readonly newState: WorkflowState;
	readonly events: readonly WorkflowEvent[];
	readonly jobs: readonly PendingJob[];
}

class WorkflowError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkflowError";
	}
}

class WorkflowProjectionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorkflowProjectionError";
	}
}

export function buildInitialState(taskId: TaskId, maxIterations: number): WorkflowState {
	if (!Number.isInteger(maxIterations) || maxIterations < 1) {
		throw new WorkflowError("maxIterations must be a positive integer");
	}

	return {
		taskId,
		externalState: "submitted",
		internalPhase: "pending",
		iteration: 0,
		pendingJobs: [],
		completedRoomIds: [],
		reviewPacketVersion: 0,
		maxIterations,
		createdAtMs: 0,
		updatedAtMs: 0,
		_workflow: {
			processedCommandIds: [],
			queryBackSequence: 0,
		},
	} as WorkflowRuntimeState;
}

export function applyCommand(state: WorkflowState, command: WorkflowCommand): WorkflowTransition {
	const runtimeState = normalizeState(state);

	assertTaskMatch(runtimeState, command.taskId);
	if (runtimeState._workflow.processedCommandIds.includes(command.commandId)) {
		return {
			newState: runtimeState,
			events: [],
			jobs: [],
		};
	}

	const events = buildCommandEvents(runtimeState, command);
	return {
		newState: projectState(events, runtimeState),
		events,
		jobs: extractJobs(events),
	};
}

export function applyEvent(state: WorkflowState, event: WorkflowEvent): WorkflowState {
	const runtimeState = registerProcessedCommand(normalizeState(state), event.commandId);
	assertTaskMatch(runtimeState, event.taskId);

	switch (event.kind) {
		case "task_submitted":
			return withWorkflowMetadata(
				{
					...runtimeState,
					createdAtMs: runtimeState.createdAtMs === 0 ? event.timestamp : runtimeState.createdAtMs,
					updatedAtMs: event.timestamp,
				},
				{
					...runtimeState._workflow,
					submission: buildSubmission(event),
				},
			);
		case "task_started":
			return withWorkflowMetadata(
				{
					...runtimeState,
					externalState: "running",
					internalPhase: "building_context",
					iteration: event.iteration,
					maxIterations: event.maxIterations,
					createdAtMs:
						runtimeState.createdAtMs === 0 ? event.createdAtMs : runtimeState.createdAtMs,
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "context_bundle_built": {
			const nextState: WorkflowState = {
				...runtimeState,
				bundleId: event.bundleId,
				pendingJobs: runtimeState.pendingJobs.filter((job) => job.kind !== "build_context_bundle"),
				internalPhase: "mini_rooms",
				updatedAtMs: event.timestamp,
			};
			return withWorkflowMetadata(nextState, runtimeState._workflow);
		}
		case "room_job_enqueued":
			return withWorkflowMetadata(
				{
					...runtimeState,
					pendingJobs: enqueueJob(runtimeState.pendingJobs, event.job),
					internalPhase: phaseForJob(event.job.kind),
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "room_started":
			return withWorkflowMetadata(
				{
					...runtimeState,
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "room_completed": {
			const pendingJobs = removeRoomJob(runtimeState.pendingJobs, event.roomId, event.result.kind);
			const completedRoomIds =
				event.result.kind === "query_back"
					? runtimeState.completedRoomIds
					: runtimeState.completedRoomIds.includes(event.roomId)
						? runtimeState.completedRoomIds
						: [...runtimeState.completedRoomIds, event.roomId];
			return withWorkflowMetadata(
				{
					...runtimeState,
					pendingJobs,
					completedRoomIds,
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		}
		case "room_failed":
			return withWorkflowMetadata(
				{
					...runtimeState,
					pendingJobs: removeRoomJob(runtimeState.pendingJobs, event.roomId),
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "query_room_requested":
			return withWorkflowMetadata(
				{
					...runtimeState,
					internalPhase: "query_back",
					updatedAtMs: event.timestamp,
				},
				{
					...runtimeState._workflow,
					queryBackSequence: runtimeState._workflow.queryBackSequence + 1,
				},
			);
		case "query_response_recorded":
			return withWorkflowMetadata(
				{
					...runtimeState,
					internalPhase: "synthesis",
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "review_packet_rendered":
			return withWorkflowMetadata(
				{
					...runtimeState,
					pendingJobs: runtimeState.pendingJobs.filter(
						(job) => job.kind !== "render_review_packet",
					),
					reviewPacketVersion: event.version,
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "task_review_ready":
			return withWorkflowMetadata(
				{
					...runtimeState,
					externalState: "awaiting_review",
					internalPhase: "awaiting_review",
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "task_approved":
			return withWorkflowMetadata(
				{
					...runtimeState,
					externalState: "approved",
					pendingJobs: [],
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "task_rejected": {
			const { bundleId: _bundleId, ...restState } = runtimeState;
			const nextState: WorkflowState = {
				...restState,
				externalState: "rejected",
				internalPhase: "rerun",
				iteration: runtimeState.iteration + 1,
				pendingJobs: [],
				completedRoomIds: [],
				updatedAtMs: event.timestamp,
			};
			return withWorkflowMetadata(nextState, runtimeState._workflow);
		}
		case "task_cancelled":
			return withWorkflowMetadata(
				{
					...runtimeState,
					externalState: "cancelled",
					pendingJobs: [],
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		case "task_failed":
			return withWorkflowMetadata(
				{
					...runtimeState,
					externalState: "failed",
					pendingJobs: [],
					updatedAtMs: event.timestamp,
				},
				runtimeState._workflow,
			);
		default: {
			const unreachable: never = event;
			return unreachable;
		}
	}
}

export function projectState(
	events: readonly WorkflowEvent[],
	snapshot?: WorkflowState,
): WorkflowState {
	if (events.length === 0) {
		if (!snapshot) {
			throw new WorkflowProjectionError("projectState requires events or a snapshot");
		}
		return normalizeState(snapshot);
	}

	const firstEvent = events[0];
	if (!firstEvent) {
		throw new WorkflowProjectionError("projectState requires a first event");
	}

	const initialState = snapshot
		? normalizeState(snapshot)
		: buildInitialState(firstEvent.taskId, inferInitialMaxIterations(firstEvent));

	return events.reduce<WorkflowState>(
		(currentState, event) => applyEvent(currentState, event),
		initialState,
	);
}

function normalizeState(state: WorkflowState): WorkflowRuntimeState {
	const runtimeState = state as WorkflowRuntimeState;
	const submission = runtimeState._workflow?.submission;

	return {
		...state,
		_workflow: {
			processedCommandIds: runtimeState._workflow?.processedCommandIds ?? [],
			queryBackSequence: runtimeState._workflow?.queryBackSequence ?? 0,
			...(submission ? { submission: { ...submission } } : {}),
		},
	} as WorkflowRuntimeState;
}

function buildCommandEvents(
	state: WorkflowRuntimeState,
	command: WorkflowCommand,
): readonly WorkflowEvent[] {
	switch (command.kind) {
		case "submit_task": {
			assertPhase(state, "pending", command.kind);
			const requestedDomains = normalizeRequestedDomains(command.requestedDomains);
			const submissionEvent: TaskSubmittedWorkflowEvent = {
				kind: "task_submitted",
				commandId: command.commandId,
				taskId: command.taskId,
				timestamp: command.submittedAtMs,
				prompt: command.prompt,
				bundleInputPath: command.bundleInputPath,
				requestedDomains,
				...(command.configProfile ? { configProfile: command.configProfile } : {}),
				maxIterations: state.maxIterations,
			};
			const startedEvent = createTaskStartedEvent(command, state, command.submittedAtMs);
			const buildJob = createBuildContextJob(
				command.taskId,
				state.iteration,
				buildSubmission(submissionEvent),
			);
			return [
				submissionEvent,
				startedEvent,
				createRoomJobEnqueuedEvent(command, buildJob, command.submittedAtMs),
			];
		}
		case "start_task": {
			assertPhase(state, "pending", command.kind);
			const submission = requireSubmission(state, command.kind);
			const startedEvent = createTaskStartedEvent(command, state, command.timestamp);
			const buildJob = createBuildContextJob(command.taskId, state.iteration, submission);
			return [startedEvent, createRoomJobEnqueuedEvent(command, buildJob, command.timestamp)];
		}
		case "context_bundle_built": {
			assertPhase(state, "building_context", command.kind);
			requirePendingJob(state, "build_context_bundle", command.kind);
			const submission = requireSubmission(state, command.kind);
			const builtEvent: ContextBundleBuiltWorkflowEvent = {
				kind: "context_bundle_built",
				commandId: command.commandId,
				taskId: command.taskId,
				timestamp: command.timestamp,
				bundleId: command.bundleId,
			};
			const roomEvents = submission.requestedDomains.map((domain, index) =>
				createRoomJobEnqueuedEvent(
					command,
					createDomainRoomJob(command.taskId, state.iteration, command.bundleId, domain, index),
					command.timestamp,
				),
			);
			return [builtEvent, ...roomEvents];
		}
		case "room_completed": {
			requireRoomPhase(state, command.result.kind, command.kind);
			requireRoomJob(state, command.roomId, command.kind, command.result.kind);
			if (command.result.outcome !== "completed") {
				throw new WorkflowError(
					`room_completed requires outcome completed, received ${command.result.outcome}`,
				);
			}
			if (command.result.roomId !== command.roomId) {
				throw new WorkflowError(
					`room_completed result roomId ${command.result.roomId} does not match command roomId ${command.roomId}`,
				);
			}
			const completedEvent: RoomCompletedWorkflowEvent = {
				kind: "room_completed",
				commandId: command.commandId,
				taskId: command.taskId,
				timestamp: command.timestamp,
				roomId: command.roomId,
				result: command.result,
			};

			if (command.result.kind === "domain") {
				const remainingDomainJobs = removeRoomJob(
					state.pendingJobs,
					command.roomId,
					"domain",
				).filter((job) => job.kind === "run_domain_room");
				if (remainingDomainJobs.length === 0) {
					const synthesisJob = createSynthesisRoomJob(
						command.taskId,
						state.iteration,
						state.completedRoomIds.includes(command.roomId)
							? state.completedRoomIds
							: [...state.completedRoomIds, command.roomId],
					);
					return [
						completedEvent,
						createRoomJobEnqueuedEvent(command, synthesisJob, command.timestamp),
					];
				}
			}

			if (command.result.kind === "synthesis") {
				const renderJob = createRenderReviewPacketJob(
					command.taskId,
					state.iteration,
					state.reviewPacketVersion + 1,
				);
				return [completedEvent, createRoomJobEnqueuedEvent(command, renderJob, command.timestamp)];
			}

			return [completedEvent];
		}
		case "room_failed": {
			const roomJob = requireRoomJob(state, command.roomId, command.kind);
			requireRoomPhase(state, roomKindForJob(roomJob.kind), command.kind);
			const failedEvent: RoomFailedWorkflowEvent = {
				kind: "room_failed",
				commandId: command.commandId,
				taskId: command.taskId,
				timestamp: command.timestamp,
				roomId: command.roomId,
				errorCode: command.errorCode,
				message: command.message,
				critical: true,
			};
			return [
				failedEvent,
				createTaskFailedEvent(command, command.timestamp, command.errorCode, command.message),
			];
		}
		case "query_room_requested": {
			assertPhase(state, "synthesis", command.kind);
			const activeSynthesisRoomJob = requirePendingJob(state, "run_synthesis_room", command.kind);
			const activeSynthesisRoomId = (activeSynthesisRoomJob.payload as { readonly roomId?: RoomId })
				.roomId;
			if (activeSynthesisRoomId !== command.synthesisRoomId) {
				throw new WorkflowError(
					`query_room_requested requires active synthesis room ${command.synthesisRoomId}`,
				);
			}
			if (!state.completedRoomIds.includes(command.targetRoomId)) {
				throw new WorkflowError(
					`query_room_requested requires completed source room ${command.targetRoomId}`,
				);
			}
			if (!isDomainRoomId(command.targetRoomId)) {
				throw new WorkflowError(
					`query_room_requested requires domain source room ${command.targetRoomId}`,
				);
			}
			const queryJob = createQueryBackRoomJob(command, state);
			const requestedEvent: QueryRoomRequestedWorkflowEvent = {
				kind: "query_room_requested",
				commandId: command.commandId,
				taskId: command.taskId,
				timestamp: command.timestamp,
				synthesisRoomId: command.synthesisRoomId,
				targetRoomId: command.targetRoomId,
				question: command.question,
				relevantIssueIds: command.relevantIssueIds,
			};
			return [requestedEvent, createRoomJobEnqueuedEvent(command, queryJob, command.timestamp)];
		}
		case "query_response_recorded": {
			assertNonTerminal(state, command.kind);
			assertPhase(state, "query_back", command.kind);
			if (state.pendingJobs.some((job) => job.kind === "run_query_back_room")) {
				throw new WorkflowError(
					"query_response_recorded requires all run_query_back_room jobs to be completed first",
				);
			}
			const recordedEvent: QueryResponseRecordedWorkflowEvent = {
				kind: "query_response_recorded",
				commandId: command.commandId,
				taskId: command.taskId,
				timestamp: command.timestamp,
				artifactId: command.artifactId,
			};
			return [recordedEvent];
		}
		case "review_packet_rendered": {
			assertPhase(state, "rendering", command.kind);
			requirePendingJob(state, "render_review_packet", command.kind);
			return [
				{
					kind: "review_packet_rendered",
					commandId: command.commandId,
					taskId: command.taskId,
					timestamp: command.timestamp,
					version: command.version,
				},
				{
					kind: "task_review_ready",
					commandId: command.commandId,
					taskId: command.taskId,
					timestamp: command.timestamp,
					version: command.version,
				},
			];
		}
		case "approve_task": {
			assertAwaitingReview(state, command.kind);
			return [
				{
					kind: "task_approved",
					commandId: command.commandId,
					taskId: command.taskId,
					timestamp: command.timestamp,
				},
			];
		}
		case "reject_task": {
			assertAwaitingReview(state, command.kind);
			const rejectedEvent: TaskRejectedWorkflowEvent = {
				kind: "task_rejected",
				commandId: command.commandId,
				taskId: command.taskId,
				timestamp: command.timestamp,
				feedback: command.feedback,
			};
			const nextIteration = state.iteration + 1;
			if (nextIteration > state.maxIterations) {
				return [
					rejectedEvent,
					createTaskFailedEvent(
						command,
						command.timestamp,
						"max_iterations_exceeded",
						"Task exceeded maxIterations after rejection",
					),
				];
			}

			const buildJob = createBuildContextJob(
				command.taskId,
				nextIteration,
				requireSubmission(state, command.kind),
				command.feedback,
			);
			return [
				rejectedEvent,
				createTaskStartedEvent(command, state, command.timestamp, nextIteration),
				createRoomJobEnqueuedEvent(command, buildJob, command.timestamp),
			];
		}
		case "cancel_task": {
			assertNonTerminal(state, command.kind);
			return [
				{
					kind: "task_cancelled",
					commandId: command.commandId,
					taskId: command.taskId,
					timestamp: command.timestamp,
				},
			];
		}
		case "task_failed": {
			assertNonTerminal(state, command.kind);
			return [
				createTaskFailedEvent(command, command.timestamp, command.errorCode, command.message),
			];
		}
		default: {
			const unreachable: never = command;
			return unreachable;
		}
	}
}

function createTaskStartedEvent(
	command: WorkflowCommandBase,
	state: WorkflowRuntimeState,
	timestamp: number,
	iteration = state.iteration,
): TaskStartedWorkflowEvent {
	return {
		kind: "task_started",
		commandId: command.commandId,
		taskId: command.taskId,
		timestamp,
		createdAtMs: state.createdAtMs === 0 ? timestamp : state.createdAtMs,
		iteration,
		maxIterations: state.maxIterations,
	};
}

function createTaskFailedEvent(
	command: WorkflowCommandBase,
	timestamp: number,
	errorCode: string,
	message: string,
): TaskFailedWorkflowEvent {
	return {
		kind: "task_failed",
		commandId: command.commandId,
		taskId: command.taskId,
		timestamp,
		errorCode,
		message,
	};
}

function createRoomJobEnqueuedEvent(
	command: WorkflowCommandBase,
	job: PendingJob,
	timestamp: number,
): RoomJobEnqueuedWorkflowEvent {
	return {
		kind: "room_job_enqueued",
		commandId: command.commandId,
		taskId: command.taskId,
		timestamp,
		job,
	};
}

function createBuildContextJob(
	taskId: TaskId,
	iteration: number,
	submission: WorkflowSubmission,
	feedback?: string,
): PendingJob {
	return {
		jobId: `task:${taskId}:build_context:${iteration}`,
		taskId,
		kind: "build_context_bundle",
		payload: {
			prompt: submission.prompt,
			bundleInputPath: submission.bundleInputPath,
			requestedDomains: submission.requestedDomains,
			iteration,
			...(submission.configProfile ? { configProfile: submission.configProfile } : {}),
			...(feedback ? { feedback } : {}),
		},
		dedupeKey: `build_context:${taskId}:${iteration}`,
	};
}

function createDomainRoomJob(
	taskId: TaskId,
	iteration: number,
	bundleId: string,
	domain: string,
	index: number,
): PendingJob {
	const roomId = `room:${taskId}:domain:${iteration}:${index}:${domain}` as RoomId;
	return {
		jobId: `job:${roomId}`,
		taskId,
		kind: "run_domain_room",
		payload: {
			roomId,
			domain,
			bundleId,
			iteration,
		},
		dedupeKey: `domain:${taskId}:${iteration}:${domain}`,
	};
}

function createSynthesisRoomJob(
	taskId: TaskId,
	iteration: number,
	completedRoomIds: readonly RoomId[],
): PendingJob {
	const roomId = `room:${taskId}:synthesis:${iteration}` as RoomId;
	return {
		jobId: `job:${roomId}`,
		taskId,
		kind: "run_synthesis_room",
		payload: {
			roomId,
			iteration,
			sourceRoomIds: completedRoomIds,
		},
		dedupeKey: `synthesis:${taskId}:${iteration}`,
	};
}

function createQueryBackRoomJob(
	command: QueryRoomRequestedWorkflowCommand,
	state: WorkflowRuntimeState,
): PendingJob {
	const queryIndex = state._workflow.queryBackSequence + 1;
	const roomId = `room:${command.taskId}:query:${state.iteration}:${queryIndex}` as RoomId;
	return {
		jobId: `job:${roomId}`,
		taskId: command.taskId,
		kind: "run_query_back_room",
		payload: {
			roomId,
			synthesisRoomId: command.synthesisRoomId,
			targetRoomId: command.targetRoomId,
			question: command.question,
			relevantIssueIds: command.relevantIssueIds,
			iteration: state.iteration,
		},
		dedupeKey: `query:${command.taskId}:${state.iteration}:${command.targetRoomId}:${command.question}`,
	};
}

function createRenderReviewPacketJob(
	taskId: TaskId,
	iteration: number,
	version: number,
): PendingJob {
	return {
		jobId: `task:${taskId}:render:${version}`,
		taskId,
		kind: "render_review_packet",
		payload: {
			version,
			iteration,
		},
		dedupeKey: `render:${taskId}:${version}`,
	};
}

function enqueueJob(pendingJobs: readonly PendingJob[], job: PendingJob): readonly PendingJob[] {
	if (
		pendingJobs.some(
			(existingJob) => existingJob.jobId === job.jobId || existingJob.dedupeKey === job.dedupeKey,
		)
	) {
		return pendingJobs;
	}

	return [...pendingJobs, job];
}

function removeRoomJob(
	pendingJobs: readonly PendingJob[],
	roomId: RoomId,
	kind?: RoomRunResult["kind"],
): readonly PendingJob[] {
	return pendingJobs.filter((job) => {
		if (!isRoomJob(job)) {
			return true;
		}

		if (kind && kind !== roomKindForJob(job.kind)) {
			return true;
		}

		return job.payload.roomId !== roomId;
	});
}

function isRoomJob(
	job: PendingJob,
): job is PendingJob & { readonly payload: { readonly roomId: RoomId } } {
	if (
		job.kind !== "run_domain_room" &&
		job.kind !== "run_synthesis_room" &&
		job.kind !== "run_query_back_room"
	) {
		return false;
	}

	const payload = job.payload as { readonly roomId?: RoomId };
	return typeof payload.roomId === "string";
}

function roomKindForJob(jobKind: PendingJob["kind"]): RoomRunResult["kind"] | null {
	switch (jobKind) {
		case "run_domain_room":
			return "domain";
		case "run_synthesis_room":
			return "synthesis";
		case "run_query_back_room":
			return "query_back";
		default:
			return null;
	}
}

function requireRoomPhase(
	state: WorkflowState,
	roomKind: RoomRunResult["kind"] | null,
	commandKind: WorkflowCommand["kind"],
): void {
	if (!roomKind) {
		throw new WorkflowError(`${commandKind} requires a room kind`);
	}

	const expectedPhase = phaseForRoomKind(roomKind);
	if (state.internalPhase !== expectedPhase) {
		throw new WorkflowError(`${commandKind} requires internalPhase ${expectedPhase}`);
	}
}

function phaseForRoomKind(kind: RoomRunResult["kind"]): WorkflowState["internalPhase"] {
	switch (kind) {
		case "domain":
			return "mini_rooms";
		case "synthesis":
			return "synthesis";
		case "query_back":
			return "query_back";
		default: {
			const unreachable: never = kind;
			return unreachable;
		}
	}
}

function isDomainRoomId(roomId: RoomId): boolean {
	return roomId.includes(":domain:");
}

function extractJobs(events: readonly WorkflowEvent[]): readonly PendingJob[] {
	return events.flatMap((event) => (event.kind === "room_job_enqueued" ? [event.job] : []));
}

function normalizeRequestedDomains(requestedDomains?: readonly string[]): readonly string[] {
	if (!requestedDomains || requestedDomains.length === 0) {
		return DEFAULT_REQUESTED_DOMAINS;
	}

	return [...new Set(requestedDomains)];
}

function buildSubmission(event: TaskSubmittedWorkflowEvent): WorkflowSubmission {
	return {
		prompt: event.prompt,
		bundleInputPath: event.bundleInputPath,
		requestedDomains: event.requestedDomains,
		...(event.configProfile ? { configProfile: event.configProfile } : {}),
	};
}

function requireSubmission(
	state: WorkflowRuntimeState,
	commandKind: WorkflowCommand["kind"],
): WorkflowSubmission {
	const submission = state._workflow.submission;
	if (!submission) {
		throw new WorkflowError(`${commandKind} requires submission metadata`);
	}

	return submission;
}

function requirePendingJob(
	state: WorkflowRuntimeState,
	kind: PendingJob["kind"],
	commandKind: WorkflowCommand["kind"],
): PendingJob {
	const job = state.pendingJobs.find((candidate) => candidate.kind === kind);
	if (!job) {
		throw new WorkflowError(`${commandKind} requires a pending ${kind} job`);
	}

	return job;
}

function requireRoomJob(
	state: WorkflowRuntimeState,
	roomId: RoomId,
	commandKind: WorkflowCommand["kind"],
	expectedRoomKind?: RoomRunResult["kind"],
): PendingJob {
	const roomJob = state.pendingJobs.find((job) => isRoomJob(job) && job.payload.roomId === roomId);
	if (!roomJob) {
		throw new WorkflowError(`${commandKind} requires a pending room job for ${roomId}`);
	}

	if (expectedRoomKind) {
		const actualRoomKind = roomKindForJob(roomJob.kind);
		if (actualRoomKind !== expectedRoomKind) {
			throw new WorkflowError(
				`${commandKind} expected ${expectedRoomKind} room job for ${roomId}, received ${actualRoomKind}`,
			);
		}
	}

	return roomJob;
}

function registerProcessedCommand(
	state: WorkflowRuntimeState,
	commandId: string,
): WorkflowRuntimeState {
	if (state._workflow.processedCommandIds.includes(commandId)) {
		return state;
	}

	return withWorkflowMetadata(state, {
		...state._workflow,
		processedCommandIds: [...state._workflow.processedCommandIds, commandId],
		queryBackSequence: state._workflow.queryBackSequence,
		...(state._workflow.submission ? { submission: state._workflow.submission } : {}),
	});
}

function withWorkflowMetadata(
	state: WorkflowState,
	metadata: WorkflowMetadata,
): WorkflowRuntimeState {
	return {
		...state,
		_workflow: metadata,
	} as WorkflowRuntimeState;
}

function assertTaskMatch(state: WorkflowState, taskId: TaskId): void {
	if (state.taskId !== taskId) {
		throw new WorkflowError(`taskId mismatch: expected ${state.taskId}, received ${taskId}`);
	}
}

function assertPhase(
	state: WorkflowState,
	phase: WorkflowState["internalPhase"],
	commandKind: WorkflowCommand["kind"],
): void {
	if (state.internalPhase !== phase) {
		throw new WorkflowError(`${commandKind} requires internalPhase ${phase}`);
	}
}

function assertAwaitingReview(state: WorkflowState, commandKind: WorkflowCommand["kind"]): void {
	if (state.externalState !== "awaiting_review" || state.internalPhase !== "awaiting_review") {
		throw new WorkflowError(`${commandKind} requires awaiting_review state`);
	}
}

function assertNonTerminal(state: WorkflowState, commandKind: WorkflowCommand["kind"]): void {
	if (
		state.externalState === "approved" ||
		state.externalState === "cancelled" ||
		state.externalState === "failed"
	) {
		throw new WorkflowError(
			`${commandKind} is not allowed in terminal state ${state.externalState}`,
		);
	}
}

function phaseForJob(kind: PendingJob["kind"]): WorkflowState["internalPhase"] {
	switch (kind) {
		case "build_context_bundle":
			return "building_context";
		case "run_domain_room":
			return "mini_rooms";
		case "run_synthesis_room":
			return "synthesis";
		case "run_query_back_room":
			return "query_back";
		case "render_review_packet":
			return "rendering";
		default: {
			const unreachable: never = kind;
			return unreachable;
		}
	}
}

function inferInitialMaxIterations(event: WorkflowEvent): number {
	if (event.kind === "task_submitted" || event.kind === "task_started") {
		return event.maxIterations;
	}

	throw new WorkflowProjectionError(
		`cannot build initial state from first event kind ${event.kind}`,
	);
}

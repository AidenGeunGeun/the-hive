import {
	type RoomKind,
	type RoomRunResult,
	type WorkflowState,
	createAgentId,
	createIssueId,
	createRoomId,
	createTaskId,
	createTurnId,
} from "@the-hive/protocol/engine";
import { describe, expect, it } from "vitest";

import {
	type WorkflowCommand,
	type WorkflowEvent,
	applyCommand,
	applyEvent,
	buildInitialState,
	projectState,
} from "../src/index";

function createSubmitTaskCommand(taskId = createTaskId()): WorkflowCommand {
	return {
		kind: "submit_task",
		commandId: `submit:${taskId}`,
		taskId,
		prompt: "Design the architecture",
		bundleInputPath: "/tmp/context.json",
		requestedDomains: ["frontend", "backend"],
		configProfile: "default",
		submittedAtMs: 100,
	};
}

function createTaskSubmittedEvent(
	taskId: ReturnType<typeof createTaskId>,
	maxIterations = 2,
): WorkflowEvent {
	return {
		kind: "task_submitted",
		commandId: `submitted:${taskId}`,
		taskId,
		timestamp: 100,
		prompt: "Design the architecture",
		bundleInputPath: "/tmp/context.json",
		requestedDomains: ["frontend", "backend"],
		configProfile: "default",
		maxIterations,
	};
}

function createDomainRoomResult(
	roomId: ReturnType<typeof createRoomId>,
	completedAtMs: number,
	kind: RoomKind = "domain",
): RoomRunResult {
	return {
		roomId,
		kind,
		outcome: "completed",
		ledgerEntries: [
			{
				seq: 1,
				turnId: createTurnId(),
				agentId: createAgentId(),
				action: {
					kind: "create_issue",
					issueId: createIssueId(),
					title: `${kind} issue`,
					description: "Issue description",
				},
				timestamp: completedAtMs,
			},
		],
		turnTraces: [],
		renderedArtifact: {
			kind:
				kind === "synthesis"
					? "review_packet_markdown"
					: kind === "query_back"
						? "query_response_markdown"
						: "report_markdown",
			content: `artifact:${roomId}`,
		},
		health: {
			totalAgents: 3,
			activeAgents: 3,
			failedAgents: 0,
			minHealthyAgents: 2,
			isHealthy: true,
		},
		startedAtMs: completedAtMs - 5,
		completedAtMs,
	};
}

function applyCommands(
	initialState: WorkflowState,
	commands: readonly WorkflowCommand[],
): { readonly state: WorkflowState; readonly events: readonly WorkflowEvent[] } {
	let currentState = initialState;
	const events: WorkflowEvent[] = [];

	for (const command of commands) {
		const transition = applyCommand(currentState, command);
		currentState = transition.newState;
		events.push(...transition.events);
	}

	return {
		state: currentState,
		events,
	};
}

function buildMiniRoomState() {
	const taskId = createTaskId();
	const initialState = buildInitialState(taskId, 2);
	const submitCommand = createSubmitTaskCommand(taskId);
	const submitted = applyCommand(initialState, submitCommand);
	const contextBuilt = applyCommand(submitted.newState, {
		kind: "context_bundle_built",
		commandId: `bundle:${taskId}`,
		taskId,
		timestamp: 110,
		bundleId: "bundle-1",
	});

	return {
		taskId,
		state: contextBuilt.newState,
		jobs: contextBuilt.jobs,
	};
}

function buildSynthesisState() {
	const { taskId, state, jobs } = buildMiniRoomState();
	const [firstRoomJob, secondRoomJob] = jobs;
	const firstDomainRoomId = (firstRoomJob?.payload as { readonly roomId: string }).roomId;
	const secondDomainRoomId = (secondRoomJob?.payload as { readonly roomId: string }).roomId;

	const afterFirstRoom = applyCommand(state, {
		kind: "room_completed",
		commandId: `room-complete:1:${taskId}`,
		taskId,
		timestamp: 120,
		roomId: firstDomainRoomId as ReturnType<typeof createRoomId>,
		result: createDomainRoomResult(firstDomainRoomId as ReturnType<typeof createRoomId>, 120),
	});

	const afterSecondRoom = applyCommand(afterFirstRoom.newState, {
		kind: "room_completed",
		commandId: `room-complete:2:${taskId}`,
		taskId,
		timestamp: 130,
		roomId: secondDomainRoomId as ReturnType<typeof createRoomId>,
		result: createDomainRoomResult(secondDomainRoomId as ReturnType<typeof createRoomId>, 130),
	});

	return {
		taskId,
		state: afterSecondRoom.newState,
		jobs: afterSecondRoom.jobs,
	};
}

function buildAwaitingReviewState(maxIterations = 2) {
	const { taskId, state, jobs } = buildSynthesisState();
	const synthesisRoomId = (jobs[0]?.payload as { readonly roomId: string }).roomId;
	const afterSynthesis = applyCommand(state, {
		kind: "room_completed",
		commandId: `synthesis-complete:${taskId}`,
		taskId,
		timestamp: 140,
		roomId: synthesisRoomId as ReturnType<typeof createRoomId>,
		result: createDomainRoomResult(
			synthesisRoomId as ReturnType<typeof createRoomId>,
			140,
			"synthesis",
		),
	});

	const rendered = applyCommand(
		{
			...afterSynthesis.newState,
			maxIterations,
		},
		{
			kind: "review_packet_rendered",
			commandId: `rendered:${taskId}`,
			taskId,
			timestamp: 150,
			version: 1,
		},
	);

	return {
		taskId,
		state: rendered.newState,
	};
}

describe("workflow reducer", () => {
	it("submits a task and enqueues the context bundle job", () => {
		const taskId = createTaskId();
		const state = buildInitialState(taskId, 2);
		const transition = applyCommand(state, createSubmitTaskCommand(taskId));

		expect(transition.events.map((event) => event.kind)).toEqual([
			"task_submitted",
			"task_started",
			"room_job_enqueued",
		]);
		expect(transition.jobs).toHaveLength(1);
		expect(transition.jobs[0]).toMatchObject({
			taskId,
			kind: "build_context_bundle",
			payload: {
				prompt: "Design the architecture",
				bundleInputPath: "/tmp/context.json",
				requestedDomains: ["frontend", "backend"],
				configProfile: "default",
			},
		});
		expect(transition.newState.externalState).toBe("running");
		expect(transition.newState.internalPhase).toBe("building_context");
		expect(transition.newState.pendingJobs).toEqual(transition.jobs);
	});

	it("starts a submitted task without re-emitting task_submitted", () => {
		const taskId = createTaskId();
		const pendingState = applyEvent(buildInitialState(taskId, 2), createTaskSubmittedEvent(taskId));

		const transition = applyCommand(pendingState, {
			kind: "start_task",
			commandId: `start:${taskId}`,
			taskId,
			timestamp: 101,
		});

		expect(transition.events.map((event) => event.kind)).toEqual([
			"task_started",
			"room_job_enqueued",
		]);
		expect(transition.newState.internalPhase).toBe("building_context");
		expect(transition.newState.externalState).toBe("running");
	});

	it("records bundle completion and enqueues domain room jobs", () => {
		const taskId = createTaskId();
		const startedState = applyCommand(
			buildInitialState(taskId, 2),
			createSubmitTaskCommand(taskId),
		).newState;

		const transition = applyCommand(startedState, {
			kind: "context_bundle_built",
			commandId: `bundle:${taskId}`,
			taskId,
			timestamp: 110,
			bundleId: "bundle-1",
		});

		expect(transition.events.map((event) => event.kind)).toEqual([
			"context_bundle_built",
			"room_job_enqueued",
			"room_job_enqueued",
		]);
		expect(transition.jobs).toHaveLength(2);
		expect(transition.jobs.map((job) => job.kind)).toEqual(["run_domain_room", "run_domain_room"]);
		expect(transition.newState.bundleId).toBe("bundle-1");
		expect(transition.newState.internalPhase).toBe("mini_rooms");
		expect(transition.newState.pendingJobs.map((job) => job.kind)).toEqual([
			"run_domain_room",
			"run_domain_room",
		]);
	});

	it("deduplicates requested domains before enqueuing domain room jobs", () => {
		const taskId = createTaskId();
		const startedState = applyCommand(buildInitialState(taskId, 2), {
			kind: "submit_task",
			commandId: `submit-duplicate-domains:${taskId}`,
			taskId,
			prompt: "Design the architecture",
			bundleInputPath: "/tmp/context.json",
			requestedDomains: ["frontend", "frontend", "backend"],
			submittedAtMs: 100,
		}).newState;

		const transition = applyCommand(startedState, {
			kind: "context_bundle_built",
			commandId: `bundle-deduped:${taskId}`,
			taskId,
			timestamp: 110,
			bundleId: "bundle-1",
		});

		expect(transition.jobs).toHaveLength(2);
		expect(transition.newState.pendingJobs).toHaveLength(2);
		expect(
			new Set(transition.jobs.map((job) => (job.payload as { readonly domain: string }).domain)),
		).toEqual(new Set(["frontend", "backend"]));
	});

	it("tracks domain room completion and starts synthesis after the last domain room", () => {
		const { taskId, state, jobs } = buildMiniRoomState();
		const [firstRoomJob, secondRoomJob] = jobs;
		const firstRoomId = (firstRoomJob?.payload as { readonly roomId: string }).roomId;
		const secondRoomId = (secondRoomJob?.payload as { readonly roomId: string }).roomId;

		const firstTransition = applyCommand(state, {
			kind: "room_completed",
			commandId: `domain-1:${taskId}`,
			taskId,
			timestamp: 120,
			roomId: firstRoomId as ReturnType<typeof createRoomId>,
			result: createDomainRoomResult(firstRoomId as ReturnType<typeof createRoomId>, 120),
		});

		expect(firstTransition.events.map((event) => event.kind)).toEqual(["room_completed"]);
		expect(firstTransition.jobs).toHaveLength(0);
		expect(firstTransition.newState.completedRoomIds).toContain(
			firstRoomId as ReturnType<typeof createRoomId>,
		);
		expect(firstTransition.newState.pendingJobs).toHaveLength(1);
		expect(firstTransition.newState.internalPhase).toBe("mini_rooms");

		const secondTransition = applyCommand(firstTransition.newState, {
			kind: "room_completed",
			commandId: `domain-2:${taskId}`,
			taskId,
			timestamp: 130,
			roomId: secondRoomId as ReturnType<typeof createRoomId>,
			result: createDomainRoomResult(secondRoomId as ReturnType<typeof createRoomId>, 130),
		});

		expect(secondTransition.events.map((event) => event.kind)).toEqual([
			"room_completed",
			"room_job_enqueued",
		]);
		expect(secondTransition.jobs).toHaveLength(1);
		expect(secondTransition.jobs[0]?.kind).toBe("run_synthesis_room");
		expect(secondTransition.newState.internalPhase).toBe("synthesis");
	});

	it("completes synthesis and enqueues review packet rendering", () => {
		const { taskId, state, jobs } = buildSynthesisState();
		const synthesisRoomId = (jobs[0]?.payload as { readonly roomId: string }).roomId;

		const transition = applyCommand(state, {
			kind: "room_completed",
			commandId: `synthesis:${taskId}`,
			taskId,
			timestamp: 140,
			roomId: synthesisRoomId as ReturnType<typeof createRoomId>,
			result: createDomainRoomResult(
				synthesisRoomId as ReturnType<typeof createRoomId>,
				140,
				"synthesis",
			),
		});

		expect(transition.events.map((event) => event.kind)).toEqual([
			"room_completed",
			"room_job_enqueued",
		]);
		expect(transition.jobs).toHaveLength(1);
		expect(transition.jobs[0]?.kind).toBe("render_review_packet");
		expect(transition.newState.internalPhase).toBe("rendering");
	});

	it("transitions synthesis to query_back and returns to synthesis after artifact recording", () => {
		const { taskId, state, jobs } = buildSynthesisState();
		const synthesisRoomId = (jobs[0]?.payload as { readonly roomId: string }).roomId;
		const [targetRoomId] = state.completedRoomIds;

		const queryTransition = applyCommand(state, {
			kind: "query_room_requested",
			commandId: `query:${taskId}`,
			taskId,
			timestamp: 135,
			synthesisRoomId: synthesisRoomId as ReturnType<typeof createRoomId>,
			targetRoomId: targetRoomId as ReturnType<typeof createRoomId>,
			question: "What contract should the backend expose?",
			relevantIssueIds: [createIssueId()],
		});

		expect(queryTransition.events.map((event) => event.kind)).toEqual([
			"query_room_requested",
			"room_job_enqueued",
		]);
		expect(queryTransition.jobs).toHaveLength(1);
		expect(queryTransition.jobs[0]?.kind).toBe("run_query_back_room");
		expect(queryTransition.newState.internalPhase).toBe("query_back");
		expect(() =>
			applyCommand(queryTransition.newState, {
				kind: "room_completed",
				commandId: `paused-synthesis-complete:${taskId}`,
				taskId,
				timestamp: 135,
				roomId: synthesisRoomId as ReturnType<typeof createRoomId>,
				result: createDomainRoomResult(
					synthesisRoomId as ReturnType<typeof createRoomId>,
					135,
					"synthesis",
				),
			}),
		).toThrow(/internalPhase synthesis/);
		expect(() =>
			applyCommand(queryTransition.newState, {
				kind: "room_failed",
				commandId: `paused-synthesis-failed:${taskId}`,
				taskId,
				timestamp: 135,
				roomId: synthesisRoomId as ReturnType<typeof createRoomId>,
				errorCode: "synthesis_room_failed",
				message: "Paused synthesis should not fail here",
			}),
		).toThrow(/internalPhase synthesis/);

		const queryRoomId = (queryTransition.jobs[0]?.payload as { readonly roomId: string }).roomId;
		const completedTransition = applyCommand(queryTransition.newState, {
			kind: "room_completed",
			commandId: `query-room-complete:${taskId}`,
			taskId,
			timestamp: 136,
			roomId: queryRoomId as ReturnType<typeof createRoomId>,
			result: createDomainRoomResult(
				queryRoomId as ReturnType<typeof createRoomId>,
				136,
				"query_back",
			),
		});

		expect(completedTransition.jobs).toHaveLength(0);
		expect(completedTransition.newState.internalPhase).toBe("query_back");
		expect(completedTransition.newState.completedRoomIds).not.toContain(
			queryRoomId as ReturnType<typeof createRoomId>,
		);

		const responseTransition = applyCommand(completedTransition.newState, {
			kind: "query_response_recorded",
			commandId: `query-response:${taskId}`,
			taskId,
			timestamp: 137,
			artifactId: "artifact-1",
		});

		expect(responseTransition.events.map((event) => event.kind)).toEqual([
			"query_response_recorded",
		]);
		expect(responseTransition.newState.internalPhase).toBe("synthesis");
		expect(responseTransition.newState.pendingJobs.map((job) => job.kind)).toEqual([
			"run_synthesis_room",
		]);

		const secondQueryTransition = applyCommand(responseTransition.newState, {
			kind: "query_room_requested",
			commandId: `query-2:${taskId}`,
			taskId,
			timestamp: 138,
			synthesisRoomId: synthesisRoomId as ReturnType<typeof createRoomId>,
			targetRoomId: targetRoomId as ReturnType<typeof createRoomId>,
			question: "One more clarification?",
			relevantIssueIds: [createIssueId()],
		});

		const secondQueryRoomId = (
			secondQueryTransition.jobs[0]?.payload as { readonly roomId: string }
		).roomId;
		expect(secondQueryRoomId).not.toBe(queryRoomId);
	});

	it("fails the task when a room fails critically", () => {
		const { taskId, state, jobs } = buildMiniRoomState();
		const failedRoomId = (jobs[0]?.payload as { readonly roomId: string }).roomId;

		const transition = applyCommand(state, {
			kind: "room_failed",
			commandId: `room-failed:${taskId}`,
			taskId,
			timestamp: 125,
			roomId: failedRoomId as ReturnType<typeof createRoomId>,
			errorCode: "domain_room_failed",
			message: "Room dropped below quorum",
		});

		expect(transition.events.map((event) => event.kind)).toEqual(["room_failed", "task_failed"]);
		expect(transition.newState.externalState).toBe("failed");
		expect(transition.newState.pendingJobs).toHaveLength(0);
	});

	it("renders the review packet and moves the task to awaiting_review", () => {
		const { taskId, state } = buildAwaitingReviewState();

		expect(state.reviewPacketVersion).toBe(1);
		expect(state.externalState).toBe("awaiting_review");
		expect(state.internalPhase).toBe("awaiting_review");
		expect(state.pendingJobs).toHaveLength(0);
		expect(state.completedRoomIds).toHaveLength(3);
		expect(taskId).toBe(state.taskId);
	});

	it("approves a task that is awaiting review", () => {
		const { taskId, state } = buildAwaitingReviewState();

		const transition = applyCommand(state, {
			kind: "approve_task",
			commandId: `approve:${taskId}`,
			taskId,
			timestamp: 160,
		});

		expect(transition.events.map((event) => event.kind)).toEqual(["task_approved"]);
		expect(transition.newState.externalState).toBe("approved");
	});

	it("rejects a task below the iteration cap and starts a rerun", () => {
		const { taskId, state } = buildAwaitingReviewState(2);

		const transition = applyCommand(state, {
			kind: "reject_task",
			commandId: `reject:${taskId}`,
			taskId,
			timestamp: 160,
			feedback: "Address the unresolved API mismatch",
		});

		expect(transition.events.map((event) => event.kind)).toEqual([
			"task_rejected",
			"task_started",
			"room_job_enqueued",
		]);
		expect(transition.jobs).toHaveLength(1);
		expect(transition.jobs[0]?.kind).toBe("build_context_bundle");
		expect(transition.newState.iteration).toBe(1);
		expect(transition.newState.externalState).toBe("running");
		expect(transition.newState.internalPhase).toBe("building_context");
	});

	it("fails the task when rejection would exceed maxIterations", () => {
		const { taskId, state } = buildAwaitingReviewState(1);
		const atLimitState: WorkflowState = {
			...state,
			iteration: 1,
		};

		const transition = applyCommand(atLimitState, {
			kind: "reject_task",
			commandId: `reject-limit:${taskId}`,
			taskId,
			timestamp: 160,
			feedback: "Still not ready",
		});

		expect(transition.events.map((event) => event.kind)).toEqual(["task_rejected", "task_failed"]);
		expect(transition.newState.externalState).toBe("failed");
		expect(transition.jobs).toHaveLength(0);
	});

	it("cancels tasks from any non-terminal state", () => {
		const taskId = createTaskId();
		const states: WorkflowState[] = [
			buildInitialState(taskId, 2),
			{
				...buildInitialState(taskId, 2),
				externalState: "running",
				internalPhase: "building_context",
			},
			{ ...buildInitialState(taskId, 2), externalState: "running", internalPhase: "mini_rooms" },
			{ ...buildInitialState(taskId, 2), externalState: "running", internalPhase: "synthesis" },
			{ ...buildInitialState(taskId, 2), externalState: "running", internalPhase: "query_back" },
			{ ...buildInitialState(taskId, 2), externalState: "running", internalPhase: "rendering" },
			{
				...buildInitialState(taskId, 2),
				externalState: "awaiting_review",
				internalPhase: "awaiting_review",
			},
			{ ...buildInitialState(taskId, 2), externalState: "running", internalPhase: "rerun" },
		];

		for (const [index, state] of states.entries()) {
			const transition = applyCommand(state, {
				kind: "cancel_task",
				commandId: `cancel:${index}:${taskId}`,
				taskId,
				timestamp: 200 + index,
			});

			expect(transition.newState.externalState).toBe("cancelled");
			expect(transition.newState.pendingJobs).toHaveLength(0);
		}
	});

	it("fails a task directly when task_failed is applied", () => {
		const taskId = createTaskId();
		const state = applyCommand(
			buildInitialState(taskId, 2),
			createSubmitTaskCommand(taskId),
		).newState;

		const transition = applyCommand(state, {
			kind: "task_failed",
			commandId: `task-failed:${taskId}`,
			taskId,
			timestamp: 115,
			errorCode: "context_bundle_failed",
			message: "Context bundle generation crashed",
		});

		expect(transition.events.map((event) => event.kind)).toEqual(["task_failed"]);
		expect(transition.newState.externalState).toBe("failed");
	});

	it("rejects invalid transitions", () => {
		const taskId = createTaskId();

		expect(() =>
			applyCommand(buildInitialState(taskId, 2), {
				kind: "approve_task",
				commandId: `approve:${taskId}`,
				taskId,
				timestamp: 100,
			}),
		).toThrow(/awaiting_review/);

		const runningState = applyCommand(
			buildInitialState(taskId, 2),
			createSubmitTaskCommand(taskId),
		).newState;
		expect(() =>
			applyCommand(runningState, {
				...createSubmitTaskCommand(taskId),
				commandId: `submit-again:${taskId}`,
			}),
		).toThrow(/pending/);

		const { state, jobs } = buildMiniRoomState();
		const domainRoomId = (jobs[0]?.payload as { readonly roomId: string }).roomId;
		expect(() =>
			applyCommand(state, {
				kind: "room_completed",
				commandId: `wrong-room-kind:${taskId}`,
				taskId: state.taskId,
				timestamp: 130,
				roomId: domainRoomId as ReturnType<typeof createRoomId>,
				result: createDomainRoomResult(
					domainRoomId as ReturnType<typeof createRoomId>,
					130,
					"synthesis",
				),
			}),
		).toThrow(/internalPhase synthesis/);

		expect(() =>
			applyCommand(state, {
				kind: "room_completed",
				commandId: `wrong-room-id:${taskId}`,
				taskId: state.taskId,
				timestamp: 131,
				roomId: domainRoomId as ReturnType<typeof createRoomId>,
				result: createDomainRoomResult(createRoomId(), 131),
			}),
		).toThrow(/does not match command roomId/);

		const { state: synthesisState, jobs: synthesisJobs } = buildSynthesisState();
		const activeSynthesisRoomId = (synthesisJobs[0]?.payload as { readonly roomId: string }).roomId;
		const [completedSourceRoomId] = synthesisState.completedRoomIds;
		expect(() =>
			applyCommand(synthesisState, {
				kind: "query_room_requested",
				commandId: `query-wrong-target:${taskId}`,
				taskId: synthesisState.taskId,
				timestamp: 139,
				synthesisRoomId: createRoomId(),
				targetRoomId: createRoomId(),
				question: "What changed?",
				relevantIssueIds: [createIssueId()],
			}),
		).toThrow(/active synthesis room/);

		const queryTransition = applyCommand(synthesisState, {
			kind: "query_room_requested",
			commandId: `query-before-response:${taskId}`,
			taskId: synthesisState.taskId,
			timestamp: 140,
			synthesisRoomId: activeSynthesisRoomId as ReturnType<typeof createRoomId>,
			targetRoomId: completedSourceRoomId as ReturnType<typeof createRoomId>,
			question: "What changed?",
			relevantIssueIds: [createIssueId()],
		});
		expect(() =>
			applyCommand(queryTransition.newState, {
				kind: "query_response_recorded",
				commandId: `response-before-complete:${taskId}`,
				taskId: queryTransition.newState.taskId,
				timestamp: 141,
				artifactId: "artifact-1",
			}),
		).toThrow(/run_query_back_room jobs to be completed/);

		expect(() =>
			applyCommand(
				{
					...queryTransition.newState,
					externalState: "failed",
					pendingJobs: [],
				},
				{
					kind: "query_response_recorded",
					commandId: `response-after-failure:${taskId}`,
					taskId: queryTransition.newState.taskId,
					timestamp: 142,
					artifactId: "artifact-2",
				},
			),
		).toThrow(/terminal state failed/);

		expect(() =>
			applyCommand(state, {
				kind: "room_completed",
				commandId: `non-completed-outcome:${taskId}`,
				taskId: state.taskId,
				timestamp: 132,
				roomId: domainRoomId as ReturnType<typeof createRoomId>,
				result: {
					...createDomainRoomResult(domainRoomId as ReturnType<typeof createRoomId>, 132),
					outcome: "failed",
				},
			}),
		).toThrow(/outcome completed/);
	});

	it("replays command-generated events into the same final state", () => {
		const taskId = createTaskId();
		const initialState = buildInitialState(taskId, 2);
		const submitCommand = createSubmitTaskCommand(taskId);
		const submitTransition = applyCommand(initialState, submitCommand);
		const contextTransition = applyCommand(submitTransition.newState, {
			kind: "context_bundle_built",
			commandId: `bundle:${taskId}`,
			taskId,
			timestamp: 110,
			bundleId: "bundle-1",
		});
		const roomJobs = contextTransition.jobs;
		const roomA = (roomJobs[0]?.payload as { readonly roomId: string }).roomId;
		const roomB = (roomJobs[1]?.payload as { readonly roomId: string }).roomId;
		const firstRoomTransition = applyCommand(contextTransition.newState, {
			kind: "room_completed",
			commandId: `domain-a:${taskId}`,
			taskId,
			timestamp: 120,
			roomId: roomA as ReturnType<typeof createRoomId>,
			result: createDomainRoomResult(roomA as ReturnType<typeof createRoomId>, 120),
		});
		const finalTransition = applyCommand(firstRoomTransition.newState, {
			kind: "room_completed",
			commandId: `domain-b:${taskId}`,
			taskId,
			timestamp: 130,
			roomId: roomB as ReturnType<typeof createRoomId>,
			result: createDomainRoomResult(roomB as ReturnType<typeof createRoomId>, 130),
		});

		const allEvents = [
			...submitTransition.events,
			...contextTransition.events,
			...firstRoomTransition.events,
			...finalTransition.events,
		];

		expect(projectState(allEvents)).toEqual(finalTransition.newState);
	});

	it("replays snapshot plus tail into the same state as the full event log", () => {
		const taskId = createTaskId();
		const initialState = buildInitialState(taskId, 2);
		const { state, events } = applyCommands(initialState, [
			createSubmitTaskCommand(taskId),
			{
				kind: "context_bundle_built",
				commandId: `bundle:${taskId}`,
				taskId,
				timestamp: 110,
				bundleId: "bundle-1",
			},
		]);
		const roomIds = state.pendingJobs.map(
			(job) => (job.payload as { readonly roomId: string }).roomId,
		);
		const replay = applyCommands(state, [
			{
				kind: "room_completed",
				commandId: `domain-a:${taskId}`,
				taskId,
				timestamp: 120,
				roomId: roomIds[0] as ReturnType<typeof createRoomId>,
				result: createDomainRoomResult(roomIds[0] as ReturnType<typeof createRoomId>, 120),
			},
			{
				kind: "room_completed",
				commandId: `domain-b:${taskId}`,
				taskId,
				timestamp: 130,
				roomId: roomIds[1] as ReturnType<typeof createRoomId>,
				result: createDomainRoomResult(roomIds[1] as ReturnType<typeof createRoomId>, 130),
			},
		]);

		const snapshot = projectState(events);
		expect(projectState(replay.events, snapshot)).toEqual(replay.state);
		expect(projectState([...events, ...replay.events])).toEqual(replay.state);
	});

	it("applies task_started iteration during replay", () => {
		const taskId = createTaskId();
		const state = projectState([
			{
				kind: "task_started",
				commandId: `started:${taskId}`,
				taskId,
				timestamp: 100,
				createdAtMs: 100,
				iteration: 2,
				maxIterations: 3,
			},
			{
				kind: "room_job_enqueued",
				commandId: `started:${taskId}`,
				taskId,
				timestamp: 100,
				job: {
					jobId: `task:${taskId}:build_context:2`,
					taskId,
					kind: "build_context_bundle",
					payload: { iteration: 2 },
					dedupeKey: `build_context:${taskId}:2`,
				},
			},
		]);

		expect(state.iteration).toBe(2);
		expect(state.maxIterations).toBe(3);
		expect(state.internalPhase).toBe("building_context");
	});

	it("does not reprocess duplicate commandIds", () => {
		const taskId = createTaskId();
		const initialState = buildInitialState(taskId, 2);
		const command = createSubmitTaskCommand(taskId);
		const first = applyCommand(initialState, command);
		const second = applyCommand(first.newState, command);

		expect(second.events).toEqual([]);
		expect(second.jobs).toEqual([]);
		expect(second.newState).toEqual(first.newState);
	});
});

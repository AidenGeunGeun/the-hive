import type { TaskSnapshotView, WireError, WireEvent } from "@the-hive/protocol/wire";

function formatTimestamp(timestampMs: number): string {
	return new Date(timestampMs).toLocaleTimeString("en-US", {
		hour12: false,
	});
}

export function formatSnapshot(snapshot: TaskSnapshotView): string {
	const lines = [
		`task=${snapshot.taskId}`,
		`state=${snapshot.state}`,
		`phase=${snapshot.currentPhase ?? "unknown"}`,
		`prompt=${snapshot.prompt}`,
		`created=${formatTimestamp(snapshot.createdAtMs)}`,
		`updated=${formatTimestamp(snapshot.updatedAtMs)}`,
	];
	return `[task_snapshot] ${lines.join(" ")}`;
}

export function formatEvent(event: WireEvent): string {
	switch (event.kind) {
		case "task_state_changed":
			return `[task_state_changed] ${event.fromState} -> ${event.toState} (${formatTimestamp(event.changedAtMs)})`;
		case "room_started":
			return `[room_started] room=${event.roomId} kind=${event.roomKind} agents=${event.agentIds.length} (${formatTimestamp(event.startedAtMs)})`;
		case "room_completed":
			return `[room_completed] room=${event.roomId} kind=${event.roomKind} outcome=${event.outcome} (${formatTimestamp(event.completedAtMs)})`;
		case "task_review_ready":
			return [
				`[task_review_ready] version=${event.reviewPacket.version} (${formatTimestamp(event.readyAtMs)})`,
				"--- PROPOSAL ---",
				event.reviewPacket.proposalMarkdown,
				"--- END PROPOSAL ---",
			].join("\n");
		case "task_failed":
			return `[task_failed] code=${event.errorCode} message=${event.message} (${formatTimestamp(event.failedAtMs)})`;
		case "task_cancelled":
			return `[task_cancelled] (${formatTimestamp(event.cancelledAtMs)})`;
		case "task_snapshot":
			return formatSnapshot(event.snapshot);
	}
	return "[unknown_event]";
}

export function formatError(error: WireError): string {
	return `[error] code=${error.code} message=${error.message}`;
}

export type TaskExternalState =
	| "submitted"
	| "running"
	| "awaiting_review"
	| "approved"
	| "rejected"
	| "failed"
	| "cancelled";

export interface TaskDto {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly state: TaskExternalState;
	readonly iteration: number;
	readonly maxIterations: number;
	readonly createdAt: number;
	readonly updatedAt: number;
}

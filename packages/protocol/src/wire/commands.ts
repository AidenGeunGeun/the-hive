export interface SubmitTaskCommand {
	readonly type: "submit_task";
	readonly title: string;
	readonly description: string;
	readonly teamIds: readonly string[];
}

export interface ApproveCommand {
	readonly type: "approve";
	readonly taskId: string;
}

export interface RejectCommand {
	readonly type: "reject";
	readonly taskId: string;
	readonly feedback: string;
}

export interface CancelCommand {
	readonly type: "cancel";
	readonly taskId: string;
}

export type Command = SubmitTaskCommand | ApproveCommand | RejectCommand | CancelCommand;

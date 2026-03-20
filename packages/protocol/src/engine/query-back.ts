import type { IssueId, QueryResponseArtifactId, RoomId } from "./ids";
import type { LedgerEntry } from "./ledger";

export interface RoomRevisionRef {
	readonly roomId: RoomId;
	readonly revision: number;
}

export interface QueryResponseArtifact {
	readonly artifactId: QueryResponseArtifactId;
	readonly sourceRoomId: RoomId;
	readonly sourceRoomRevision: RoomRevisionRef;
	readonly synthesisRoomId: RoomId;
	readonly question: string;
	readonly relevantIssueIds: readonly IssueId[];
	readonly answerMarkdown: string;
	readonly ledgerEntries: readonly LedgerEntry[];
	readonly createdAtMs: number;
}

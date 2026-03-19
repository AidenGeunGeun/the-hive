// @the-hive/protocol/wire
// Stable public API — what crosses process boundaries (server <-> CLI).
// Breaking changes require major version bump.

export type { Command } from "./commands.js";
export type { Event } from "./events.js";
export type { TaskDto, TaskExternalState } from "./task.js";
export type { ReviewPacket } from "./review.js";
export type { ErrorCode, ProtocolError } from "./errors.js";
export { PROTOCOL_VERSION } from "./version.js";

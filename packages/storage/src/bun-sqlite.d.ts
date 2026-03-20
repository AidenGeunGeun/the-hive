declare module "bun:sqlite" {
	export interface Statement {
		run(...params: readonly unknown[]): unknown;
		all(...params: readonly unknown[]): unknown[];
		get(...params: readonly unknown[]): unknown;
	}

	export class Database {
		constructor(filename: string);
		exec(sql: string): void;
		close(): void;
		prepare(sql: string): Statement;
		query(sql: string): Statement;
	}
}

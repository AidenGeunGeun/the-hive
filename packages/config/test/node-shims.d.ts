declare module "node:fs/promises" {
	export function mkdtemp(prefix: string): Promise<string>;
	export function rm(
		path: string,
		options: { readonly recursive?: boolean; readonly force?: boolean },
	): Promise<void>;
	export function writeFile(path: string, data: string, encoding: string): Promise<void>;
}

declare module "node:os" {
	export function tmpdir(): string;
}

declare module "node:path" {
	export function join(...paths: readonly string[]): string;
}

declare module "node:fs/promises" {
	export function readFile(path: string, encoding: string): Promise<string>;
	export function readdir(
		path: string,
		options: { readonly withFileTypes: true },
	): Promise<readonly Dirent[]>;

	export interface Dirent {
		readonly name: string;
		isDirectory(): boolean;
	}
}

declare module "node:path" {
	export function dirname(path: string): string;
	export function join(...paths: readonly string[]): string;
}

declare module "node:url" {
	export function fileURLToPath(url: string | URL): string;
}

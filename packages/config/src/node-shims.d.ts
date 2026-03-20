declare module "node:fs/promises" {
	export function readFile(path: string, encoding: string): Promise<string>;
}

function isEscaped(text: string, index: number): boolean {
	let slashCount = 0;
	let cursor = index - 1;
	while (cursor >= 0 && text[cursor] === "\\") {
		slashCount += 1;
		cursor -= 1;
	}

	return slashCount % 2 === 1;
}

export function stripJsonComments(text: string): string {
	let result = "";
	let index = 0;
	let inString = false;

	while (index < text.length) {
		const current = text[index];
		const next = text[index + 1];

		if (current === '"' && !isEscaped(text, index)) {
			inString = !inString;
			result += current;
			index += 1;
			continue;
		}

		if (!inString && current === "/" && next === "/") {
			index += 2;
			while (index < text.length && text[index] !== "\n") {
				index += 1;
			}
			continue;
		}

		if (!inString && current === "/" && next === "*") {
			index += 2;
			while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
				index += 1;
			}
			index += 2;
			continue;
		}

		result += current;
		index += 1;
	}

	return result;
}

export function stripTrailingCommas(text: string): string {
	let result = "";
	let index = 0;
	let inString = false;

	while (index < text.length) {
		const current = text[index];

		if (current === '"' && !isEscaped(text, index)) {
			inString = !inString;
			result += current;
			index += 1;
			continue;
		}

		if (!inString && current === ",") {
			let lookahead = index + 1;
			while (lookahead < text.length && /\s/.test(text[lookahead] ?? "")) {
				lookahead += 1;
			}

			if (text[lookahead] === "}" || text[lookahead] === "]") {
				index += 1;
				continue;
			}
		}

		result += current;
		index += 1;
	}

	return result;
}

export function normalizeJsonc(text: string): string {
	return stripTrailingCommas(stripJsonComments(text));
}

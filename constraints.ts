import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CONSTRAINTS_FILE = "constraints.json";

export type Constraints = {
	neverTrade: string[];
	doNotSell: string[];
	maxPositionPct: number | null;
	notes: string;
};

export const EMPTY_CONSTRAINTS: Constraints = {
	neverTrade: [],
	doNotSell: [],
	maxPositionPct: null,
	notes: "",
};

function filePath(workspace: string): string {
	return path.join(workspace, CONSTRAINTS_FILE);
}

function normalizeTicker(raw: string): string | null {
	const t = raw.trim().toUpperCase().replace(/[^A-Z0-9.\-]/g, "");
	return t || null;
}

export function normalizeTickers(input: unknown): string[] {
	if (!Array.isArray(input)) return [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of input) {
		if (typeof item !== "string") continue;
		const t = normalizeTicker(item);
		if (!t || seen.has(t)) continue;
		seen.add(t);
		out.push(t);
	}
	return out;
}

export function normalizeConstraints(
	input: Partial<Constraints> | null | undefined,
): Constraints {
	let maxPositionPct: number | null = null;
	if (input?.maxPositionPct !== null && input?.maxPositionPct !== undefined) {
		const n =
			typeof input.maxPositionPct === "number"
				? input.maxPositionPct
				: Number(input.maxPositionPct);
		if (Number.isFinite(n) && n > 0 && n <= 100) {
			maxPositionPct = n;
		}
	}
	return {
		neverTrade: normalizeTickers(input?.neverTrade),
		doNotSell: normalizeTickers(input?.doNotSell),
		maxPositionPct,
		notes: typeof input?.notes === "string" ? input.notes.trim() : "",
	};
}

export function hasConstraints(c: Constraints): boolean {
	return (
		c.neverTrade.length > 0 ||
		c.doNotSell.length > 0 ||
		c.maxPositionPct != null ||
		c.notes.length > 0
	);
}

export function formatConstraintsSection(c: Constraints): string {
	const lines: string[] = [];
	if (c.neverTrade.length > 0) {
		lines.push(`- Never trade (buy or sell): ${c.neverTrade.join(", ")}`);
	}
	if (c.doNotSell.length > 0) {
		lines.push(`- Do not sell: ${c.doNotSell.join(", ")}`);
	}
	if (c.maxPositionPct != null) {
		lines.push(
			`- Maximum single-position weight: ${c.maxPositionPct}% of portfolio equity`,
		);
	}
	if (c.notes) {
		lines.push(`- Additional hard rule: ${c.notes}`);
	}
	return lines.join("\n");
}

export async function loadConstraints(workspace: string): Promise<Constraints> {
	try {
		const raw = await readFile(filePath(workspace), "utf8");
		return normalizeConstraints(JSON.parse(raw) as Partial<Constraints>);
	} catch {
		return { ...EMPTY_CONSTRAINTS };
	}
}

export async function saveConstraints(
	workspace: string,
	input: Partial<Constraints>,
): Promise<Constraints> {
	const next = normalizeConstraints(input);
	await writeFile(
		filePath(workspace),
		`${JSON.stringify(next, null, 2)}\n`,
		"utf8",
	);
	return next;
}

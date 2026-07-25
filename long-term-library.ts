import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const LONG_TERM_FILE = "long-term.md";

export const LONG_TERM_TYPES = ["goal", "watch", "todo"] as const;
export type LongTermType = (typeof LONG_TERM_TYPES)[number];

export const LONG_TERM_SIZES = ["small", "medium", "large"] as const;
export type LongTermSize = (typeof LONG_TERM_SIZES)[number];

export const LONG_TERM_SOURCES = ["user", "agent"] as const;
export type LongTermSource = (typeof LONG_TERM_SOURCES)[number];

export type LongTermItem = {
	id: string;
	title: string;
	type: LongTermType;
	size: LongTermSize;
	pinned: boolean;
	source: LongTermSource;
	added: string;
	checkAfter: string | null;
	rationale: string;
};

export type LongTermState = {
	items: LongTermItem[];
};

export type LongTermUserFields = {
	title?: string;
	type?: LongTermType;
	size?: LongTermSize;
	checkAfter?: string | null;
	rationale?: string;
	pinned?: boolean;
};

function isLongTermType(value: unknown): value is LongTermType {
	return typeof value === "string" && (LONG_TERM_TYPES as readonly string[]).includes(value);
}

function isLongTermSize(value: unknown): value is LongTermSize {
	return typeof value === "string" && (LONG_TERM_SIZES as readonly string[]).includes(value);
}

function isLongTermSource(value: unknown): value is LongTermSource {
	return typeof value === "string" && (LONG_TERM_SOURCES as readonly string[]).includes(value);
}

function parseBool(value: string | undefined): boolean {
	if (!value) return false;
	const v = value.trim().toLowerCase();
	return v === "true" || v === "yes" || v === "1";
}

function todayDate(): string {
	return new Date().toISOString().slice(0, 10);
}

function newItemId(): string {
	return `lt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function filePath(workspace: string): string {
	return path.join(workspace, LONG_TERM_FILE);
}

export function sortLongTermItems(items: LongTermItem[]): LongTermItem[] {
	return [...items].sort((a, b) => {
		if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
		const aCheck = a.checkAfter ?? "9999-99-99";
		const bCheck = b.checkAfter ?? "9999-99-99";
		if (aCheck !== bCheck) return aCheck.localeCompare(bCheck);
		return a.added.localeCompare(b.added);
	});
}

function parseFieldMap(block: string): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const line of block.split(/\r?\n/)) {
		const trimmed = line.trim();
		const match = trimmed.match(/^-?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
		if (!match) continue;
		fields[match[1].toLowerCase()] = match[2].trim();
	}
	return fields;
}

export function parseLongTermMarkdown(content: string): LongTermItem[] {
	const text = content.replace(/\r\n/g, "\n").trim();
	if (!text) return [];

	const parts = text.split(/^##\s+/m);
	const items: LongTermItem[] = [];

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed || trimmed.startsWith("# ")) continue;
		const nl = trimmed.indexOf("\n");
		const idLine = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim();
		const body = nl === -1 ? "" : trimmed.slice(nl + 1);
		if (!/^lt_[a-zA-Z0-9]+$/.test(idLine)) continue;

		const fields = parseFieldMap(body);
		const title = fields.title?.trim() ?? "";
		if (!title) continue;

		const type = isLongTermType(fields.type) ? fields.type : "goal";
		const size = isLongTermSize(fields.size) ? fields.size : "medium";
		const source = isLongTermSource(fields.source) ? fields.source : "agent";
		const added = fields.added?.trim() || todayDate();
		const checkRaw = fields.check_after?.trim() || fields.checkafter?.trim() || "";
		const rationale = fields.rationale?.trim() || "";

		items.push({
			id: idLine,
			title,
			type,
			size,
			pinned: parseBool(fields.pinned),
			source,
			added,
			checkAfter: checkRaw || null,
			rationale,
		});
	}

	return sortLongTermItems(items);
}

export function serializeLongTermMarkdown(items: LongTermItem[]): string {
	const sorted = sortLongTermItems(items);
	if (sorted.length === 0) {
		return "# Long-term\n";
	}

	const blocks = sorted.map((item) => {
		const lines = [
			`## ${item.id}`,
			`- title: ${item.title}`,
			`- type: ${item.type}`,
			`- size: ${item.size}`,
			`- pinned: ${item.pinned ? "true" : "false"}`,
			`- source: ${item.source}`,
			`- added: ${item.added}`,
		];
		if (item.checkAfter) {
			lines.push(`- check_after: ${item.checkAfter}`);
		}
		lines.push(`- rationale: ${item.rationale}`);
		return lines.join("\n");
	});

	return `# Long-term\n\n${blocks.join("\n\n")}\n`;
}

export async function loadLongTerm(workspace: string): Promise<LongTermState> {
	try {
		const raw = await readFile(filePath(workspace), "utf8");
		return { items: parseLongTermMarkdown(raw) };
	} catch {
		return { items: [] };
	}
}

export async function saveLongTerm(
	workspace: string,
	items: LongTermItem[],
): Promise<LongTermState> {
	const sorted = sortLongTermItems(items);
	await writeFile(filePath(workspace), serializeLongTermMarkdown(sorted), "utf8");
	return { items: sorted };
}

export async function addLongTermItem(
	workspace: string,
	input: {
		title: string;
		type?: LongTermType;
		size?: LongTermSize;
		checkAfter?: string | null;
		rationale?: string;
		pinned?: boolean;
	},
): Promise<LongTermState> {
	const title = input.title.trim();
	if (!title) throw new Error("Title is required");

	const state = await loadLongTerm(workspace);
	const item: LongTermItem = {
		id: newItemId(),
		title,
		type: isLongTermType(input.type) ? input.type : "goal",
		size: isLongTermSize(input.size) ? input.size : "medium",
		pinned: Boolean(input.pinned),
		source: "user",
		added: todayDate(),
		checkAfter: input.checkAfter?.trim() || null,
		rationale: input.rationale?.trim() || "",
	};
	return saveLongTerm(workspace, [...state.items, item]);
}

export async function updateLongTermItem(
	workspace: string,
	id: string,
	fields: LongTermUserFields,
): Promise<LongTermState> {
	const state = await loadLongTerm(workspace);
	const existing = state.items.find((i) => i.id === id);
	if (!existing) throw new Error(`Long-term item not found: ${id}`);

	const next: LongTermItem = {
		...existing,
		title:
			fields.title !== undefined ? fields.title.trim() || existing.title : existing.title,
		type: fields.type !== undefined && isLongTermType(fields.type) ? fields.type : existing.type,
		size: fields.size !== undefined && isLongTermSize(fields.size) ? fields.size : existing.size,
		checkAfter:
			fields.checkAfter !== undefined
				? fields.checkAfter?.trim() || null
				: existing.checkAfter,
		rationale:
			fields.rationale !== undefined
				? fields.rationale.trim()
				: existing.rationale,
		pinned: fields.pinned !== undefined ? Boolean(fields.pinned) : existing.pinned,
	};

	return saveLongTerm(
		workspace,
		state.items.map((i) => (i.id === id ? next : i)),
	);
}

export async function dismissLongTermItem(
	workspace: string,
	id: string,
): Promise<LongTermState> {
	const state = await loadLongTerm(workspace);
	if (!state.items.some((i) => i.id === id)) {
		throw new Error(`Long-term item not found: ${id}`);
	}
	return saveLongTerm(
		workspace,
		state.items.filter((i) => i.id !== id),
	);
}

export async function setLongTermPinned(
	workspace: string,
	id: string,
	pinned: boolean,
): Promise<LongTermState> {
	return updateLongTermItem(workspace, id, { pinned });
}

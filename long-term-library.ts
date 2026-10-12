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

function normalizeFieldKey(raw: string): string {
	return raw.replace(/^\*+|\*+$/g, "").replace(/^`+|`+$/g, "").trim().toLowerCase();
}

function parseFieldMap(block: string): Record<string, string> {
	const fields: Record<string, string> = {};
	for (const line of block.split(/\r?\n/)) {
		const trimmed = line.trim();
		const match = trimmed.match(/^(?:[-*]\s+)?(?:\*\*|`)?([a-zA-Z_][a-zA-Z0-9_]*)(?:\*\*|`)?\s*:\s*(.*)$/);
		if (!match) continue;
		const key = normalizeFieldKey(match[1]);
		if (!key) continue;
		fields[key] = match[2].trim().replace(/^\*+|\*+$/g, "").trim();
	}
	return fields;
}

function parseItemHeading(idLine: string): { id: string; titleHint: string } | null {
	const match = idLine.match(/^`?(lt_[a-zA-Z0-9_-]+)`?(?:\s*[:\-—–]\s*|\s+)?(.*)$/);
	if (!match) return null;
	return { id: match[1], titleHint: match[2].trim() };
}

function stableLegacyId(added: string, title: string, index: number): string {
	const basis = `${index}\n${added}\n${title}`;
	let hash = 2166136261;
	for (let i = 0; i < basis.length; i++) {
		hash ^= basis.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	const head = (hash >>> 0).toString(16).padStart(8, "0");
	const tail = (index & 0xffff).toString(16).padStart(4, "0");
	return `lt_${head}${tail}`;
}

function normalizeLooseKey(raw: string): string {
	return raw
		.replace(/^\*+|\*+$/g, "")
		.replace(/^`+|`+$/g, "")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function parseLooseFields(block: string): { key: string; value: string }[] {
	const fields: { key: string; value: string }[] = [];
	for (const line of block.split("\n")) {
		const bullet = line.match(/^\s*[-*]\s+(.+)$/);
		if (bullet) {
			const body = bullet[1].trim();
			const match = body.match(/^(.{1,40}?):\s*(.*)$/);
			if (match) {
				fields.push({
					key: normalizeLooseKey(match[1]),
					value: match[2].trim(),
				});
			} else {
				fields.push({ key: "", value: body });
			}
			continue;
		}
		const continuation = line.trim();
		if (fields.length > 0 && continuation) {
			const last = fields[fields.length - 1];
			last.value = last.value ? `${last.value} ${continuation}` : continuation;
		}
	}
	return fields;
}

function isLegacyItemStartLine(line: string): boolean {
	const top = line.match(/^[-*]\s+(.+)$/);
	if (!top) return false;
	const keyMatch = top[1].match(/^([^:]{1,40}?):\s*/);
	if (!keyMatch) return false;
	const key = normalizeLooseKey(keyMatch[1]);
	return (
		key === "date added" ||
		key === "goal" ||
		key === "watch" ||
		key === "todo" ||
		key === "last reviewed"
	);
}

function takeStructuredFields(body: string): string {
	const lines = body.split("\n");
	const kept: string[] = [];
	for (const line of lines) {
		if (isLegacyItemStartLine(line)) break;
		kept.push(line);
	}
	return kept.join("\n");
}

function legacyBlocks(content: string): string[] {
	const blocks: string[][] = [];
	let current: string[] | null = null;
	let pendingBlank = false;
	let inStructured = false;

	const flush = () => {
		if (current && current.some((line) => line.trim())) blocks.push(current);
		current = null;
		pendingBlank = false;
	};

	for (const line of content.split("\n")) {
		if (/^#{1,6}\s+/.test(line)) {
			flush();
			inStructured = /^#{2,3}\s+`?lt_[a-zA-Z0-9_-]+/.test(line.trim());
			continue;
		}
		if (inStructured && isLegacyItemStartLine(line)) inStructured = false;
		if (inStructured) continue;
		if (!line.trim()) {
			if (current) pendingBlank = true;
			continue;
		}
		if (/^[-*]\s+\S/.test(line)) {
			if (!current || pendingBlank) {
				flush();
				current = [];
			}
			pendingBlank = false;
			current.push(line);
			continue;
		}
		if (current && /^\s+\S/.test(line)) {
			pendingBlank = false;
			current.push(line);
			continue;
		}
		flush();
	}
	flush();
	return blocks.map((lines) => lines.join("\n"));
}

function itemFromLegacyBlock(block: string, index: number): LongTermItem | null {
	const fields = parseLooseFields(block);
	if (fields.length === 0) return null;

	let explicitTitle = "";
	let typedTitle = "";
	let type: LongTermType = "goal";
	let size: LongTermSize = "medium";
	let pinned = false;
	let source: LongTermSource = "agent";
	let added = "";
	let checkAfter: string | null = null;
	let rationale = "";
	let lastReviewed = "";

	for (const field of fields) {
		const key = field.key;
		const value = field.value.trim();
		if (!value && key !== "pinned") continue;
		if (key === "date added" || key === "added" || key === "date") {
			added = value;
		} else if (
			key === "last reviewed" ||
			key === "reviewed" ||
			key === "last updated" ||
			key === "updated"
		) {
			lastReviewed = value;
		} else if (key === "goal" || key === "watch" || key === "todo") {
			type = key;
			typedTitle = value;
		} else if (key === "type") {
			const candidate = value.toLowerCase().match(/[a-z]+/)?.[0] ?? "";
			if (isLongTermType(candidate)) type = candidate;
		} else if (key === "title") {
			explicitTitle = value;
		} else if (key === "size") {
			const word = value.toLowerCase().match(/[a-z]+/)?.[0] ?? "";
			if (isLongTermSize(word)) size = word;
		} else if (key === "rationale" || key === "why" || key === "reason") {
			rationale = value;
		} else if (
			key === "check after" ||
			key === "checkafter" ||
			key === "revisit" ||
			key === "revisit after"
		) {
			checkAfter = value || null;
		} else if (key === "pinned") {
			pinned = parseBool(value);
		} else if (key === "source") {
			const candidate = value.toLowerCase().match(/[a-z]+/)?.[0] ?? "";
			if (isLongTermSource(candidate)) source = candidate;
		} else if (!key && !explicitTitle && !typedTitle) {
			typedTitle = value;
		}
	}

	const title = (explicitTitle || typedTitle).trim();
	if (!title) return null;

	const addedDate = added.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? todayDate();
	if (lastReviewed) {
		rationale = rationale
			? `Last reviewed: ${lastReviewed} ${rationale}`
			: `Last reviewed: ${lastReviewed}`;
	}

	return {
		id: stableLegacyId(addedDate, title, index),
		title,
		type,
		size,
		pinned,
		source,
		added: addedDate,
		checkAfter,
		rationale,
	};
}

export function parseLongTermMarkdown(content: string): LongTermItem[] {
	const text = content.replace(/\r\n/g, "\n").trim();
	if (!text) return [];

	const parts = text.split(/^#{2,3}\s+/m);
	const items: LongTermItem[] = [];
	const seen = new Set<string>();

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed || trimmed.startsWith("# ")) continue;
		const nl = trimmed.indexOf("\n");
		const idLine = (nl === -1 ? trimmed : trimmed.slice(0, nl)).trim();
		const body = takeStructuredFields(nl === -1 ? "" : trimmed.slice(nl + 1));
		const heading = parseItemHeading(idLine);
		if (!heading) continue;
		if (seen.has(heading.id)) continue;

		const fields = parseFieldMap(body);
		const title = fields.title?.trim() || heading.titleHint;
		if (!title) continue;

		const type = isLongTermType(fields.type) ? fields.type : "goal";
		const size = isLongTermSize(fields.size) ? fields.size : "medium";
		const source = isLongTermSource(fields.source) ? fields.source : "agent";
		const added = fields.added?.trim() || todayDate();
		const checkRaw = fields.check_after?.trim() || fields.checkafter?.trim() || "";
		const rationale = fields.rationale?.trim() || "";

		seen.add(heading.id);
		items.push({
			id: heading.id,
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

	for (const [index, block] of legacyBlocks(text).entries()) {
		const item = itemFromLegacyBlock(block, index);
		if (!item || seen.has(item.id)) continue;
		seen.add(item.id);
		items.push(item);
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

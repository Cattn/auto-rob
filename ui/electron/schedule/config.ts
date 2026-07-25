import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
	isSchedulePreset,
	type SchedulePreset,
} from "./presets";

export type ScheduleConfig = {
	enabled: boolean;
	paused: boolean;
	runMissed: boolean;
	preset: SchedulePreset;
	lastRunAt: string | null;
	lastRunSlotId: string | null;
};

const CONFIG_FILE = "auto-rob.config.json";

export const DEFAULT_SCHEDULE_CONFIG: ScheduleConfig = {
	enabled: false,
	paused: false,
	runMissed: false,
	preset: "every_2h",
	lastRunAt: null,
	lastRunSlotId: null,
};

function normalizeSchedule(raw: unknown): ScheduleConfig {
	const base = { ...DEFAULT_SCHEDULE_CONFIG };
	if (!raw || typeof raw !== "object") return base;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.enabled === "boolean") base.enabled = obj.enabled;
	if (typeof obj.paused === "boolean") base.paused = obj.paused;
	if (typeof obj.runMissed === "boolean") base.runMissed = obj.runMissed;
	if (isSchedulePreset(obj.preset)) base.preset = obj.preset;
	if (typeof obj.lastRunAt === "string" || obj.lastRunAt === null) {
		base.lastRunAt = obj.lastRunAt;
	}
	if (typeof obj.lastRunSlotId === "string" || obj.lastRunSlotId === null) {
		base.lastRunSlotId = obj.lastRunSlotId;
	}
	return base;
}

async function readRawConfig(workspace: string): Promise<Record<string, unknown>> {
	try {
		const raw = await readFile(path.join(workspace, CONFIG_FILE), "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object") {
			return { ...(parsed as Record<string, unknown>) };
		}
	} catch {
		// missing
	}
	return {};
}

export async function readScheduleConfig(workspace: string): Promise<ScheduleConfig> {
	const raw = await readRawConfig(workspace);
	return normalizeSchedule(raw.schedule);
}

export async function writeScheduleConfig(
	workspace: string,
	next: ScheduleConfig,
): Promise<ScheduleConfig> {
	const raw = await readRawConfig(workspace);
	raw.schedule = next;
	await writeFile(
		path.join(workspace, CONFIG_FILE),
		`${JSON.stringify(raw, null, 2)}\n`,
		"utf8",
	);
	return next;
}

export async function patchScheduleConfig(
	workspace: string,
	partial: Partial<ScheduleConfig>,
): Promise<ScheduleConfig> {
	const current = await readScheduleConfig(workspace);
	return writeScheduleConfig(workspace, { ...current, ...partial });
}

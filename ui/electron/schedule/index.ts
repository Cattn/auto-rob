import { app } from "electron";
import type { TradeStyle } from "../../shared/ipc";
import {
	DEFAULT_SCHEDULE_CONFIG,
	patchScheduleConfig,
	readScheduleConfig,
	type ScheduleConfig,
} from "./config";
import {
	isSchedulePreset,
	presetForTradeStyle,
	presetLabel,
	type SchedulePreset,
} from "./presets";
import { resolveRunOnceDisplay } from "./path";
import {
	dueSlot,
	formatLocalTime,
	latestMissedSlot,
	localTriggerTimes,
	nextSlot,
} from "./slots";
import {
	installLinuxSchedule,
	linuxScheduleInstalled,
	uninstallLinuxSchedule,
} from "./os/linux";
import {
	installMacSchedule,
	macScheduleInstalled,
	uninstallMacSchedule,
} from "./os/macos";
import {
	installWindowsSchedule,
	uninstallWindowsSchedule,
	windowsScheduleInstalled,
} from "./os/windows";

export type SchedulePlatform = "win32" | "darwin" | "linux" | "unsupported";

export type ScheduleStatus = {
	enabled: boolean;
	paused: boolean;
	runMissed: boolean;
	preset: SchedulePreset;
	suggestedPreset: SchedulePreset;
	harnessReady: boolean;
	canEnable: boolean;
	active: boolean;
	installed: boolean;
	platform: SchedulePlatform;
	nextRunAt: string | null;
	nextRunLabel: string | null;
	slotsLocal: string[];
	runCommand: string;
	isPackaged: boolean;
	cadenceMatch: boolean;
	error: string | null;
};

export type SlotDecision =
	| { action: "skip"; reason: string }
	| { action: "run"; slotId: string | null };

function platform(): SchedulePlatform {
	if (process.platform === "win32") return "win32";
	if (process.platform === "darwin") return "darwin";
	if (process.platform === "linux") return "linux";
	return "unsupported";
}

async function osInstalled(): Promise<boolean> {
	switch (process.platform) {
		case "win32":
			return windowsScheduleInstalled();
		case "darwin":
			return macScheduleInstalled();
		case "linux":
			return linuxScheduleInstalled();
		default:
			return false;
	}
}

async function osUninstall(): Promise<void> {
	switch (process.platform) {
		case "win32":
			await uninstallWindowsSchedule();
			break;
		case "darwin":
			await uninstallMacSchedule();
			break;
		case "linux":
			await uninstallLinuxSchedule();
			break;
		default:
			throw new Error(`Scheduling is not supported on ${process.platform}`);
	}
}

async function osInstall(preset: SchedulePreset, runMissed: boolean): Promise<void> {
	switch (process.platform) {
		case "win32":
			await installWindowsSchedule(preset, runMissed);
			break;
		case "darwin":
			await installMacSchedule(preset);
			break;
		case "linux":
			await installLinuxSchedule(preset, runMissed);
			break;
		default:
			throw new Error(`Scheduling is not supported on ${process.platform}`);
	}
}

export async function syncOsSchedule(
	workspace: string,
	harnessReady: boolean,
): Promise<{ ok: boolean; error: string | null }> {
	const config = await readScheduleConfig(workspace);
	try {
		if (!config.enabled || !harnessReady) {
			await osUninstall();
			return { ok: true, error: null };
		}
		await osInstall(config.preset, config.runMissed);
		return { ok: true, error: null };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export async function getScheduleStatus(
	workspace: string,
	opts: { harnessReady: boolean; tradeStyle: TradeStyle },
): Promise<ScheduleStatus> {
	const config = await readScheduleConfig(workspace);
	const suggestedPreset = presetForTradeStyle(opts.tradeStyle);
	const next = nextSlot(config.preset);
	const slots = localTriggerTimes(config.preset).map(formatLocalTime);
	const uniqueSlots = [...new Set(slots)].sort();
	let installed = false;
	let error: string | null = null;
	try {
		installed = await osInstalled();
	} catch (err) {
		error = err instanceof Error ? err.message : String(err);
	}

	const canEnable = opts.harnessReady && platform() !== "unsupported";
	const active =
		config.enabled && !config.paused && opts.harnessReady && installed;

	return {
		enabled: config.enabled,
		paused: config.paused,
		runMissed: config.runMissed,
		preset: config.preset,
		suggestedPreset,
		harnessReady: opts.harnessReady,
		canEnable,
		active,
		installed,
		platform: platform(),
		nextRunAt: active && next ? next.at.toISOString() : null,
		nextRunLabel:
			active && next
				? next.at.toLocaleString(undefined, {
						weekday: "short",
						hour: "numeric",
						minute: "2-digit",
					})
				: null,
		slotsLocal: uniqueSlots,
		runCommand: resolveRunOnceDisplay(),
		isPackaged: app.isPackaged,
		cadenceMatch: config.preset === suggestedPreset,
		error,
	};
}

export async function setScheduleEnabled(
	workspace: string,
	enabled: boolean,
	harnessReady: boolean,
	tradeStyle: TradeStyle,
): Promise<ScheduleStatus> {
	if (enabled && !harnessReady) {
		throw new Error("Connect Cursor or Codex before enabling the schedule.");
	}
	if (enabled && platform() === "unsupported") {
		throw new Error(`Scheduling is not supported on ${process.platform}`);
	}
	await patchScheduleConfig(
		workspace,
		enabled ? { enabled: true, paused: false } : { enabled: false },
	);
	const sync = await syncOsSchedule(workspace, harnessReady);
	if (!sync.ok) {
		if (enabled) {
			await patchScheduleConfig(workspace, { enabled: false });
			await syncOsSchedule(workspace, harnessReady).catch(() => {});
		}
		throw new Error(sync.error ?? "Failed to update OS schedule");
	}
	return getScheduleStatus(workspace, { harnessReady, tradeStyle });
}

export async function setSchedulePaused(
	workspace: string,
	paused: boolean,
	harnessReady: boolean,
	tradeStyle: TradeStyle,
): Promise<ScheduleStatus> {
	await patchScheduleConfig(workspace, { paused });
	return getScheduleStatus(workspace, { harnessReady, tradeStyle });
}

export async function setSchedulePreset(
	workspace: string,
	preset: SchedulePreset,
	harnessReady: boolean,
	tradeStyle: TradeStyle,
): Promise<ScheduleStatus> {
	await patchScheduleConfig(workspace, { preset });
	const sync = await syncOsSchedule(workspace, harnessReady);
	if (!sync.ok) {
		throw new Error(sync.error ?? "Failed to update OS schedule");
	}
	return getScheduleStatus(workspace, { harnessReady, tradeStyle });
}

export async function setScheduleRunMissed(
	workspace: string,
	runMissed: boolean,
	harnessReady: boolean,
	tradeStyle: TradeStyle,
): Promise<ScheduleStatus> {
	await patchScheduleConfig(workspace, { runMissed });
	const sync = await syncOsSchedule(workspace, harnessReady);
	if (!sync.ok) {
		throw new Error(sync.error ?? "Failed to update OS schedule");
	}
	return getScheduleStatus(workspace, { harnessReady, tradeStyle });
}

export async function recordScheduleRun(
	workspace: string,
	slotId: string,
): Promise<void> {
	await patchScheduleConfig(workspace, {
		lastRunAt: new Date().toISOString(),
		lastRunSlotId: slotId,
	});
}

export async function decideRunSlot(
	workspace: string,
	opts: { catchUp: boolean; harnessReady: boolean },
): Promise<SlotDecision> {
	const config = await readScheduleConfig(workspace);

	if (!config.enabled) {
		if (opts.catchUp) {
			return { action: "skip", reason: "schedule disabled" };
		}
		if (!opts.harnessReady) {
			return { action: "skip", reason: "no harness connected" };
		}
		return { action: "run", slotId: null };
	}

	if (config.paused) {
		return { action: "skip", reason: "schedule paused" };
	}
	if (!opts.harnessReady) {
		return { action: "skip", reason: "no harness connected" };
	}

	const due = dueSlot(config.preset);
	if (due) {
		if (due.id === config.lastRunSlotId) {
			return { action: "skip", reason: "slot already ran" };
		}
		return { action: "run", slotId: due.id };
	}

	if (opts.catchUp || config.runMissed) {
		const missed = latestMissedSlot(config.preset, config.lastRunSlotId);
		if (missed) {
			if (missed.id === config.lastRunSlotId) {
				return { action: "skip", reason: "slot already ran" };
			}
			return { action: "run", slotId: missed.id };
		}
	}

	return { action: "skip", reason: "no due slot" };
}

export { DEFAULT_SCHEDULE_CONFIG, readScheduleConfig, presetLabel, presetForTradeStyle, isSchedulePreset };
export type { ScheduleConfig, SchedulePreset };

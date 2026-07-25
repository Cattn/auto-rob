import {
	intervalMinutes,
	type SchedulePreset,
} from "./presets";

export const MARKET_TZ = "America/New_York";
export const MARKET_START_MINUTES = 9 * 60 + 30;
export const MARKET_END_MINUTES = 16 * 60;
export const SLOT_GRACE_MS = 25 * 60 * 1000;

export type EtParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	weekday: number;
};

export type LocalParts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	weekday: number;
};

export type ScheduleSlot = {
	id: string;
	etMinutes: number;
	at: Date;
	local: LocalParts;
};

const WEEKDAY_MAP: Record<string, number> = {
	Sun: 0,
	Mon: 1,
	Tue: 2,
	Wed: 3,
	Thu: 4,
	Fri: 5,
	Sat: 6,
};

function parseParts(date: Date, timeZone: string): EtParts {
	const fmt = new Intl.DateTimeFormat("en-US", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		weekday: "short",
	});
	const bag: Record<string, string> = {};
	for (const part of fmt.formatToParts(date)) {
		if (part.type !== "literal") bag[part.type] = part.value;
	}
	return {
		year: Number(bag.year),
		month: Number(bag.month),
		day: Number(bag.day),
		hour: Number(bag.hour),
		minute: Number(bag.minute),
		weekday: WEEKDAY_MAP[bag.weekday ?? "Mon"] ?? 1,
	};
}

export function getEtParts(date: Date): EtParts {
	return parseParts(date, MARKET_TZ);
}

export function getLocalParts(date: Date): LocalParts {
	return parseParts(date, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function fromZonedTime(
	year: number,
	month: number,
	day: number,
	hour: number,
	minute: number,
	timeZone: string,
): Date {
	let date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
	for (let i = 0; i < 4; i++) {
		const parts = parseParts(date, timeZone);
		const asUtc = Date.UTC(
			parts.year,
			parts.month - 1,
			parts.day,
			parts.hour,
			parts.minute,
			0,
		);
		const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
		const delta = desired - asUtc;
		if (delta === 0) break;
		date = new Date(date.getTime() + delta);
	}
	return date;
}

export function etMinutesList(preset: SchedulePreset): number[] {
	const step = intervalMinutes(preset);
	const out: number[] = [];
	for (let m = MARKET_START_MINUTES; m <= MARKET_END_MINUTES; m += step) {
		out.push(m);
	}
	return out;
}

export function slotId(year: number, month: number, day: number, etMinutes: number): string {
	const hh = String(Math.floor(etMinutes / 60)).padStart(2, "0");
	const mm = String(etMinutes % 60).padStart(2, "0");
	const mo = String(month).padStart(2, "0");
	const d = String(day).padStart(2, "0");
	return `${year}-${mo}-${d}T${hh}:${mm}@${MARKET_TZ}`;
}

function addEtDays(year: number, month: number, day: number, days: number): {
	year: number;
	month: number;
	day: number;
} {
	const utc = new Date(Date.UTC(year, month - 1, day + days));
	return {
		year: utc.getUTCFullYear(),
		month: utc.getUTCMonth() + 1,
		day: utc.getUTCDate(),
	};
}

function weekdayForEtDate(year: number, month: number, day: number): number {
	const noon = fromZonedTime(year, month, day, 12, 0, MARKET_TZ);
	return getEtParts(noon).weekday;
}

export function buildSlot(
	year: number,
	month: number,
	day: number,
	etMinutes: number,
): ScheduleSlot {
	const hour = Math.floor(etMinutes / 60);
	const minute = etMinutes % 60;
	const at = fromZonedTime(year, month, day, hour, minute, MARKET_TZ);
	return {
		id: slotId(year, month, day, etMinutes),
		etMinutes,
		at,
		local: getLocalParts(at),
	};
}

export function localTriggerTimes(preset: SchedulePreset, now = new Date()): LocalParts[] {
	const et = getEtParts(now);
	const minutes = etMinutesList(preset);
	return minutes.map((m) => {
		const slot = buildSlot(et.year, et.month, et.day, m);
		return slot.local;
	});
}

export function nextSlot(preset: SchedulePreset, now = new Date()): ScheduleSlot | null {
	const et = getEtParts(now);
	const minutes = etMinutesList(preset);
	let y = et.year;
	let mo = et.month;
	let d = et.day;

	for (let i = 0; i < 14; i++) {
		const wd = weekdayForEtDate(y, mo, d);
		if (wd >= 1 && wd <= 5) {
			for (const m of minutes) {
				const slot = buildSlot(y, mo, d, m);
				if (slot.at.getTime() > now.getTime()) return slot;
			}
		}
		const next = addEtDays(y, mo, d, 1);
		y = next.year;
		mo = next.month;
		d = next.day;
	}
	return null;
}

export function dueSlot(
	preset: SchedulePreset,
	now = new Date(),
	graceMs = SLOT_GRACE_MS,
): ScheduleSlot | null {
	const et = getEtParts(now);
	if (et.weekday < 1 || et.weekday > 5) return null;
	const minutes = etMinutesList(preset);
	const earlyMs = 2 * 60 * 1000;
	let best: ScheduleSlot | null = null;
	for (const m of minutes) {
		const slot = buildSlot(et.year, et.month, et.day, m);
		const delta = now.getTime() - slot.at.getTime();
		if (delta >= -earlyMs && delta <= graceMs) {
			if (!best || slot.at.getTime() > best.at.getTime()) best = slot;
		}
	}
	return best;
}

export function missedSlotsSince(
	preset: SchedulePreset,
	afterSlotId: string | null,
	now = new Date(),
): ScheduleSlot[] {
	const et = getEtParts(now);
	const minutes = etMinutesList(preset);
	const out: ScheduleSlot[] = [];
	let y = et.year;
	let mo = et.month;
	let d = et.day;

	for (let i = 0; i < 10; i++) {
		const wd = weekdayForEtDate(y, mo, d);
		if (wd >= 1 && wd <= 5) {
			for (const m of minutes) {
				const slot = buildSlot(y, mo, d, m);
				if (slot.at.getTime() >= now.getTime()) continue;
				if (afterSlotId && slot.id <= afterSlotId) continue;
				out.push(slot);
			}
		}
		const prev = addEtDays(y, mo, d, -1);
		y = prev.year;
		mo = prev.month;
		d = prev.day;
	}

	out.sort((a, b) => a.at.getTime() - b.at.getTime());
	return out;
}

export function latestMissedSlot(
	preset: SchedulePreset,
	afterSlotId: string | null,
	now = new Date(),
): ScheduleSlot | null {
	const missed = missedSlotsSince(preset, afterSlotId, now);
	return missed.length ? missed[missed.length - 1]! : null;
}

export function formatLocalTime(parts: LocalParts): string {
	const hh = String(parts.hour).padStart(2, "0");
	const mm = String(parts.minute).padStart(2, "0");
	return `${hh}:${mm}`;
}

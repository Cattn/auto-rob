import type { TradeStyle } from "../../shared/ipc";

export type SchedulePreset = "every_30m" | "every_1h" | "every_2h";

export function isSchedulePreset(value: unknown): value is SchedulePreset {
	return (
		value === "every_30m" || value === "every_1h" || value === "every_2h"
	);
}

export function presetForTradeStyle(style: TradeStyle): SchedulePreset {
	switch (style) {
		case "more_active":
			return "every_30m";
		case "less_frequent":
			return "every_2h";
		default:
			return "every_1h";
	}
}

export function presetLabel(preset: SchedulePreset): string {
	switch (preset) {
		case "every_30m":
			return "Every 30 minutes";
		case "every_1h":
			return "Every hour";
		case "every_2h":
			return "Every 2 hours";
	}
}

export function intervalMinutes(preset: SchedulePreset): number {
	switch (preset) {
		case "every_30m":
			return 30;
		case "every_1h":
			return 60;
		case "every_2h":
			return 120;
	}
}

import type { SchedulePreset, TradeStyle } from '$lib/backend';

export const SCHEDULE_PRESET_OPTIONS: {
	value: SchedulePreset;
	label: string;
	subtitle: string;
	cadence: TradeStyle;
}[] = [
	{
		value: 'every_30m',
		label: 'Every 30 minutes',
		subtitle: 'More active → every 30 minutes during market hours',
		cadence: 'more_active'
	},
	{
		value: 'every_1h',
		label: 'Every hour',
		subtitle: 'Balanced cadence → every hour during market hours',
		cadence: 'balanced'
	},
	{
		value: 'every_2h',
		label: 'Every 2 hours',
		subtitle: 'Less frequent → every 2 hours during market hours',
		cadence: 'less_frequent'
	}
];

export function presetForTradeStyle(style: TradeStyle): SchedulePreset {
	switch (style) {
		case 'more_active':
			return 'every_30m';
		case 'less_frequent':
			return 'every_2h';
		default:
			return 'every_1h';
	}
}

export function tradeStyleLabel(style: TradeStyle): string {
	switch (style) {
		case 'more_active':
			return 'More active';
		case 'less_frequent':
			return 'Less frequent';
		default:
			return 'Balanced';
	}
}

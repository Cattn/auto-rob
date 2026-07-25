import type { AutoRobApi, RunEvent } from '$lib/backend';

export type RunLogEntry = {
	id: number;
	time: string;
	line: string;
	kind: 'log' | 'status';
};

const MAX_ENTRIES = 200;

export const runLog = $state({
	entries: [] as RunLogEntry[]
});

let nextId = 0;
let subscribed = false;
let unsubscribe: (() => void) | null = null;

function formatTime(date = new Date()) {
	return date.toLocaleTimeString([], {
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false
	});
}

export function clearRunLog() {
	runLog.entries = [];
}

function append(line: string, kind: RunLogEntry['kind']) {
	const entry: RunLogEntry = { id: ++nextId, time: formatTime(), line, kind };
	const next = [...runLog.entries, entry];
	runLog.entries = next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
}

function isRunStart(event: RunEvent): boolean {
	if (event.type === 'log') {
		return event.line.startsWith('Starting run in ');
	}
	return (
		event.type === 'status' &&
		event.status.state === 'running' &&
		event.status.message === 'Starting portfolio run…'
	);
}

function handleEvent(event: RunEvent) {
	if (isRunStart(event)) {
		clearRunLog();
	}
	if (event.type === 'log') {
		append(event.line, 'log');
	} else if (event.type === 'status') {
		append(`${event.status.state}: ${event.status.message}`, 'status');
	}
}

export function ensureRunLogSubscription(api: AutoRobApi | null): () => void {
	if (!api) return () => {};
	if (subscribed) return () => {};
	subscribed = true;
	unsubscribe = api.onRunEvent(handleEvent);
	return () => {
		unsubscribe?.();
		unsubscribe = null;
		subscribed = false;
	};
}

import type { AuditLogEntry, AutoRobApi, RunEvent } from '$lib/backend';

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
let historyLoaded = false;

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

function append(line: string, kind: RunLogEntry['kind'], at?: number) {
	const entry: RunLogEntry = {
		id: ++nextId,
		time: formatTime(at != null ? new Date(at) : new Date()),
		line,
		kind
	};
	const next = [...runLog.entries, entry];
	runLog.entries = next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
}

function isRunStart(event: RunEvent): boolean {
	return event.type === 'log' && event.line.startsWith('Starting run in ');
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

function loadHistory(entries: AuditLogEntry[]) {
	if (historyLoaded) return;
	historyLoaded = true;
	if (entries.length === 0) return;
	clearRunLog();
	for (const entry of entries) {
		append(entry.line, entry.kind, entry.at);
	}
}

export function ensureRunLogSubscription(api: AutoRobApi | null): () => void {
	if (!api) return () => {};
	if (subscribed) return () => {};
	subscribed = true;
	let cancelled = false;

	const attach = () => {
		if (cancelled || unsubscribe) return;
		unsubscribe = api.onRunEvent(handleEvent);
	};

	void api
		.getAuditLog()
		.then((entries) => {
			if (cancelled) return;
			loadHistory(entries);
			attach();
		})
		.catch(() => {
			if (cancelled) return;
			historyLoaded = true;
			attach();
		});

	return () => {
		cancelled = true;
		unsubscribe?.();
		unsubscribe = null;
		subscribed = false;
	};
}

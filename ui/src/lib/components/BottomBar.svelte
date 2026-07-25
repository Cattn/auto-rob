<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { RunStatus, ScheduleStatus } from '$lib/backend';

	let status = $state('idle');
	let paused = $state(false);
	let scheduleEnabled = $state(false);
	let scheduleActive = $state(false);
	let lastOutcome = $state('Connecting…');
	let nextRun = $state('—');
	let connected = $state(false);
	let busy = $state(false);
	let scheduleBusy = $state(false);
	let fake = $state(true);

	const statusLabel = $derived(
		{
			idle: 'Idle',
			running: fake ? 'Fake run' : 'Running',
			failed: 'Failed',
			market_closed: 'Market closed',
			offline: 'Offline'
		}[status] ?? status
	);

	const statusDot = $derived(
		{
			idle: 'bg-outline',
			running: 'bg-tertiary animate-pulse',
			failed: 'bg-error',
			market_closed: 'bg-secondary',
			offline: 'bg-error'
		}[status] ?? 'bg-outline'
	);

	const scheduleLabel = $derived(
		!scheduleEnabled
			? 'Off'
			: paused
				? 'Paused'
				: !scheduleActive
					? 'Inactive'
					: `Next · ${nextRun}`
	);

	function applyStatus(run: RunStatus) {
		status = run.state;
		lastOutcome = run.message;
		fake = run.fake;
	}

	function applySchedule(s: ScheduleStatus) {
		scheduleEnabled = s.enabled;
		scheduleActive = s.active;
		paused = s.paused;
		nextRun = s.nextRunLabel ?? '—';
	}

	async function refreshSchedule() {
		const api = getBackend();
		if (!api) return;
		applySchedule(await api.getSchedule());
	}

	async function runNow() {
		const api = getBackend();
		if (!api || busy) return;
		busy = true;
		try {
			if (scheduleEnabled && paused) {
				applySchedule(await api.setSchedulePaused(false));
			}
			applyStatus(await api.startRun());
		} catch (err) {
			status = 'failed';
			lastOutcome = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function pauseSchedule() {
		const api = getBackend();
		if (!api || scheduleBusy || !scheduleEnabled) return;
		scheduleBusy = true;
		try {
			applySchedule(await api.setSchedulePaused(!paused));
		} catch (err) {
			lastOutcome = err instanceof Error ? err.message : String(err);
		} finally {
			scheduleBusy = false;
		}
	}

	async function stop() {
		const api = getBackend();
		if (!api || busy) return;
		busy = true;
		try {
			applyStatus(await api.stopRun());
		} catch (err) {
			status = 'failed';
			lastOutcome = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	onMount(() => {
		const api = getBackend();
		if (!api) {
			connected = false;
			status = 'offline';
			lastOutcome = 'Open via Electron (pnpm start in ui/) — IPC not available in browser';
			return;
		}

		connected = true;
		let unsubscribe = () => {};

		void (async () => {
			try {
				const [health, run, schedule] = await Promise.all([
					api.getHealth(),
					api.getRunStatus(),
					api.getSchedule()
				]);
				applyStatus(run);
				applySchedule(schedule);
				fake = health.fakeRuns;
				if (run.state === 'idle' && run.message === 'Ready') {
					const harnessLabel =
						health.harnesses.find((h) => h.id === health.activeHarness)?.label ??
						health.activeHarness;
					if (!health.ok) {
						lastOutcome = health.error ?? 'Agent not found';
						status = 'failed';
					} else if (health.fakeRuns) {
						lastOutcome = `Fake runs on · ${harnessLabel}`;
					} else {
						lastOutcome = `REAL runs · ${harnessLabel}`;
					}
				}
				const log = await api.readRepoFile('run-log.md');
				if (log && run.state === 'idle') {
					const first = log.trim().split(/\r?\n/).find((l) => l.trim());
					if (first) lastOutcome = first.replace(/^#+\s*/, '').slice(0, 120);
				}
			} catch (err) {
				status = 'failed';
				lastOutcome = err instanceof Error ? err.message : String(err);
			}
		})();

		const onFocus = () => {
			void refreshSchedule().catch(() => {});
		};
		window.addEventListener('focus', onFocus);

		unsubscribe = api.onRunEvent((event) => {
			if (event.type === 'log') {
				console.log('[auto-rob run]', event.line);
			}
			if (event.type === 'status') {
				console.log('[auto-rob status]', event.status.state, event.status.message);
				applyStatus(event.status);
				if (event.status.state === 'idle' || event.status.state === 'failed') {
					void refreshSchedule().catch(() => {});
				}
			} else if (event.type === 'log' && (status === 'running' || status === 'failed')) {
				lastOutcome = event.line.slice(0, 240);
			}
		});

		return () => {
			unsubscribe();
			window.removeEventListener('focus', onFocus);
		};
	});
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
	<div
		class="bg-surface-container border-outline-variant pointer-events-auto flex w-full max-w-3xl items-center gap-4 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-md"
		role="region"
		aria-label="Agent transport"
	>
		<div class="flex min-w-0 flex-1 items-center gap-3">
			<span class={['size-2.5 shrink-0 rounded-full', statusDot]} aria-hidden="true"></span>
			<div class="min-w-0">
				<div class="flex items-baseline gap-2">
					<span class="text-primary text-sm font-semibold">{statusLabel}</span>
					<span class="text-on-surface-variant truncate text-xs">{scheduleLabel}</span>
				</div>
				<p
					class={[
						'text-on-surface-variant text-sm',
						status === 'failed' ? 'line-clamp-3 whitespace-pre-wrap break-words' : 'truncate'
					]}
				>
					{lastOutcome}
				</p>
			</div>
		</div>

		<div class="flex shrink-0 items-center gap-2">
			<Button
				variant="filled"
				disabled={!connected || busy || status === 'running' || status === 'market_closed'}
				click={runNow}
			>
				Run now
			</Button>
			<Button
				variant="tonal"
				disabled={!connected || !scheduleEnabled || scheduleBusy}
				click={pauseSchedule}
			>
				{paused ? 'Resume schedule' : 'Pause schedule'}
			</Button>
			{#if status === 'running'}
				<Button variant="text" disabled={busy} click={stop}>Stop</Button>
			{/if}
		</div>
	</div>
</div>

<script lang="ts">
	import { Button } from 'm3-svelte';

	let status = $state('idle');
	let paused = $state(false);
	let lastOutcome = $state('Bought PG · no sell');
	let nextRun = $state('9:35 AM ET');

	const statusLabel = $derived(
		{
			idle: 'Idle',
			running: 'Running',
			failed: 'Failed',
			market_closed: 'Market closed'
		}[status]
	);

	const statusDot = $derived(
		{
			idle: 'bg-outline',
			running: 'bg-tertiary animate-pulse',
			failed: 'bg-error',
			market_closed: 'bg-secondary'
		}[status]
	);

	const scheduleLabel = $derived(paused ? 'Paused' : `Next · ${nextRun}`);

	function runNow() {
		status = 'running';
		paused = false;
		lastOutcome = 'Run started…';
	}

	function pauseSchedule() {
		paused = !paused;
	}

	function stop() {
		status = 'idle';
		lastOutcome = 'Stopped mid-run · no trades';
	}
</script>

<main class="bg-background text-on-background min-h-dvh px-6 pt-12 pb-28">
	<p class="text-on-surface-variant text-sm font-medium tracking-wide">auto-rob</p>
	<h1 class="text-on-surface mt-1 text-2xl font-semibold tracking-tight">Portfolio agent</h1>
	<p class="text-on-surface-variant mt-2 max-w-md text-sm leading-relaxed">
		Unattended Robinhood runs. Use the transport bar below to control the agent.
	</p>
</main>

<div class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4">
	<div
		class="bg-surface-container-lowest/95 border-outline-variant pointer-events-auto flex w-full max-w-3xl items-center gap-4 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur-md"
		role="region"
		aria-label="Agent transport"
	>
		<div class="flex min-w-0 flex-1 items-center gap-3">
			<span class={['size-2.5 shrink-0 rounded-full', statusDot]} aria-hidden="true"></span>
			<div class="min-w-0">
				<div class="flex items-baseline gap-2">
					<span class="text-on-surface text-sm font-semibold">{statusLabel}</span>
					<span class="text-on-surface-variant truncate text-xs">{scheduleLabel}</span>
				</div>
				<p class="text-on-surface-variant truncate text-sm">{lastOutcome}</p>
			</div>
		</div>

		<div class="flex shrink-0 items-center gap-2">
			<Button
				variant="filled"
				disabled={status === 'running' || status === 'market_closed'}
				click={runNow}
			>
				Run now
			</Button>
			<Button variant="tonal" click={pauseSchedule}>
				{paused ? 'Resume schedule' : 'Pause schedule'}
			</Button>
			{#if status === 'running'}
				<Button variant="text" click={stop}>Stop</Button>
			{/if}
		</div>
	</div>
</div>

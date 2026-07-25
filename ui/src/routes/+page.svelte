<script lang="ts">
	import { onMount } from 'svelte';
	import { getBackend } from '$lib/backend';
	import AgentLog from '$lib/components/AgentLog.svelte';

	let loadError = $state<string | null>(null);

	onMount(() => {
		const api = getBackend();
		if (!api) {
			loadError = 'Not running inside Electron — start with pnpm start from ui/';
		}
	});
</script>

<title>auto-rob</title>

<main class="bg-background text-on-background min-h-dvh px-6 pt-12 pb-28">
	<p class="text-on-surface-variant text-sm font-medium tracking-wide">auto-rob</p>
	<h1 class="text-on-surface mt-1 text-2xl font-semibold tracking-tight">Portfolio agent</h1>
	<p class="text-on-surface-variant mt-2 max-w-md text-sm leading-relaxed">
		Unattended Robinhood runs. Use the transport bar below to control the agent.
	</p>

	{#if loadError}
		<p class="text-error mt-6 max-w-lg text-sm">{loadError}</p>
	{/if}

	<div
		class="mt-8 grid grid-cols-1 gap-4 md:h-[28rem] md:grid-cols-3 md:grid-rows-[minmax(0,1fr)_minmax(0,1fr)] md:gap-4"
	>
		<div
			class="bg-surface-container-high ring-outline/50 flex min-h-[8rem] flex-col justify-between rounded-xl p-4 ring-1 md:col-start-1 md:row-start-1"
		>
			<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
				Overview
			</p>
			<p class="text-on-surface-variant/70 mt-3 text-sm">Coming soon</p>
		</div>

		<div
			class="bg-surface-container-high ring-outline/50 flex min-h-[8rem] flex-col justify-between rounded-xl p-4 ring-1 md:col-start-2 md:row-start-1"
		>
			<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
				Positions
			</p>
			<p class="text-on-surface-variant/70 mt-3 text-sm">Coming soon</p>
		</div>

		<div class="h-full min-h-0 overflow-hidden md:col-start-3 md:row-span-2 md:row-start-1">
			<AgentLog />
		</div>

		<div
			class="bg-surface-container-high ring-outline/50 flex min-h-[8rem] flex-col justify-between rounded-xl p-4 ring-1 md:col-start-1 md:row-start-2"
		>
			<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
				Schedule
			</p>
			<p class="text-on-surface-variant/70 mt-3 text-sm">Coming soon</p>
		</div>

		<div
			class="bg-surface-container-high ring-outline/50 flex min-h-[8rem] flex-col justify-between rounded-xl p-4 ring-1 md:col-start-2 md:row-start-2"
		>
			<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
				Activity
			</p>
			<p class="text-on-surface-variant/70 mt-3 text-sm">Coming soon</p>
		</div>
	</div>
</main>

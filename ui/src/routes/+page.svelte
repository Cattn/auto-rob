<script lang="ts">
	import { onMount } from 'svelte';
	import { getBackend } from '$lib/backend';

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
		Unattended Robinhood runs. Use the transport bar below to control the agent. Connection and
		harness details live in Settings.
	</p>

	{#if loadError}
		<p class="text-error mt-6 max-w-lg text-sm">{loadError}</p>
	{/if}
</main>

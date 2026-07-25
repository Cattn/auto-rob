<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { getBackend } from '$lib/backend';
	import { runLog } from '$lib/run-log.svelte';

	let offline = $state(false);
	let viewport: HTMLDivElement | undefined = undefined;

	onMount(() => {
		if (!getBackend()) {
			offline = true;
		}
	});

	$effect.pre(() => {
		runLog.entries.length;
		if (!viewport) return;
		void tick().then(() => {
			viewport?.scrollTo(0, viewport.scrollHeight);
		});
	});
</script>

<section
	class="bg-surface-container-high ring-outline/50 flex h-full max-h-[24rem] min-h-0 flex-col overflow-hidden rounded-xl ring-1 md:max-h-none"
	aria-label="Agent audit log"
>
	<header class="border-outline/30 shrink-0 border-b px-4 py-3">
		<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
			Audit log
		</p>
		<h2 class="text-on-surface mt-0.5 text-sm font-semibold">Agent activity</h2>
	</header>

	<div
		bind:this={viewport}
		class="text-on-surface-variant min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-sm leading-relaxed"
	>
		{#if offline}
			<p class="text-on-surface-variant/80">
				Not running inside Electron — agent log unavailable.
			</p>
		{:else if runLog.entries.length === 0}
			<p class="text-on-surface-variant/80">Waiting for agent activity…</p>
		{:else}
			<ul class="space-y-1.5">
				{#each runLog.entries as entry (entry.id)}
					<li class="flex gap-2">
						<span class="text-on-surface-variant/60 shrink-0 tabular-nums">{entry.time}</span>
						<span
							class={[
								'min-w-0 break-words whitespace-pre-wrap',
								entry.kind === 'status' ? 'text-on-surface' : 'text-on-surface-variant'
							]}
						>
							{entry.line}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</section>

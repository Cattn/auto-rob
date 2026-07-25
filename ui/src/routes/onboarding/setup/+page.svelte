<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { HarnessConnection } from '$lib/backend';
	import HarnessConnectPanel, { anyRunReady } from '$lib/components/HarnessConnectPanel.svelte';

	let harnesses = $state<HarnessConnection[]>([]);
	let loadError = $state<string | null>(null);

	const canContinue = $derived(anyRunReady(harnesses));

	async function refresh() {
		const api = getBackend();
		if (!api) return;
		const info = await api.getHealth();
		harnesses = info.harnesses;
	}

	onMount(() => {
		const api = getBackend();
		if (!api) {
			loadError = 'Not running inside Electron — start with pnpm start from ui/';
			return;
		}
		void refresh().catch((err) => {
			loadError = err instanceof Error ? err.message : String(err);
		});
	});
</script>

<title>Setup · auto-rob</title>

<main class="bg-background text-on-background flex min-h-dvh w-full justify-center px-6 pt-12 pb-28">
	<div class="w-full max-w-2xl">
		<header>
			<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
				Setup
			</p>
			<h1 class="text-on-surface mt-1 text-3xl font-bold tracking-tight">
				Connect a harness
			</h1>
			<p class="text-on-surface-variant mt-2 max-w-xl text-sm leading-relaxed">
				Connect Cursor CLI and/or ChatGPT Codex with Robinhood so the agent can trade on
				your behalf. At least one harness must be fully connected to continue.
			</p>
		</header>

		{#if loadError}
			<p class="text-error mt-6 text-sm">{loadError}</p>
		{:else}
			<div class="mt-8 flex flex-col gap-8">
				<section aria-label="Harnesses">
					<div class="mb-3">
						<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
							Harnesses
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							Install CLIs and connect Robinhood MCP where needed.
						</p>
					</div>

					<HarnessConnectPanel bind:harnesses onrefresh={refresh} />

					{#if canContinue}
						<p class="text-primary mt-3 text-sm">
							Connecting both is optional — one connected harness is enough to get started.
						</p>
					{/if}
				</section>

				<section aria-label="Continue">
					<Button
						variant="filled"
						disabled={!canContinue}
						click={() => goto(resolve('/onboarding'))}
					>
						Continue
					</Button>
					{#if !canContinue}
						<p class="text-on-surface-variant mt-2 text-sm">
							Connect at least one harness above to continue.
						</p>
					{/if}
				</section>
			</div>
		{/if}
	</div>
</main>

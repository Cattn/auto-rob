<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { HealthInfo, HarnessConnection } from '$lib/backend';

	let health = $state<HealthInfo | null>(null);
	let loadError = $state<string | null>(null);
	let connecting = $state(false);
	let connectMessage = $state<string | null>(null);

	const activeHarness = $derived.by((): HarnessConnection | null => {
		const info = health;
		if (!info) return null;
		return info.harnesses.find((h) => h.id === info.activeHarness) ?? null;
	});

	const agentPath = $derived(activeHarness?.binaryPath ?? health?.agentPath ?? null);

	const robinhoodConnected = $derived(
		!!activeHarness && activeHarness.mcpConfigured && activeHarness.mcpAuthenticated
	);

	const needsRobinhood = $derived(
		!!activeHarness && (!activeHarness.mcpConfigured || !activeHarness.mcpAuthenticated)
	);

	async function refreshHealth() {
		const api = getBackend();
		if (!api) return;
		health = await api.getHealth();
	}

	async function connectRobinhood() {
		const api = getBackend();
		if (!api || !health || connecting) return;
		connecting = true;
		connectMessage = null;
		try {
			await api.connectHarness(health.activeHarness);
			connectMessage =
				'Browser opened — finish Robinhood login in the browser, then return here.';
			await refreshHealth();
		} catch (err) {
			connectMessage = err instanceof Error ? err.message : String(err);
		} finally {
			connecting = false;
		}
	}

	onMount(() => {
		const api = getBackend();
		if (!api) {
			loadError = 'Not running inside Electron — start with pnpm start from ui/';
			return;
		}
		void refreshHealth().catch((err) => {
			loadError = err instanceof Error ? err.message : String(err);
		});
	});
</script>

<title>auto-rob</title>

<main class="bg-background text-on-background min-h-dvh px-6 pt-12 pb-28">
	<p class="text-on-surface-variant text-sm font-medium tracking-wide">auto-rob</p>
	<h1 class="text-on-surface mt-1 text-2xl font-semibold tracking-tight">Portfolio agent</h1>
	<p class="text-on-surface-variant mt-2 max-w-md text-sm leading-relaxed">
		Unattended Robinhood runs. Use the transport bar below to control the agent.
	</p>

	<section class="mt-10 max-w-lg" aria-label="Backend connection">
		<h2 class="text-on-surface text-sm font-semibold tracking-tight">Connection</h2>
		{#if loadError}
			<p class="text-error mt-2 text-sm">{loadError}</p>
		{:else if !health}
			<p class="text-on-surface-variant mt-2 text-sm">Checking agent…</p>
		{:else}
			<ul class="text-on-surface-variant mt-3 space-y-1.5 text-sm">
				<li>
					<span class="text-on-surface font-medium">Status</span>
					· {health.ok ? 'Agent reachable' : 'Agent missing'}
				</li>
				{#if activeHarness}
					<li>
						<span class="text-on-surface font-medium">Harness</span>
						· {activeHarness.label}
					</li>
					<li>
						<span class="text-on-surface font-medium">Robinhood</span>
						· {robinhoodConnected ? 'connected' : 'not connected'}
					</li>
				{/if}
				{#if agentPath}
					<li class="truncate" title={agentPath}>
						<span class="text-on-surface font-medium">Path</span>
						· {agentPath}
					</li>
				{/if}
				<li class="truncate" title={health.repoRoot}>
					<span class="text-on-surface font-medium">Repo</span>
					· {health.repoRoot || '—'}
				</li>
				<li>
					<span class="text-on-surface font-medium">Runs</span>
					· {health.fakeRuns ? 'fake / dry-run (safe)' : 'REAL agent'}
				</li>
				<li>
					<span class="text-on-surface font-medium">ntfy</span>
					· {health.ntfyConfigured ? 'configured' : 'not configured'}
				</li>
				{#if health.error}
					<li class="text-error">{health.error}</li>
				{/if}
			</ul>

			{#if needsRobinhood}
				<div class="mt-5">
					<Button variant="filled" disabled={connecting} click={connectRobinhood}>
						{connecting ? 'Connecting…' : 'Connect Robinhood'}
					</Button>
					{#if connectMessage}
						<p class="text-on-surface-variant mt-3 text-sm leading-relaxed">{connectMessage}</p>
					{/if}
				</div>
			{/if}
		{/if}
	</section>
</main>

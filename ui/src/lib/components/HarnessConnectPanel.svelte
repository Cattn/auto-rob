<script module lang="ts">
	import type { HarnessConnection } from '$lib/backend';
	import { isHarnessReady } from '$lib/backend';

	export function isRunReady(h: HarnessConnection): boolean {
		return isHarnessReady(h);
	}

	export function anyRunReady(list: HarnessConnection[]): boolean {
		return list.some(isRunReady);
	}
</script>

<script lang="ts">
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { HarnessId } from '$lib/backend';

	let {
		harnesses = $bindable([]),
		onrefresh
	}: {
		harnesses: HarnessConnection[];
		onrefresh?: () => void;
	} = $props();

	let connectingId = $state<HarnessId | null>(null);
	let connectError = $state<string | null>(null);
	let pendingBrowserId = $state<HarnessId | null>(null);

	const browserOpenedMessage =
		'Browser opened — finish Robinhood login in the browser, then return here.';

	const connectMessage = $derived.by(() => {
		if (connectError) return connectError;
		if (connectingId === 'codex') return 'Finish ChatGPT sign-in and Robinhood authorization in your browser, then return here.';
		if (!pendingBrowserId) return null;
		const match = harnesses.find((h) => h.id === pendingBrowserId);
		if (match && isRunReady(match)) return null;
		return browserOpenedMessage;
	});

	function statusText(h: HarnessConnection): string {
		if (!h.binaryOk) return 'CLI missing';
		if (h.id === 'codex' && !h.agentAuthenticated) return 'needs ChatGPT sign-in';
		if (!h.mcpConfigured || !h.mcpAuthenticated) return 'needs Robinhood connect';
		return 'connected';
	}

	function needsConnect(h: HarnessConnection): boolean {
		return h.binaryOk && !isRunReady(h);
	}

	function installHelp(h: HarnessConnection): string {
		if (h.id === 'cursor') {
			return 'Install the Cursor CLI from cursor.com/docs/cli/installation, then return here.';
		}
		return 'Install the ChatGPT / Codex app, then return here.';
	}

	function showHarnessError(h: HarnessConnection): boolean {
		if (!h.error) return false;
		if (!h.binaryOk) return false;
		if (needsConnect(h) && h.error.startsWith('Robinhood MCP needs CLI login')) return false;
		return true;
	}

	async function connect(id: HarnessId) {
		const api = getBackend();
		if (!api || connectingId) return;
		connectingId = id;
		connectError = null;
		pendingBrowserId = null;
		try {
			const status = await api.connectHarness(id);
			harnesses = harnesses.map((h) => h.id === id ? status : h);
			pendingBrowserId =
				isRunReady(status) ? null : id;
			onrefresh?.();
		} catch (err) {
			connectError = err instanceof Error ? err.message : String(err);
		} finally {
			connectingId = null;
		}
	}
</script>

{#if harnesses.length === 0}
	<div class="bg-surface-container-high ring-outline/50 rounded-xl p-4 ring-1">
		<p class="text-on-surface-variant text-sm">Loading harnesses…</p>
	</div>
{:else}
	<div
		class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
	>
		{#each harnesses as h (h.id)}
			<div class="flex flex-col gap-2 px-4 py-3.5">
				<div class="flex items-center justify-between gap-3">
					<div class="min-w-0">
						<p class="text-on-surface text-sm font-medium">{h.label}</p>
						<p class="text-on-surface-variant mt-0.5 text-sm leading-relaxed">
							{#if !h.binaryOk}
								{installHelp(h)}
							{:else if h.id === 'codex' && !h.agentAuthenticated}
								Sign in to ChatGPT, then connect Robinhood
							{:else if needsConnect(h)}
								Binary ready — finish Robinhood connect
							{:else}
								Ready for agent runs
							{/if}
						</p>
					</div>
					<div class="flex shrink-0 items-center gap-2">
						<span
							class={[
								'rounded-md px-2.5 py-1 text-xs font-medium',
								isRunReady(h)
									? 'bg-primary/15 text-primary'
									: 'bg-error-container text-on-error-container'
							]}
						>
							{statusText(h)}
						</span>
						{#if h.binaryOk}
							<Button
								variant="filled"
								disabled={connectingId !== null}
								click={() => connect(h.id)}
							>
								{connectingId === h.id
									? 'Connecting…'
									: needsConnect(h)
										? 'Connect'
										: 'Reconnect'}
							</Button>
						{/if}
					</div>
				</div>
				{#if showHarnessError(h)}
					<p class="text-error text-sm">{h.error}</p>
				{/if}
			</div>
		{/each}
	</div>
	{#if connectMessage}
		<p
			class="bg-surface-container-high text-on-surface-variant ring-outline/50 mt-3 rounded-xl px-4 py-3 text-sm leading-relaxed ring-1"
		>
			{connectMessage}
		</p>
	{/if}
{/if}

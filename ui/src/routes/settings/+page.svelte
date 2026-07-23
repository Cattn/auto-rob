<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { HarnessConnection, HarnessId, HarnessModels } from '$lib/backend';

	let harnesses = $state<HarnessConnection[]>([]);
	let activeId = $state<HarnessId | null>(null);
	let models = $state<HarnessModels>({ cursor: '', codex: '' });
	let draftModels = $state<HarnessModels>({ cursor: '', codex: '' });
	let loadError = $state<string | null>(null);
	let connectingId = $state<HarnessId | null>(null);
	let connectMessage = $state<string | null>(null);
	let settingActive = $state(false);
	let savingModelId = $state<HarnessId | null>(null);

	const available = $derived(harnesses.filter((h) => h.binaryOk));

	function statusText(h: HarnessConnection): string {
		if (!h.binaryOk) return 'CLI missing';
		if (!h.mcpConfigured || !h.mcpAuthenticated) return 'needs Robinhood connect';
		return 'connected';
	}

	function needsConnect(h: HarnessConnection): boolean {
		return h.binaryOk && (!h.mcpConfigured || !h.mcpAuthenticated);
	}

	function installHelp(h: HarnessConnection): string {
		if (h.id === 'cursor') {
			return 'Install the Cursor CLI from cursor.com/docs/cli/installation, then return here.';
		}
		return 'Install the ChatGPT / Codex app, then return here.';
	}

	function modelHint(id: HarnessId): string {
		if (id === 'cursor') return 'e.g. grok-4.5[effort=high,fast=true]';
		return 'Leave blank for Codex default';
	}

	async function refresh() {
		const api = getBackend();
		if (!api) return;
		const [list, active, nextModels] = await Promise.all([
			api.getHarnesses(),
			api.getActiveHarness(),
			api.getHarnessModels()
		]);
		harnesses = list;
		activeId = active;
		models = nextModels;
		draftModels = { ...nextModels };
	}

	async function connect(id: HarnessId) {
		const api = getBackend();
		if (!api || connectingId) return;
		connectingId = id;
		connectMessage = null;
		try {
			await api.connectHarness(id);
			connectMessage =
				'Browser opened — finish Robinhood login in the browser, then return here.';
			await refresh();
		} catch (err) {
			connectMessage = err instanceof Error ? err.message : String(err);
		} finally {
			connectingId = null;
		}
	}

	async function selectActive(id: HarnessId) {
		const api = getBackend();
		if (!api || settingActive || id === activeId) return;
		settingActive = true;
		try {
			activeId = await api.setActiveHarness(id);
			await refresh();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			settingActive = false;
		}
	}

	async function saveModel(id: HarnessId) {
		const api = getBackend();
		if (!api || savingModelId) return;
		const next = draftModels[id] ?? '';
		if (next === (models[id] ?? '')) return;
		savingModelId = id;
		try {
			models = await api.setHarnessModel(id, next);
			draftModels = { ...models };
			await refresh();
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		} finally {
			savingModelId = null;
		}
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

<title>Settings · auto-rob</title>

<main class="bg-background text-on-background min-h-dvh px-6 pt-12 pb-28">
	<h1 class="text-on-surface text-2xl font-semibold tracking-tight">Settings</h1>

	{#if loadError}
		<p class="text-error mt-4 max-w-lg text-sm">{loadError}</p>
	{:else}
		<section class="mt-10 max-w-lg" aria-label="Harnesses">
			<h2 class="text-on-surface text-sm font-semibold tracking-tight">Harnesses</h2>
			{#if harnesses.length === 0}
				<p class="text-on-surface-variant mt-2 text-sm">Loading harnesses…</p>
			{:else}
				<ul class="mt-4 space-y-5">
					{#each harnesses as h (h.id)}
						<li class="flex flex-col gap-2">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0">
									<p class="text-on-surface text-sm font-medium">{h.label}</p>
									<p
										class={[
											'mt-0.5 text-sm',
											h.binaryOk && h.mcpConfigured && h.mcpAuthenticated
												? 'text-on-surface-variant'
												: 'text-error'
										]}
									>
										{statusText(h)}
									</p>
								</div>
								{#if needsConnect(h)}
									<Button
										variant="filled"
										disabled={connectingId !== null}
										click={() => connect(h.id)}
									>
										{connectingId === h.id ? 'Connecting…' : 'Connect'}
									</Button>
								{/if}
							</div>
							{#if !h.binaryOk}
								<p class="text-on-surface-variant text-sm leading-relaxed">
									{installHelp(h)}
								</p>
							{/if}
							{#if h.error}
								<p class="text-error text-sm">{h.error}</p>
							{/if}
						</li>
					{/each}
				</ul>
				{#if connectMessage}
					<p class="text-on-surface-variant mt-4 text-sm leading-relaxed">{connectMessage}</p>
				{/if}
			{/if}
		</section>

		<section class="mt-10 max-w-lg" aria-label="Models">
			<h2 class="text-on-surface text-sm font-semibold tracking-tight">Models</h2>
			<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
				Per-harness model id used on the next run.
			</p>
			{#if harnesses.length === 0}
				<p class="text-on-surface-variant mt-2 text-sm">Loading…</p>
			{:else}
				<ul class="mt-4 space-y-4">
					{#each harnesses as h (h.id)}
						<li class="flex flex-col gap-2">
							<label class="text-on-surface text-sm font-medium" for={`model-${h.id}`}>
								{h.label}
							</label>
							<div class="flex items-center gap-2">
								<input
									id={`model-${h.id}`}
									class="border-outline bg-surface text-on-surface placeholder:text-on-surface-variant focus:border-primary min-w-0 flex-1 rounded border px-3 py-2 text-sm outline-none"
									type="text"
									placeholder={modelHint(h.id)}
									bind:value={draftModels[h.id]}
									disabled={savingModelId !== null}
									onkeydown={(e) => {
										if (e.key === 'Enter') void saveModel(h.id);
									}}
								/>
								<Button
									variant="tonal"
									disabled={savingModelId !== null ||
										(draftModels[h.id] ?? '') === (models[h.id] ?? '')}
									click={() => saveModel(h.id)}
								>
									{savingModelId === h.id ? 'Saving…' : 'Save'}
								</Button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="mt-10 max-w-lg" aria-label="Active harness">
			<h2 class="text-on-surface text-sm font-semibold tracking-tight">Active harness</h2>
			{#if available.length === 0}
				<p class="text-on-surface-variant mt-2 text-sm">
					No harness CLI available yet. Install Cursor or ChatGPT / Codex first.
				</p>
			{:else}
				<div class="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Choose active harness">
					{#each available as h (h.id)}
						<label class="text-on-surface flex cursor-pointer items-center gap-2 text-sm">
							<input
								type="radio"
								name="active-harness"
								value={h.id}
								checked={activeId === h.id}
								disabled={settingActive}
								onchange={() => selectActive(h.id)}
							/>
							<span>
								{h.label}
								{#if activeId === h.id}
									<span class="text-on-surface-variant"> · active</span>
								{/if}
							</span>
						</label>
					{/each}
				</div>
			{/if}
		</section>
	{/if}
</main>

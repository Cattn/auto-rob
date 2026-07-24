<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { HarnessConnection, HarnessId, HarnessModels, HealthInfo } from '$lib/backend';

	let health = $state<HealthInfo | null>(null);
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

	const activeHarness = $derived.by((): HarnessConnection | null => {
		if (!activeId) return null;
		return harnesses.find((h) => h.id === activeId) ?? null;
	});

	const agentPath = $derived(activeHarness?.binaryPath ?? health?.agentPath ?? null);

	function modelsFromHarnesses(list: HarnessConnection[]): HarnessModels {
		const next: HarnessModels = { cursor: '', codex: '' };
		for (const h of list) {
			next[h.id] = h.model ?? '';
		}
		return next;
	}

	function applyHealth(info: HealthInfo) {
		health = info;
		harnesses = info.harnesses;
		activeId = info.activeHarness;
		const nextModels = modelsFromHarnesses(info.harnesses);
		models = nextModels;
		draftModels = { ...nextModels };
	}

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
		applyHealth(await api.getHealth());
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
			harnesses = harnesses.map((h) => (h.id === id ? { ...h, model: models[id] } : h));
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

<main class="bg-background text-on-background flex min-h-dvh w-full justify-center px-6 pt-12 pb-28">
	<div class="w-full max-w-2xl">
		<header>
			<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">Settings</p>
			<h1 class="text-on-surface mt-1 text-3xl font-bold tracking-tight">Agent & harness</h1>
			<p class="text-on-surface-variant mt-2 max-w-xl text-sm leading-relaxed">
				Connection health, harness install, models, and which agent runs next.
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
											<p class="text-on-surface-variant mt-0.5 text-sm">
												{#if !h.binaryOk}
													CLI binary not found on this machine
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
													h.binaryOk && h.mcpConfigured && h.mcpAuthenticated
														? 'bg-primary/15 text-primary'
														: 'bg-error-container text-on-error-container'
												]}
											>
												{statusText(h)}
											</span>
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
									</div>
									{#if !h.binaryOk}
										<p class="text-on-surface-variant text-sm leading-relaxed">
											{installHelp(h)}
										</p>
									{/if}
									{#if h.error}
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
				</section>

				<section aria-label="Active harness">
					<div class="mb-3">
						<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
							Active harness
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							Choose which installed CLI the next run uses.
						</p>
					</div>

					{#if available.length === 0}
						<div class="bg-surface-container-high ring-outline/50 rounded-xl p-4 ring-1">
							<p class="text-on-surface-variant text-sm">
								No harness CLI available yet. Install Cursor or ChatGPT / Codex first.
							</p>
						</div>
					{:else}
						<div
							class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
							role="radiogroup"
							aria-label="Choose active harness"
						>
							{#each available as h (h.id)}
								<label
									class={[
										'flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors',
										activeId === h.id
											? 'bg-primary/10'
											: 'hover:bg-surface-container-highest/60',
										settingActive && 'pointer-events-none opacity-60'
									]}
								>
									<input
										class="text-primary focus:ring-primary"
										type="radio"
										name="active-harness"
										value={h.id}
										checked={activeId === h.id}
										disabled={settingActive}
										onchange={() => selectActive(h.id)}
									/>
									<div class="min-w-0 flex-1">
										<p class="text-on-surface text-sm font-medium">{h.label}</p>
										<p class="text-on-surface-variant mt-0.5 text-sm">
											{activeId === h.id ? 'Active for the next run' : 'Available'}
										</p>
									</div>
									{#if activeId === h.id}
										<span class="bg-primary/15 text-primary shrink-0 rounded-md px-2.5 py-1 text-xs font-medium">
											active
										</span>
									{/if}
								</label>
							{/each}
						</div>
					{/if}
				</section>

				<section aria-label="Models">
					<div class="mb-3">
						<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
							Models
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							Per-harness model id used on the next run.
						</p>
					</div>

					{#if harnesses.length === 0}
						<div class="bg-surface-container-high ring-outline/50 rounded-xl p-4 ring-1">
							<p class="text-on-surface-variant text-sm">Loading…</p>
						</div>
					{:else}
						<div
							class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
						>
							{#each harnesses as h (h.id)}
								<div class="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
									<label class="min-w-0" for={`model-${h.id}`}>
										<span class="text-on-surface block text-sm font-medium">{h.label}</span>
										<span class="text-on-surface-variant mt-0.5 block text-sm">
											{modelHint(h.id)}
										</span>
									</label>
									<div class="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:min-w-[16rem]">
										<input
											id={`model-${h.id}`}
											class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary min-w-0 flex-1 rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
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
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<section aria-label="Connection info">
					<div class="mb-2">
						<h2 class="text-on-surface-variant text-[0.65rem] font-semibold tracking-[0.14em] uppercase">
							Connection
						</h2>
					</div>

					{#if !health}
						<div
							class="bg-surface-container-high ring-outline/50 rounded-xl px-3 py-2.5 ring-1"
						>
							<p class="text-on-surface-variant text-xs">Checking agent…</p>
						</div>
					{:else}
						<div
							class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
						>
							<div class="flex items-center justify-between gap-4 px-3 py-2.5">
								<div class="min-w-0">
									<p class="text-on-surface text-xs font-medium">Status</p>
									<p class="text-on-surface-variant mt-0.5 text-xs">Agent process reachability</p>
								</div>
								<span
									class={[
										'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
										health.ok
											? 'bg-primary/15 text-primary'
											: 'bg-error-container text-on-error-container'
									]}
								>
									{health.ok ? 'Agent reachable' : 'Agent missing'}
								</span>
							</div>

							{#if activeHarness}
								<div class="flex items-center justify-between gap-4 px-3 py-2.5">
									<div class="min-w-0">
										<p class="text-on-surface text-xs font-medium">Harness</p>
										<p class="text-on-surface-variant mt-0.5 text-xs">Currently selected CLI</p>
									</div>
									<span
										class="bg-surface text-on-surface ring-outline/50 shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ring-1"
									>
										{activeHarness.label}
									</span>
								</div>

								<div class="flex items-center justify-between gap-4 px-3 py-2.5">
									<div class="min-w-0">
										<p class="text-on-surface text-xs font-medium">Robinhood</p>
										<p class="text-on-surface-variant mt-0.5 text-xs">MCP auth for the active harness</p>
									</div>
									<span
										class={[
											'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
											activeHarness.mcpConfigured && activeHarness.mcpAuthenticated
												? 'bg-primary/15 text-primary'
												: 'bg-surface-container-highest text-on-surface-variant'
										]}
									>
										{activeHarness.mcpConfigured && activeHarness.mcpAuthenticated
											? 'connected'
											: 'not connected'}
									</span>
								</div>
							{/if}

							<div class="flex items-center justify-between gap-4 px-3 py-2.5">
								<div class="min-w-0">
									<p class="text-on-surface text-xs font-medium">Runs</p>
									<p class="text-on-surface-variant mt-0.5 text-xs">Execution mode for agent runs</p>
								</div>
								<span
									class="bg-primary/15 text-primary shrink-0 rounded-md px-2 py-0.5 text-xs font-medium"
								>
									{health.fakeRuns ? 'fake / dry-run' : 'REAL agent'}
								</span>
							</div>

							<div class="flex items-center justify-between gap-4 px-3 py-2.5">
								<div class="min-w-0">
									<p class="text-on-surface text-xs font-medium">ntfy</p>
									<p class="text-on-surface-variant mt-0.5 text-xs">Push notification topic</p>
								</div>
								<span
									class={[
										'shrink-0 rounded-md px-2 py-0.5 text-xs font-medium',
										health.ntfyConfigured
											? 'bg-primary/15 text-primary'
											: 'bg-surface-container-highest text-on-surface-variant'
									]}
								>
									{health.ntfyConfigured ? 'configured' : 'not configured'}
								</span>
							</div>

							{#if agentPath}
								<div class="flex items-center justify-between gap-4 px-3 py-2.5">
									<div class="min-w-0">
										<p class="text-on-surface text-xs font-medium">Path</p>
										<p class="text-on-surface-variant mt-0.5 truncate text-xs" title={agentPath}>
											{agentPath}
										</p>
									</div>
								</div>
							{/if}

							<div class="flex items-center justify-between gap-4 px-3 py-2.5">
								<div class="min-w-0">
									<p class="text-on-surface text-xs font-medium">Repo</p>
									<p class="text-on-surface-variant mt-0.5 truncate text-xs" title={health.repoRoot}>
										{health.repoRoot || '—'}
									</p>
								</div>
							</div>

							{#if health.error}
								<div class="px-3 py-2.5">
									<p class="text-error text-xs">{health.error}</p>
								</div>
							{/if}
						</div>
					{/if}
				</section>
			</div>
		{/if}
	</div>
</main>

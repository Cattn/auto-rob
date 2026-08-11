<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button, Checkbox } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type {
		HarnessConnection,
		HarnessId,
		HarnessModels,
		HealthInfo,
		NtfySettings,
		SchedulePreset,
		ScheduleStatus
	} from '$lib/backend';
	import HarnessConnectPanel from '$lib/components/HarnessConnectPanel.svelte';
	import {
		SCHEDULE_PRESET_OPTIONS,
		tradeStyleLabel
	} from '$lib/schedule-presets';

	let health = $state<HealthInfo | null>(null);
	let harnesses = $state<HarnessConnection[]>([]);
	let activeId = $state<HarnessId | null>(null);
	let models = $state<HarnessModels>({ cursor: '', codex: '' });
	let draftModels = $state<HarnessModels>({ cursor: '', codex: '' });
	let ntfy = $state<NtfySettings | null>(null);
	let draftNtfy = $state({ url: '', topic: '', token: '' });
	let clearNtfyToken = $state(false);
	let schedule = $state<ScheduleStatus | null>(null);
	let loadError = $state<string | null>(null);
	let settingActive = $state(false);
	let savingModelId = $state<HarnessId | null>(null);
	let savingNtfy = $state(false);
	let ntfyMessage = $state<string | null>(null);
	let scheduleBusy = $state(false);
	let scheduleMessage = $state<string | null>(null);
	let copiedCommand = $state(false);

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

	function modelHint(id: HarnessId): string {
		if (id === 'cursor') return 'Leave blank for Cursor default';
		return 'Leave blank for Codex default';
	}

	function applyNtfy(settings: NtfySettings) {
		ntfy = settings;
		draftNtfy = {
			url: settings.url,
			topic: settings.topic,
			token: ''
		};
		clearNtfyToken = false;
	}

	const ntfyDirty = $derived(
		ntfy !== null &&
			(draftNtfy.url !== ntfy.url ||
				draftNtfy.topic !== ntfy.topic ||
				draftNtfy.token.length > 0 ||
				clearNtfyToken)
	);

	async function refresh() {
		const api = getBackend();
		if (!api) return;
		const [healthInfo, ntfySettings, scheduleStatus] = await Promise.all([
			api.getHealth(),
			api.getNtfySettings(),
			api.getSchedule()
		]);
		applyHealth(healthInfo);
		applyNtfy(ntfySettings);
		schedule = scheduleStatus;
	}

	async function setScheduleEnabled(enabled: boolean) {
		const api = getBackend();
		if (!api || scheduleBusy) return;
		scheduleBusy = true;
		scheduleMessage = null;
		try {
			schedule = await api.setScheduleEnabled(enabled);
			scheduleMessage = enabled
				? 'Unattended schedule enabled.'
				: 'Schedule disabled — OS jobs removed.';
		} catch (err) {
			scheduleMessage = err instanceof Error ? err.message : String(err);
			await refresh().catch(() => {});
		} finally {
			scheduleBusy = false;
		}
	}

	async function setSchedulePreset(preset: SchedulePreset) {
		const api = getBackend();
		if (!api || scheduleBusy || schedule?.preset === preset) return;
		scheduleBusy = true;
		scheduleMessage = null;
		try {
			schedule = await api.setSchedulePreset(preset);
		} catch (err) {
			scheduleMessage = err instanceof Error ? err.message : String(err);
		} finally {
			scheduleBusy = false;
		}
	}

	async function setScheduleRunMissed(runMissed: boolean) {
		const api = getBackend();
		if (!api || scheduleBusy) return;
		scheduleBusy = true;
		scheduleMessage = null;
		try {
			schedule = await api.setScheduleRunMissed(runMissed);
		} catch (err) {
			scheduleMessage = err instanceof Error ? err.message : String(err);
		} finally {
			scheduleBusy = false;
		}
	}

	async function copyRunCommand() {
		if (!schedule?.runCommand) return;
		try {
			await navigator.clipboard.writeText(schedule.runCommand);
			copiedCommand = true;
			setTimeout(() => {
				copiedCommand = false;
			}, 1500);
		} catch {
			scheduleMessage = 'Could not copy to clipboard.';
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

	async function saveNtfy() {
		const api = getBackend();
		if (!api || savingNtfy || !ntfyDirty) return;
		savingNtfy = true;
		ntfyMessage = null;
		try {
			const saved = await api.setNtfySettings({
				url: draftNtfy.url,
				topic: draftNtfy.topic,
				token: draftNtfy.token || undefined,
				clearToken: clearNtfyToken
			});
			applyNtfy(saved);
			if (health) health = { ...health, ntfyConfigured: saved.configured };
			ntfyMessage = saved.configured
				? 'Saved — phone briefs enabled for the next run.'
				: 'Saved — leave URL and topic blank to keep notifications off.';
		} catch (err) {
			ntfyMessage = err instanceof Error ? err.message : String(err);
		} finally {
			savingNtfy = false;
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
				Connection health, trading preferences, harness install, phone notifications, models, and
				which agent runs next.
			</p>
		</header>

		{#if loadError}
			<p class="text-error mt-6 text-sm">{loadError}</p>
		{:else}
			<div class="mt-8 flex flex-col gap-8">
				<section aria-label="Trading preferences">
					<div class="mb-3">
						<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
							Trading preferences
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							Edit cadence, intent, and sizing limits written into prompt.md.
						</p>
					</div>
					<div
						class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
					>
						<div class="flex items-center justify-between gap-3 px-4 py-3.5">
							<div class="min-w-0">
								<p class="text-on-surface text-sm font-medium">Prompt preferences</p>
								<p class="text-on-surface-variant mt-0.5 text-sm">
									Change standing instructions for how the agent trades
								</p>
							</div>
							<Button
								variant="tonal"
								click={() => {
									void goto(`${resolve('/onboarding')}?edit=1`);
								}}
							>
								Edit
							</Button>
						</div>
					</div>
				</section>

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
				</section>

				{#if available.length >= 2}
					<section aria-label="Active harness">
						<div class="mb-3">
							<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
								Active harness
							</h2>
							<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
								Choose which installed CLI the next run uses.
							</p>
						</div>

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
					</section>
				{/if}

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

				<section aria-label="Schedule">
					<div class="mb-3">
						<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
							Unattended schedule
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							Market hours 9:30–4:00 ET in your local time. Enable only after a harness is
							connected.
						</p>
					</div>
					{#if schedule === null}
						<div class="bg-surface-container-high ring-outline/50 rounded-xl p-4 ring-1">
							<p class="text-on-surface-variant text-sm">Loading schedule…</p>
						</div>
					{:else}
						<div
							class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
						>
							<div class="flex items-center justify-between gap-3 px-4 py-3.5">
								<div class="min-w-0">
									<p class="text-on-surface text-sm font-medium">Enable schedule</p>
									<p class="text-on-surface-variant mt-0.5 text-sm">
										{#if !schedule.canEnable}
											Connect Cursor or Codex first
										{:else if schedule.enabled}
											OS jobs installed · next {schedule.nextRunLabel ?? '—'}
										{:else}
											Off — no OS jobs registered
										{/if}
									</p>
								</div>
								<Button
									variant={schedule.enabled ? 'tonal' : 'filled'}
									disabled={scheduleBusy || (!schedule.enabled && !schedule.canEnable)}
									click={() => setScheduleEnabled(!schedule.enabled)}
								>
									{scheduleBusy
										? 'Working…'
										: schedule.enabled
											? 'Disable'
											: 'Enable'}
								</Button>
							</div>
							<div class="px-4 py-3.5">
								<p class="text-on-surface mb-2 text-sm font-medium">Preset</p>
								<div class="flex flex-col gap-2" role="radiogroup" aria-label="Schedule preset">
									{#each SCHEDULE_PRESET_OPTIONS as opt (opt.value)}
										<label
											class={[
												'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 transition-colors',
												schedule.preset === opt.value
													? 'bg-primary/10'
													: 'hover:bg-surface-container-highest/60'
											]}
										>
											<input
												class="text-primary focus:ring-primary mt-1"
												type="radio"
												name="settings-schedule-preset"
												value={opt.value}
												checked={schedule.preset === opt.value}
												disabled={scheduleBusy}
												onchange={() => setSchedulePreset(opt.value)}
											/>
											<span class="min-w-0">
												<span class="text-on-surface block text-sm font-medium"
													>{opt.label}</span
												>
												<span class="text-on-surface-variant mt-0.5 block text-sm"
													>{opt.subtitle}</span
												>
											</span>
										</label>
									{/each}
								</div>
								{#if schedule.cadenceMatch}
									<p class="text-on-surface-variant mt-2 text-sm">
										Matches your current trade cadence suggestion ({tradeStyleLabel(
											SCHEDULE_PRESET_OPTIONS.find((o) => o.value === schedule.suggestedPreset)
												?.cadence ?? 'balanced'
										)}).
									</p>
								{:else}
									<p class="text-on-surface-variant mt-2 text-sm">
										Differs from suggested cadence preset
										{SCHEDULE_PRESET_OPTIONS.find((o) => o.value === schedule.suggestedPreset)
											?.label ?? schedule.suggestedPreset}.
									</p>
								{/if}
								{#if schedule.slotsLocal.length}
									<p class="text-on-surface-variant mt-2 text-sm">
										Local slots: {schedule.slotsLocal.join(', ')}
									</p>
								{/if}
							</div>
							<div class="flex items-center justify-between gap-3 px-4 py-3.5">
								<div class="min-w-0">
									<p class="text-on-surface text-sm font-medium">Run missed slots</p>
									<p class="text-on-surface-variant mt-0.5 text-sm">
										Catch up at most one latest missed run after wake/login — never chains.
									</p>
								</div>
								<label class="text-on-surface flex shrink-0 items-center gap-2 text-sm">
									<Checkbox>
										<input
											type="checkbox"
											checked={schedule.runMissed}
											disabled={scheduleBusy}
											onchange={() => setScheduleRunMissed(!schedule.runMissed)}
										/>
									</Checkbox>
								</label>
							</div>
							<div class="px-4 py-3.5">
								<p class="text-on-surface text-sm font-medium">Manual command</p>
								<p class="text-on-surface-variant mt-0.5 text-sm">
									For a custom OS schedule, point Task Scheduler / cron / launchd at this
									app executable (not your workspace folder):
								</p>
								<code
									class="bg-surface text-on-surface mt-2 block overflow-x-auto rounded-lg px-3 py-2 text-xs break-all"
								>
									{schedule.runCommand}
								</code>
								<div class="mt-2">
									<Button variant="text" click={copyRunCommand}>
										{copiedCommand ? 'Copied' : 'Copy command'}
									</Button>
								</div>
							</div>
						</div>
						{#if scheduleMessage || schedule.error}
							<p class="text-on-surface-variant mt-3 text-sm leading-relaxed">
								{scheduleMessage ?? schedule.error}
							</p>
						{/if}
					{/if}
				</section>

				<section aria-label="Phone notifications">
					<div class="mb-3">
						<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
							Phone notifications (ntfy)
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							Stored in the workspace <code class="text-on-surface">.env</code> via the app
							process — the agent cannot read or write these values. Leave blank to disable.
						</p>
					</div>

					<div
						class="bg-surface-container-high ring-outline/50 flex flex-col gap-3 rounded-xl p-4 ring-1"
					>
						<label class="flex flex-col gap-1.5" for="ntfy-url">
							<span class="text-on-surface text-sm font-medium">Server URL</span>
							<input
								id="ntfy-url"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
								type="url"
								autocomplete="off"
								spellcheck="false"
								placeholder="https://ntfy.example.com"
								bind:value={draftNtfy.url}
								disabled={savingNtfy || ntfy === null}
							/>
						</label>

						<label class="flex flex-col gap-1.5" for="ntfy-topic">
							<span class="text-on-surface text-sm font-medium">Topic</span>
							<input
								id="ntfy-topic"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
								type="text"
								autocomplete="off"
								spellcheck="false"
								placeholder="auto-rob"
								bind:value={draftNtfy.topic}
								disabled={savingNtfy || ntfy === null}
							/>
						</label>

						<label class="flex flex-col gap-1.5" for="ntfy-token">
							<span class="text-on-surface text-sm font-medium">Access token</span>
							<input
								id="ntfy-token"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
								type="password"
								autocomplete="new-password"
								spellcheck="false"
								placeholder={ntfy?.tokenConfigured
									? 'Leave blank to keep the saved token'
									: 'Optional if your server requires auth'}
								bind:value={draftNtfy.token}
								disabled={savingNtfy || ntfy === null || clearNtfyToken}
								oninput={() => {
									if (draftNtfy.token) clearNtfyToken = false;
								}}
							/>
						</label>

						{#if ntfy?.tokenConfigured}
							<label
								class={[
									'text-on-surface flex items-center gap-3 text-sm',
									savingNtfy ? 'opacity-60' : 'cursor-pointer'
								]}
							>
								<Checkbox>
									<input
										type="checkbox"
										bind:checked={clearNtfyToken}
										disabled={savingNtfy}
										onchange={() => {
											if (clearNtfyToken) draftNtfy.token = '';
										}}
									/>
								</Checkbox>
								Clear saved access token
							</label>
						{/if}

						<div class="flex flex-wrap items-center justify-between gap-3 pt-1">
							<span
								class={[
									'rounded-md px-2.5 py-1 text-xs font-medium',
									(ntfy?.configured ?? false)
										? 'bg-primary/15 text-primary'
										: 'bg-surface-container-highest text-on-surface-variant'
								]}
							>
								{(ntfy?.configured ?? false) ? 'configured' : 'not configured'}
							</span>
							<Button
								variant="filled"
								disabled={savingNtfy || !ntfyDirty}
								click={() => saveNtfy()}
							>
								{savingNtfy ? 'Saving…' : 'Save ntfy'}
							</Button>
						</div>

						{#if ntfyMessage}
							<p class="text-on-surface-variant text-sm leading-relaxed">{ntfyMessage}</p>
						{/if}
					</div>
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

							{#if health.error && health.harnesses.length === 0}
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

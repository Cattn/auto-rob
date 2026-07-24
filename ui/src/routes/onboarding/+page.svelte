<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { OnboardingAnswers, OnboardingState, TradeStyle } from '$lib/backend';

	const TRADE_OPTIONS: { value: TradeStyle; label: string }[] = [
		{ value: 'more_active', label: 'More active / faster trades' },
		{ value: 'balanced', label: 'Balanced cadence' },
		{ value: 'less_frequent', label: 'Less frequent trades' },
	];

	let tradeStyle = $state<TradeStyle>('balanced');
	let intent = $state('');
	let minPerTradeUsd = $state<string | number>('');
	let minBpToAddPosition = $state<string | number>('');

	let loading = $state(true);
	let saving = $state(false);
	let applying = $state(false);
	let resetting = $state(false);
	let loadError = $state<string | null>(null);
	let statusMsg = $state<string | null>(null);
	let statusOk = $state(true);
	let state = $state<OnboardingState | null>(null);

	const editMode = $derived(
		(browser && page.url.searchParams.has('edit')) || Boolean(state?.completedAt),
	);

	function parseOptionalUsd(raw: string | number | null | undefined): number | null {
		if (raw === null || raw === undefined || raw === '') return null;
		const s = String(raw).trim();
		if (!s) return null;
		const n = Number(s);
		return Number.isFinite(n) && n >= 0 ? n : null;
	}

	function buildAnswers(): OnboardingAnswers {
		return {
			tradeStyle,
			intent,
			minPerTradeUsd: parseOptionalUsd(minPerTradeUsd),
			minBpToAddPosition: parseOptionalUsd(minBpToAddPosition),
		};
	}

	function applyState(s: OnboardingState) {
		state = s;
		tradeStyle = s.answers.tradeStyle;
		intent = s.answers.intent;
		minPerTradeUsd = s.answers.minPerTradeUsd != null ? String(s.answers.minPerTradeUsd) : '';
		minBpToAddPosition =
			s.answers.minBpToAddPosition != null ? String(s.answers.minBpToAddPosition) : '';
	}

	function setStatus(msg: string, ok: boolean) {
		statusMsg = msg;
		statusOk = ok;
	}

	async function saveDraft() {
		const api = getBackend();
		if (!api || saving) return;
		saving = true;
		statusMsg = null;
		try {
			const next = await api.saveOnboarding(buildAnswers(), { draft: true });
			applyState(next);
			setStatus(editMode ? 'Changes saved as draft.' : 'Draft saved.', true);
		} catch (err) {
			setStatus(err instanceof Error ? err.message : String(err), false);
		} finally {
			saving = false;
		}
	}

	async function saveAndApply() {
		const api = getBackend();
		if (!api || applying) return;
		applying = true;
		statusMsg = null;
		const wasEdit = editMode;
		try {
			const result = await api.applyOnboarding(buildAnswers());
			applyState(result.state);
			setStatus(result.message, result.ok);
			if (result.ok) {
				void goto(resolve(wasEdit ? '/settings' : '/'));
			}
		} catch (err) {
			setStatus(err instanceof Error ? err.message : String(err), false);
		} finally {
			applying = false;
		}
	}

	async function resetPrompt() {
		const api = getBackend();
		if (!api || resetting) return;
		if (
			!window.confirm(
				'Reset prompt.md to the stock default? Your current prompt will be overwritten.',
			)
		)
			return;
		resetting = true;
		statusMsg = null;
		try {
			const result = await api.resetPrompt();
			applyState(result.state);
			setStatus(result.message, result.ok);
		} catch (err) {
			setStatus(err instanceof Error ? err.message : String(err), false);
		} finally {
			resetting = false;
		}
	}

	onMount(() => {
		const api = getBackend();
		if (!api) {
			loadError = 'Not running inside Electron — start with pnpm start from ui/';
			loading = false;
			return;
		}
		api
			.getOnboarding()
			.then((s) => {
				applyState(s);
				loading = false;
			})
			.catch((err) => {
				loadError = err instanceof Error ? err.message : String(err);
				loading = false;
			});
	});
</script>

<title>{editMode ? 'Edit preferences' : 'Onboarding'} · auto-rob</title>

<main
	class="bg-background text-on-background flex min-h-dvh w-full justify-center px-6 pt-12 pb-28"
>
	<div class="w-full max-w-2xl">
		{#if editMode}
			<div class="mb-6">
				<Button
					variant="text"
					disabled={saving || applying}
					click={() => goto(resolve('/settings'))}
				>
					← Back to settings
				</Button>
			</div>
		{/if}

		<header>
			{#if editMode}
				<p
					class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase"
				>
					Settings
				</p>
				<h1 class="text-on-surface mt-1 text-3xl font-bold tracking-tight">
					Edit preferences
				</h1>
				<p class="text-on-surface-variant mt-2 max-w-xl text-sm leading-relaxed">
					Update trade cadence, focus, and sizing limits. Saving & applying rewrites the
					standing instructions in prompt.md.
				</p>
			{:else}
				<p
					class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase"
				>
					Onboarding
				</p>
				<h1 class="text-on-surface mt-1 text-3xl font-bold tracking-tight">
					Your preferences
				</h1>
				<p class="text-on-surface-variant mt-2 max-w-xl text-sm leading-relaxed">
					Tell the agent how you want it to trade. These preferences are written into
					prompt.md as standing instructions.
				</p>
			{/if}
		</header>

		{#if loadError}
			<p class="text-error mt-6 text-sm">{loadError}</p>
		{:else if loading}
			<p class="text-on-surface-variant mt-8 text-sm">Loading…</p>
		{:else}
			<div class="mt-8 flex flex-col gap-8">
				<section aria-label="Trade cadence">
					<div class="mb-3">
						<h2
							class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase"
						>
							Trade cadence
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							How actively should the agent look for trades?
						</p>
					</div>
					<div
						class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
						role="radiogroup"
						aria-label="Trade cadence"
					>
						{#each TRADE_OPTIONS as opt (opt.value)}
							<label
								class={[
									'flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors',
									tradeStyle === opt.value
										? 'bg-primary/10'
										: 'hover:bg-surface-container-highest/60'
								]}
							>
								<input
									class="text-primary focus:ring-primary"
									type="radio"
									name="trade-style"
									value={opt.value}
									checked={tradeStyle === opt.value}
									onchange={() => (tradeStyle = opt.value)}
								/>
								<span class="text-on-surface text-sm font-medium">{opt.label}</span>
							</label>
						{/each}
					</div>
				</section>

				<section aria-label="Intent">
					<div class="mb-3 flex flex-wrap items-end justify-between gap-3">
						<div class="min-w-0">
							<h2
								class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase"
							>
								Intent / focus
							</h2>
							<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
								{#if editMode}
									Revise what the agent should focus on — sectors, strategies, or goals.
								{:else}
									Describe what you want the agent to focus on — sectors, strategies, or goals.
								{/if}
							</p>
						</div>
						<Button
							variant="text"
							disabled={saving || applying || resetting}
							click={resetPrompt}
						>
							{resetting ? 'Resetting…' : 'Reset prompt to default'}
						</Button>
					</div>
					<textarea
						class="bg-surface-container-high text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary w-full rounded-xl px-4 py-3 text-sm leading-relaxed outline-none ring-1 focus:ring-2"
						rows={3}
						placeholder="e.g. Tech sector, momentum plays, avoid penny stocks"
						bind:value={intent}
					></textarea>
				</section>

				<section aria-label="Sizing">
					<div class="mb-3">
						<h2
							class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase"
						>
							Sizing limits (optional)
						</h2>
						<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
							Floor values — the agent won't go below these.
						</p>
					</div>
					<div
						class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
					>
						<div
							class="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
						>
							<label class="min-w-0" for="min-per-trade">
								<span class="text-on-surface block text-sm font-medium"
									>Min per trade ($)</span
								>
								<span class="text-on-surface-variant mt-0.5 block text-sm"
									>Smallest dollar amount per trade</span
								>
							</label>
							<input
								id="min-per-trade"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary w-full rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2 sm:w-40"
								type="number"
								min="0"
								step="any"
								placeholder="e.g. 50"
								bind:value={minPerTradeUsd}
							/>
						</div>
						<div
							class="flex flex-col gap-2 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
						>
							<label class="min-w-0" for="min-bp">
								<span class="text-on-surface block text-sm font-medium"
									>Min BP to add position ($)</span
								>
								<span class="text-on-surface-variant mt-0.5 block text-sm"
									>Buying power floor before opening new positions</span
								>
							</label>
							<input
								id="min-bp"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary w-full rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2 sm:w-40"
								type="number"
								min="0"
								step="any"
								placeholder="e.g. 200"
								bind:value={minBpToAddPosition}
							/>
						</div>
					</div>
				</section>

				<section aria-label="Actions" class="flex flex-wrap gap-3">
					<Button variant="tonal" disabled={saving || applying} click={saveDraft}>
						{saving ? 'Saving…' : 'Save draft'}
					</Button>
					<Button
						variant="filled"
						disabled={saving || applying}
						click={saveAndApply}
					>
						{applying
							? 'Running agent…'
							: editMode
								? 'Save & apply changes'
								: 'Save & apply'}
					</Button>
				</section>

				{#if statusMsg}
					<p class={statusOk ? 'text-primary text-sm' : 'text-error text-sm'}>
						{statusMsg}
					</p>
				{/if}

				{#if state?.completedAt || state?.appliedAt}
					<section aria-label="State">
						<div class="mb-2">
							<h2
								class="text-on-surface-variant text-[0.65rem] font-semibold tracking-[0.14em] uppercase"
							>
								Status
							</h2>
						</div>
						<div
							class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y rounded-xl ring-1"
						>
							{#if state.completedAt}
								<div class="flex items-center justify-between gap-4 px-3 py-2.5">
									<p class="text-on-surface text-xs font-medium">Completed</p>
									<span
										class="text-on-surface-variant shrink-0 text-xs"
									>
										{new Date(state.completedAt).toLocaleString()}
									</span>
								</div>
							{/if}
							{#if state.appliedAt}
								<div class="flex items-center justify-between gap-4 px-3 py-2.5">
									<p class="text-on-surface text-xs font-medium">Applied</p>
									<span
										class="text-on-surface-variant shrink-0 text-xs"
									>
										{state.applyMode ?? 'direct'} · {new Date(state.appliedAt).toLocaleString()}
									</span>
								</div>
							{/if}
						</div>
					</section>
				{/if}
			</div>
		{/if}
	</div>
</main>

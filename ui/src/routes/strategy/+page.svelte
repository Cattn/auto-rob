<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button, Checkbox } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type {
		Constraints,
		LongTermItem,
		LongTermSize,
		LongTermType,
		OnboardingState,
		TradeStyle
	} from '$lib/backend';

	let onboarding = $state<OnboardingState | null>(null);
	let items = $state<LongTermItem[]>([]);
	let neverTradeText = $state('');
	let doNotSellText = $state('');
	let maxPositionPctText = $state('');
	let constraintsNotes = $state('');
	let loadError = $state<string | null>(null);
	let loading = $state(true);
	let constraintsMessage = $state<string | null>(null);
	let focusMessage = $state<string | null>(null);
	let savingConstraints = $state(false);
	let addingItem = $state(false);
	let showingAddItem = $state(false);
	let busyItemId = $state<string | null>(null);
	let editingId = $state<string | null>(null);
	let editTitle = $state('');
	let editType = $state<LongTermType>('goal');
	let editSize = $state<LongTermSize>('medium');
	let editCheckAfter = $state('');
	let editRationale = $state('');
	let newTitle = $state('');
	let newType = $state<LongTermType>('goal');
	let newSize = $state<LongTermSize>('medium');
	let newRationale = $state('');
	let newCheckAfter = $state('');
	let newPinned = $state(false);

	function tradeStyleLabel(style: TradeStyle): string {
		if (style === 'more_active') return 'More active / faster trades';
		if (style === 'less_frequent') return 'Less frequent trades';
		return 'Balanced cadence';
	}

	function formatTimestamp(iso: string): string {
		try {
			return new Intl.DateTimeFormat(undefined, {
				month: 'short',
				day: 'numeric',
				year: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}

	function parseTickers(raw: string): string[] {
		const out: string[] = [];
		for (const part of raw.split(/[\s,]+/)) {
			const ticker = part.trim().toUpperCase();
			if (!ticker || out.includes(ticker)) continue;
			out.push(ticker);
		}
		return out;
	}

	function tickersToText(tickers: string[]): string {
		return tickers.join(', ');
	}

	function applyConstraints(c: Constraints) {
		neverTradeText = tickersToText(c.neverTrade);
		doNotSellText = tickersToText(c.doNotSell);
		maxPositionPctText = c.maxPositionPct == null ? '' : String(c.maxPositionPct);
		constraintsNotes = c.notes;
	}

	function startEdit(item: LongTermItem) {
		editingId = item.id;
		editTitle = item.title;
		editType = item.type;
		editSize = item.size;
		editCheckAfter = item.checkAfter ?? '';
		editRationale = item.rationale;
	}

	function cancelEdit() {
		editingId = null;
	}

	async function refresh() {
		const api = getBackend();
		if (!api) return;
		const [onboardingState, longTerm, constraints] = await Promise.all([
			api.getOnboarding(),
			api.getLongTerm(),
			api.getConstraints()
		]);
		onboarding = onboardingState;
		items = longTerm.items;
		applyConstraints(constraints);
	}

	async function togglePinned(item: LongTermItem) {
		const api = getBackend();
		if (!api || busyItemId) return;
		busyItemId = item.id;
		focusMessage = null;
		try {
			const state = await api.setLongTermPinned(item.id, !item.pinned);
			items = state.items;
		} catch (err) {
			focusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			busyItemId = null;
		}
	}

	async function dismissItem(item: LongTermItem) {
		const api = getBackend();
		if (!api || busyItemId) return;
		const ok = confirm(`Dismiss "${item.title}"?`);
		if (!ok) return;
		busyItemId = item.id;
		focusMessage = null;
		try {
			const state = await api.dismissLongTermItem(item.id);
			items = state.items;
			if (editingId === item.id) editingId = null;
		} catch (err) {
			focusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			busyItemId = null;
		}
	}

	async function saveEdit(id: string) {
		const api = getBackend();
		if (!api || busyItemId) return;
		const title = editTitle.trim();
		if (!title) return;
		busyItemId = id;
		focusMessage = null;
		try {
			const state = await api.updateLongTermItem(id, {
				title,
				type: editType,
				size: editSize,
				checkAfter: editCheckAfter.trim() || null,
				rationale: editRationale.trim()
			});
			items = state.items;
			editingId = null;
		} catch (err) {
			focusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			busyItemId = null;
		}
	}

	async function addItem() {
		const api = getBackend();
		if (!api || addingItem) return;
		const title = newTitle.trim();
		if (!title) return;
		addingItem = true;
		focusMessage = null;
		try {
			const state = await api.addLongTermItem({
				title,
				type: newType,
				size: newSize,
				rationale: newRationale.trim(),
				checkAfter: newCheckAfter.trim() || null,
				pinned: newPinned
			});
			items = state.items;
			newTitle = '';
			newType = 'goal';
			newSize = 'medium';
			newRationale = '';
			newCheckAfter = '';
			newPinned = false;
			showingAddItem = false;
		} catch (err) {
			focusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			addingItem = false;
		}
	}

	async function saveConstraints() {
		const api = getBackend();
		if (!api || savingConstraints) return;
		savingConstraints = true;
		constraintsMessage = null;
		try {
			const trimmedPct = maxPositionPctText.trim();
			let maxPositionPct: number | null = null;
			if (trimmedPct) {
				const n = Number(trimmedPct);
				if (!Number.isFinite(n)) {
					constraintsMessage = 'Max position % must be a number';
					return;
				}
				maxPositionPct = n;
			}
			const saved = await api.setConstraints({
				neverTrade: parseTickers(neverTradeText),
				doNotSell: parseTickers(doNotSellText),
				maxPositionPct,
				notes: constraintsNotes.trim()
			});
			applyConstraints(saved);
			constraintsMessage = 'Constraints saved';
		} catch (err) {
			constraintsMessage = err instanceof Error ? err.message : String(err);
		} finally {
			savingConstraints = false;
		}
	}

	onMount(() => {
		const api = getBackend();
		if (!api) {
			loadError = 'Not running inside Electron — start with pnpm start from ui/';
			loading = false;
			return;
		}
		void refresh()
			.catch((err) => {
				loadError = err instanceof Error ? err.message : String(err);
			})
			.finally(() => {
				loading = false;
			});
	});
</script>

<title>Strategy · auto-rob</title>

<main class="bg-background text-on-background flex min-h-dvh w-full justify-center px-4 pt-8 pb-24 sm:px-6">
	<div class="w-full max-w-6xl">
		<header class="mb-6">
			<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
				Strategy
			</p>
			<h1 class="text-on-surface mt-0.5 text-2xl font-bold tracking-tight sm:text-3xl">
				Intent & constraints
			</h1>
			<p class="text-on-surface-variant mt-1.5 max-w-2xl text-sm leading-relaxed">
				Standing trade intent, durable long-term focus, and hard limits the agent must respect.
			</p>
		</header>

		{#if loadError}
			<p class="text-error text-sm">{loadError}</p>
		{:else if loading}
			<div class="bg-surface-container-high rounded-2xl p-5">
				<p class="text-on-surface-variant text-sm">Loading strategy…</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6">
				<section
					class="bg-surface-container-high order-1 overflow-hidden rounded-2xl lg:col-start-1"
					aria-label="Intent snapshot"
				>
					<div class="border-outline/20 border-b px-4 py-3">
						<h2 class="text-on-surface text-sm font-semibold tracking-tight">Intent snapshot</h2>
						<p class="text-on-surface-variant mt-0.5 text-xs leading-relaxed">
							Preferences written into prompt.md
						</p>
					</div>
					{#if onboarding}
						{@const intentText = onboarding.answers.intent.trim()}
						<div class="divide-outline/20 divide-y">
							<div class="px-4 py-3">
								<p class="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
									Trade style
								</p>
								<p class="text-on-surface mt-1 text-sm font-medium">
									{tradeStyleLabel(onboarding.answers.tradeStyle)}
								</p>
							</div>
							<div class="px-4 py-3">
								<p class="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
									Intent / focus
								</p>
								{#if intentText}
									<p class="text-on-surface mt-1 text-sm leading-relaxed whitespace-pre-wrap">
										{intentText}
									</p>
								{:else}
									<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
										No focus written yet.
									</p>
								{/if}
							</div>
							{#if onboarding.answers.minPerTradeUsd != null}
								<div class="px-4 py-3">
									<p class="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
										Min per trade
									</p>
									<p class="text-on-surface mt-1 text-sm font-medium">
										${onboarding.answers.minPerTradeUsd}
									</p>
								</div>
							{/if}
							{#if onboarding.answers.minBpToAddPosition != null}
								<div class="px-4 py-3">
									<p class="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
										Min buying power
									</p>
									<p class="text-on-surface mt-1 text-sm font-medium">
										${onboarding.answers.minBpToAddPosition}
									</p>
								</div>
							{/if}
							{#if onboarding.appliedAt}
								<div class="px-4 py-3">
									<p class="text-on-surface-variant text-xs font-medium tracking-wide uppercase">
										Last applied
									</p>
									<p class="text-on-surface mt-1 text-sm">
										{formatTimestamp(onboarding.appliedAt)}
									</p>
								</div>
							{/if}
							<div class="flex justify-end px-4 py-3">
								<Button
									variant="tonal"
									click={() => {
										void goto(`${resolve('/onboarding')}?edit=1`);
									}}
								>
									{intentText ? 'Edit in Settings' : 'Add focus in Settings'}
								</Button>
							</div>
						</div>
					{:else}
						<div class="px-4 py-3.5">
							<p class="text-on-surface-variant text-sm leading-relaxed">
								No preferences yet. Set trade cadence and focus in Settings.
							</p>
							<div class="mt-3">
								<Button
									variant="tonal"
									click={() => {
										void goto(`${resolve('/onboarding')}?edit=1`);
									}}
								>
									Set preferences
								</Button>
							</div>
						</div>
					{/if}
				</section>

				<section
					class="bg-surface-container order-2 flex h-144 flex-col overflow-hidden rounded-2xl lg:sticky lg:top-8 lg:col-start-2 lg:row-span-2 lg:h-[calc(100dvh-4rem)] lg:max-h-192"
					aria-label="Long-term focus"
				>
					<div
						class="border-outline/15 flex flex-wrap items-end justify-between gap-3 border-b px-5 py-4"
					>
						<div class="min-w-0">
							<h2 class="text-on-surface text-lg font-semibold tracking-tight">Long-term focus</h2>
							<p class="text-on-surface-variant mt-0.5 text-sm leading-relaxed">
								Durable goals and watches that carry across runs.
							</p>
						</div>
						<div class="flex shrink-0 items-center gap-3">
							{#if items.length > 0}
								<span class="text-on-surface-variant text-xs tabular-nums">
									{items.length} item{items.length === 1 ? '' : 's'}
								</span>
							{/if}
							<Button
								variant="tonal"
								disabled={addingItem}
								aria-expanded={showingAddItem}
								aria-controls="add-long-term-item"
								click={() => {
									showingAddItem = !showingAddItem;
								}}
							>
								{showingAddItem ? 'Close' : 'Add item'}
							</Button>
						</div>
					</div>

					<div class="min-h-0 flex-1 overflow-y-auto">
						{#if items.length === 0}
							<div class="flex h-full min-h-48 flex-col items-start justify-center px-5 py-10">
								<p class="text-on-surface text-sm font-medium">No long-term items yet</p>
								<p class="text-on-surface-variant mt-1 max-w-md text-sm leading-relaxed">
									You and the agent can both add durable goals, watches, or todos here so they
									persist across runs.
								</p>
							</div>
						{:else}
							<ul aria-label="Long-term items">
								{#each items as item (item.id)}
									<li
										class={[
											'border-outline/10 border-l-4 border-b border-l-transparent px-5 py-4 last:border-b-0',
											item.pinned && 'bg-primary/5 border-l-primary'
										]}
									>
										{#if editingId === item.id}
											<div class="flex flex-col gap-3">
												<label class="flex flex-col gap-1.5" for={`edit-title-${item.id}`}>
													<span class="text-on-surface text-sm font-medium">Title</span>
													<input
														id={`edit-title-${item.id}`}
														class="bg-surface text-on-surface ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
														type="text"
														bind:value={editTitle}
														disabled={busyItemId === item.id}
													/>
												</label>
												<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
													<label class="flex flex-col gap-1.5" for={`edit-type-${item.id}`}>
														<span class="text-on-surface text-sm font-medium">Type</span>
														<select
															id={`edit-type-${item.id}`}
															class="bg-surface text-on-surface ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
															bind:value={editType}
															disabled={busyItemId === item.id}
														>
															<option value="goal">goal</option>
															<option value="watch">watch</option>
															<option value="todo">todo</option>
														</select>
													</label>
													<label class="flex flex-col gap-1.5" for={`edit-size-${item.id}`}>
														<span class="text-on-surface text-sm font-medium">Size</span>
														<select
															id={`edit-size-${item.id}`}
															class="bg-surface text-on-surface ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
															bind:value={editSize}
															disabled={busyItemId === item.id}
														>
															<option value="small">small</option>
															<option value="medium">medium</option>
															<option value="large">large</option>
														</select>
													</label>
												</div>
												<label class="flex flex-col gap-1.5" for={`edit-check-${item.id}`}>
													<span class="text-on-surface text-sm font-medium">Check after</span>
													<input
														id={`edit-check-${item.id}`}
														class="bg-surface text-on-surface ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
														type="text"
														placeholder="YYYY-MM-DD or note"
														bind:value={editCheckAfter}
														disabled={busyItemId === item.id}
													/>
												</label>
												<label class="flex flex-col gap-1.5" for={`edit-rationale-${item.id}`}>
													<span class="text-on-surface text-sm font-medium">Rationale</span>
													<textarea
														id={`edit-rationale-${item.id}`}
														class="bg-surface text-on-surface ring-outline/50 focus:ring-primary min-h-18 resize-y rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
														bind:value={editRationale}
														disabled={busyItemId === item.id}
													></textarea>
												</label>
												<div class="flex flex-wrap items-center gap-2">
													<Button
														variant="filled"
														disabled={busyItemId !== null || !editTitle.trim()}
														click={() => saveEdit(item.id)}
													>
														{busyItemId === item.id ? 'Saving…' : 'Save'}
													</Button>
													<Button
														variant="text"
														disabled={busyItemId !== null}
														click={() => cancelEdit()}
													>
														Cancel
													</Button>
												</div>
											</div>
										{:else}
											<div class="flex flex-wrap items-start justify-between gap-2">
												<div class="min-w-0">
													<p class="text-on-surface text-sm font-medium">{item.title}</p>
													<p class="text-on-surface-variant mt-0.5 text-sm">
														{item.type} · {item.size} · {item.source}
													</p>
												</div>
												{#if item.pinned}
													<span
														class="bg-primary/15 text-primary shrink-0 rounded-md px-2.5 py-1 text-xs font-medium"
													>
														pinned
													</span>
												{/if}
											</div>
											{#if item.checkAfter}
												<p class="text-on-surface-variant mt-2 text-sm">
													Check after: {item.checkAfter}
												</p>
											{/if}
											{#if item.rationale}
												<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
													{item.rationale}
												</p>
											{/if}
											<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
												<Button
													variant="tonal"
													disabled={busyItemId !== null}
													click={() => togglePinned(item)}
												>
													{busyItemId === item.id
														? '…'
														: item.pinned
															? 'Unpin'
															: 'Pin'}
												</Button>
												<Button
													variant="text"
													disabled={busyItemId !== null}
													click={() => startEdit(item)}
												>
													Edit
												</Button>
												<Button
													variant="text"
													disabled={busyItemId !== null}
													click={() => dismissItem(item)}
												>
													Dismiss
												</Button>
											</div>
										{/if}
									</li>
								{/each}
							</ul>
						{/if}
					</div>

					{#if showingAddItem}
						<div
							id="add-long-term-item"
							class="border-outline/15 bg-surface-container-high flex max-h-[70%] shrink-0 flex-col gap-3 overflow-y-auto border-t px-5 py-4"
						>
							<p class="text-on-surface text-sm font-medium">Add item</p>
							<label class="flex flex-col gap-1.5" for="new-title">
								<span class="text-on-surface text-sm font-medium">Title</span>
								<input
									id="new-title"
									class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
									type="text"
									placeholder="Required"
									bind:value={newTitle}
									disabled={addingItem}
								/>
							</label>
							<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<label class="flex flex-col gap-1.5" for="new-type">
									<span class="text-on-surface text-sm font-medium">Type</span>
									<select
										id="new-type"
										class="bg-surface text-on-surface ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
										bind:value={newType}
										disabled={addingItem}
									>
										<option value="goal">goal</option>
										<option value="watch">watch</option>
										<option value="todo">todo</option>
									</select>
								</label>
								<label class="flex flex-col gap-1.5" for="new-size">
									<span class="text-on-surface text-sm font-medium">Size</span>
									<select
										id="new-size"
										class="bg-surface text-on-surface ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
										bind:value={newSize}
										disabled={addingItem}
									>
										<option value="small">small</option>
										<option value="medium">medium</option>
										<option value="large">large</option>
									</select>
								</label>
							</div>
							<label class="flex flex-col gap-1.5" for="new-check">
								<span class="text-on-surface text-sm font-medium">Check after</span>
								<input
									id="new-check"
									class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
									type="text"
									placeholder="YYYY-MM-DD or note"
									bind:value={newCheckAfter}
									disabled={addingItem}
								/>
							</label>
							<label class="flex flex-col gap-1.5" for="new-rationale">
								<span class="text-on-surface text-sm font-medium">Rationale</span>
								<textarea
									id="new-rationale"
									class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary min-h-18 resize-y rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
									placeholder="Optional context"
									bind:value={newRationale}
									disabled={addingItem}
								></textarea>
							</label>
							<label
								class={[
									'text-on-surface flex items-center gap-3 text-sm',
									addingItem ? 'opacity-60' : 'cursor-pointer'
								]}
							>
								<Checkbox>
									<input type="checkbox" bind:checked={newPinned} disabled={addingItem} />
								</Checkbox>
								Pin as focus
							</label>
							<div class="flex justify-end gap-2">
								<Button
									variant="text"
									disabled={addingItem}
									click={() => {
										showingAddItem = false;
									}}
								>
									Cancel
								</Button>
								<Button
									variant="filled"
									disabled={addingItem || !newTitle.trim()}
									click={() => addItem()}
								>
									{addingItem ? 'Adding…' : 'Add'}
								</Button>
							</div>
							{#if focusMessage}
								<p class="text-on-surface-variant text-sm leading-relaxed">{focusMessage}</p>
							{/if}
						</div>
					{:else if focusMessage}
						<p
							class="text-on-surface-variant border-outline/15 border-t px-5 py-3 text-sm leading-relaxed"
						>
							{focusMessage}
						</p>
					{/if}
				</section>

				<section
					class="bg-surface-container-high order-3 overflow-hidden rounded-2xl lg:col-start-1"
					aria-label="Hard constraints"
				>
					<div class="border-outline/20 border-b px-4 py-3">
						<h2 class="text-on-surface text-sm font-semibold tracking-tight">Hard constraints</h2>
						<p class="text-on-surface-variant mt-0.5 text-xs leading-relaxed">
							Tickers and limits the agent must not violate.
						</p>
					</div>
					<div class="flex flex-col gap-3 px-4 py-3.5">
						<label class="flex flex-col gap-1.5" for="never-trade">
							<span class="text-on-surface text-sm font-medium">Never-trade tickers</span>
							<input
								id="never-trade"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
								type="text"
								autocomplete="off"
								spellcheck="false"
								placeholder="AAPL, MSFT"
								bind:value={neverTradeText}
								disabled={savingConstraints}
							/>
						</label>
						<label class="flex flex-col gap-1.5" for="do-not-sell">
							<span class="text-on-surface text-sm font-medium">Do-not-sell tickers</span>
							<input
								id="do-not-sell"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
								type="text"
								autocomplete="off"
								spellcheck="false"
								placeholder="BRK.B, VOO"
								bind:value={doNotSellText}
								disabled={savingConstraints}
							/>
						</label>
						<label class="flex flex-col gap-1.5" for="max-position">
							<span class="text-on-surface text-sm font-medium">Max position %</span>
							<input
								id="max-position"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
								type="text"
								inputmode="decimal"
								placeholder="Optional"
								bind:value={maxPositionPctText}
								disabled={savingConstraints}
							/>
						</label>
						<label class="flex flex-col gap-1.5" for="constraints-notes">
							<span class="text-on-surface text-sm font-medium">Notes</span>
							<textarea
								id="constraints-notes"
								class="bg-surface text-on-surface placeholder:text-on-surface-variant ring-outline/50 focus:ring-primary min-h-18 resize-y rounded-lg px-3 py-2 text-sm outline-none ring-1 focus:ring-2"
								placeholder="Short standing constraints…"
								bind:value={constraintsNotes}
								disabled={savingConstraints}
							></textarea>
						</label>
						<div class="flex flex-wrap items-center justify-end gap-3 pt-1">
							<Button
								variant="filled"
								disabled={savingConstraints}
								click={() => saveConstraints()}
							>
								{savingConstraints ? 'Saving…' : 'Save'}
							</Button>
						</div>
						{#if constraintsMessage}
							<p class="text-on-surface-variant text-sm leading-relaxed">{constraintsMessage}</p>
						{/if}
					</div>
				</section>
			</div>
		{/if}
	</div>
</main>

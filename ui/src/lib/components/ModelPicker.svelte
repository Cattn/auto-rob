<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Button, Chip, Menu, MenuItem, TextField } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { HarnessId, HarnessModel, HarnessSelection } from '../../../shared/ipc';

	let { id, label }: { id: HarnessId; label: string } = $props();
	let models = $state<HarnessModel[]>([]);
	let saved = $state<HarnessSelection>({ model: '', reasoningEffort: '', contextWindow: null });
	let draft = $state<HarnessSelection>({ model: '', reasoningEffort: '', contextWindow: null });
	let context = $state('');
	let search = $state('');
	let open = $state(false);
	let loading = $state(true);
	let saving = $state(false);
	let error = $state<string | null>(null);
	let message = $state('');
	let container: HTMLDivElement;
	const selected = $derived(models.find((model) => model.id === draft.model));
	const filtered = $derived(models.filter((model) => `${model.label} ${model.id} ${model.description}`.toLowerCase().includes(search.toLowerCase())));
	const dirty = $derived(draft.model !== saved.model || draft.reasoningEffort !== saved.reasoningEffort || (context ? Number(context) : null) !== saved.contextWindow);
	const invalidContext = $derived(context !== '' && (!Number.isSafeInteger(Number(context)) || Number(context) <= 0 || !selected?.maxContextWindow || Number(context) > selected.maxContextWindow));

	async function load() {
		const api = getBackend();
		if (!api) { loading = false; return; }
		loading = true;
		error = null;
		try {
			const [catalog, selection] = await Promise.all([api.getModelCatalog(id), api.getHarnessSelection(id)]);
			models = catalog.models;
			error = catalog.error;
			saved = selection;
			draft = { ...selection };
			context = selection.contextWindow?.toString() ?? '';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally { loading = false; }
	}

	function choose(model: string) {
		if (draft.model !== model) {
			draft = { model, reasoningEffort: '', contextWindow: null };
			context = '';
		}
		search = '';
		open = false;
		message = '';
	}

	async function toggle() {
		open = !open;
		if (open) {
			await tick();
			container.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
		}
	}

	async function save() {
		const api = getBackend();
		if (!api || saving || invalidContext) return;
		saving = true;
		message = '';
		try {
			saved = await api.setHarnessSelection(id, { ...draft, contextWindow: context ? Number(context) : null });
			draft = { ...saved };
			message = 'Saved for the next run.';
		} catch (err) {
			message = err instanceof Error ? err.message : String(err);
		} finally { saving = false; }
	}

	onMount(() => { void load(); });
</script>

<svelte:window onclick={(event) => { if (open && !container.contains(event.target as Node)) open = false; }} onkeydown={(event) => { if (event.key === 'Escape') open = false; }} />

<div class="px-4 py-4" bind:this={container}>
	<div class="mb-3 flex items-center justify-between gap-3">
		<h3 class="text-on-surface text-sm font-medium">{label}</h3>
		<Button variant="text" disabled={loading || saving} click={load}>Refresh models</Button>
	</div>
	<div class="relative">
		<Button variant="tonal" disabled={loading || saving} click={toggle} aria-expanded={open} aria-label={`Choose ${label} model`}>
			{loading ? 'Loading models…' : draft.model ? (selected?.label ?? draft.model) : 'Harness default'} ▾
		</Button>
		{#if open}
			<div class="model-menu bg-surface-container absolute top-full right-0 left-0 z-20 mt-2 rounded-xl p-2 shadow-lg">
				<TextField label="Search models" type="search" bind:value={search} aria-label={`Search ${label} models`} />
				<div class="mt-2 max-h-72 overflow-y-auto" aria-label={`${label} models`}>
					<Menu>
						{#if !search}<MenuItem click={() => choose('')}>Harness default</MenuItem>{/if}
						{#each filtered as model (model.id)}
							<MenuItem click={() => choose(model.id)}>
								<span class="min-w-0 text-left">
									<span class="block truncate">{model.label}{model.isDefault ? ' · default' : ''}</span>
									<span class="text-on-surface-variant block truncate text-xs">{model.id}</span>
								</span>
							</MenuItem>
						{/each}
					</Menu>
					{#if filtered.length === 0}<p class="text-on-surface-variant px-3 py-2 text-sm">No matching models.</p>{/if}
				</div>
			</div>
		{/if}
	</div>
	{#if draft.model}<p class="text-on-surface-variant mt-2 break-all text-xs">{draft.model}</p>{/if}
	{#if selected?.description}<p class="text-on-surface-variant mt-2 text-sm">{selected.description}</p>{/if}
	{#if selected?.reasoningEfforts.length}
		<p class="text-on-surface-variant mt-4 mb-2 text-xs font-medium">Thinking level</p>
		<div class="flex flex-wrap gap-2" role="group" aria-label={`${label} thinking level`}>
			<Chip variant="general" selected={!draft.reasoningEffort} aria-pressed={!draft.reasoningEffort} disabled={saving} click={() => draft.reasoningEffort = ''}>Default{selected.defaultReasoningEffort ? ` (${selected.defaultReasoningEffort})` : ''}</Chip>
			{#each selected.reasoningEfforts as effort}
				<Chip variant="general" selected={draft.reasoningEffort === effort.value} aria-pressed={draft.reasoningEffort === effort.value} title={effort.description} disabled={saving} click={() => draft.reasoningEffort = effort.value}>{effort.value}</Chip>
			{/each}
		</div>
	{/if}
	{#if selected?.maxContextWindow}
		<div class="mt-4">
			<TextField label="Context tokens" type="number" min="1" max={selected.maxContextWindow} step="1" bind:value={context} error={invalidContext} disabled={saving} aria-label={`${label} context tokens`} />
			<p class="text-on-surface-variant mt-1 text-xs">Leave blank for default{selected.contextWindow ? ` (${selected.contextWindow.toLocaleString()})` : ''} · maximum {selected.maxContextWindow.toLocaleString()} tokens</p>
			{#if invalidContext}<p class="text-error mt-1 text-xs">Enter a whole number from 1 to {selected.maxContextWindow.toLocaleString()}.</p>{/if}
		</div>
	{/if}
	{#if id === 'cursor'}<p class="text-on-surface-variant mt-3 text-xs">Thinking and context options are included in the listed model variants.</p>{/if}
	{#if error}<p class="text-error mt-3 text-sm" role="alert">{error}</p>{/if}
	<div class="mt-3 flex flex-wrap items-center gap-3">
		<Button variant="tonal" disabled={loading || saving || !dirty || invalidContext} click={save}>{saving ? 'Saving…' : 'Save model settings'}</Button>
		{#if message}<p class="text-on-surface-variant text-sm" role="status">{message}</p>{/if}
	</div>
</div>

<style>
	.model-menu :global(.m3-container) { width: 100%; max-width: none; min-width: 0; }
	.model-menu :global(.item) { min-height: 3.5rem; }
</style>

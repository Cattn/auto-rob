<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from 'm3-svelte';
	import { getBackend } from '$lib/backend';
	import type { SavedNoteMeta } from '$lib/backend';

	let content = $state('');
	let savedContent = $state('');
	let notes = $state<SavedNoteMeta[]>([]);
	let activeId = $state<string | null>(null);
	let loadError = $state<string | null>(null);
	let statusMessage = $state<string | null>(null);
	let saving = $state(false);
	let creating = $state(false);
	let activatingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);

	const dirty = $derived(content !== savedContent);

	function applyState(state: {
		content: string;
		activeId: string | null;
		notes: SavedNoteMeta[];
	}) {
		content = state.content;
		savedContent = state.content;
		activeId = state.activeId;
		notes = state.notes;
	}

	function formatUpdated(iso: string): string {
		try {
			return new Intl.DateTimeFormat(undefined, {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit'
			}).format(new Date(iso));
		} catch {
			return iso;
		}
	}

	async function refresh() {
		const api = getBackend();
		if (!api) return;
		applyState(await api.getNotes());
	}

	async function save() {
		const api = getBackend();
		if (!api || saving || !dirty) return;
		saving = true;
		statusMessage = null;
		try {
			applyState(await api.saveActiveNote(content));
			statusMessage = 'Saved to notes.md';
		} catch (err) {
			statusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	async function saveToLibrary() {
		const api = getBackend();
		if (!api || creating) return;
		creating = true;
		statusMessage = null;
		try {
			if (dirty) {
				applyState(await api.saveActiveNote(content));
			}
			applyState(await api.createSavedNote({ content }));
			statusMessage = 'Copied into saved notes';
		} catch (err) {
			statusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			creating = false;
		}
	}

	async function activate(id: string) {
		const api = getBackend();
		if (!api || activatingId || id === activeId) return;
		if (dirty) {
			const ok = confirm('Discard unsaved changes and apply this note to notes.md?');
			if (!ok) return;
		}
		activatingId = id;
		statusMessage = null;
		try {
			applyState(await api.setActiveNote(id));
			statusMessage = 'Active note applied to notes.md';
		} catch (err) {
			statusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			activatingId = null;
		}
	}

	async function remove(id: string) {
		const api = getBackend();
		if (!api || deletingId) return;
		const note = notes.find((n) => n.id === id);
		const ok = confirm(`Delete "${note?.title ?? 'this note'}"? This cannot be undone.`);
		if (!ok) return;
		deletingId = id;
		statusMessage = null;
		try {
			applyState(await api.deleteSavedNote(id));
			statusMessage = 'Saved note deleted';
		} catch (err) {
			statusMessage = err instanceof Error ? err.message : String(err);
		} finally {
			deletingId = null;
		}
	}

	function onEditorKeydown(e: KeyboardEvent) {
		if ((e.ctrlKey || e.metaKey) && e.key === 's') {
			e.preventDefault();
			void save();
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

<title>Notes · auto-rob</title>

<main class="bg-background text-on-background min-h-dvh px-6 pt-12 pb-28">
	<div class="mx-auto flex w-full max-w-6xl flex-col gap-6 lg:flex-row lg:items-stretch">
		<section class="flex min-w-0 flex-1 flex-col">
			<header class="mb-4">
				<p class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
					Notes
				</p>
				<h1 class="text-on-surface mt-1 text-3xl font-bold tracking-tight">Session notes</h1>
				<p class="text-on-surface-variant mt-2 max-w-xl text-sm leading-relaxed">
					Edit <code class="text-on-surface">notes.md</code> - this is additional context you can give the agent for the next run. Saved copies on the right stay private.
				</p>
			</header>

			{#if loadError}
				<p class="text-error text-sm">{loadError}</p>
			{:else}
				<div
					class="bg-surface-container-high ring-outline/50 flex min-h-[28rem] flex-1 flex-col overflow-hidden rounded-xl ring-1"
				>
					<div
						class="border-outline/30 flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"
					>
						<div class="flex min-w-0 flex-wrap items-center gap-2">
							<span
								class={[
									'rounded-md px-2.5 py-1 text-xs font-medium',
									dirty
										? 'bg-error-container text-on-error-container'
										: 'bg-primary/15 text-primary'
								]}
							>
								{dirty ? 'unsaved' : 'saved'}
							</span>
							{#if activeId}
								{@const active = notes.find((n) => n.id === activeId)}
								<span
									class="bg-surface-container-highest text-on-surface-variant rounded-md px-2.5 py-1 text-xs font-medium"
								>
									active: {active?.title ?? 'library note'}
								</span>
							{:else}
								<span
									class="bg-surface-container-highest text-on-surface-variant rounded-md px-2.5 py-1 text-xs font-medium"
								>
									notes.md
								</span>
							{/if}
						</div>
						<div class="flex flex-wrap items-center gap-2">
							<Button
								variant="tonal"
								disabled={creating || saving}
								click={() => saveToLibrary()}
							>
								{creating ? 'Saving…' : 'Save to library'}
							</Button>
							<Button variant="filled" disabled={saving || !dirty} click={() => save()}>
								{saving ? 'Saving…' : 'Save'}
							</Button>
						</div>
					</div>

					<label class="sr-only" for="notes-editor">Active notes editor</label>
					<textarea
						id="notes-editor"
						class="bg-surface text-on-surface placeholder:text-on-surface-variant min-h-[22rem] flex-1 resize-none px-4 py-4 font-mono text-sm leading-relaxed outline-none"
						placeholder="Standing guidance for the next run…"
						spellcheck="true"
						bind:value={content}
						onkeydown={onEditorKeydown}
					></textarea>

					{#if statusMessage}
						<p class="text-on-surface-variant border-outline/30 border-t px-4 py-2.5 text-sm">
							{statusMessage}
						</p>
					{/if}
				</div>
			{/if}
		</section>

		<aside class="w-full shrink-0 lg:w-72 xl:w-80">
			<div class="mb-3 flex items-end justify-between gap-3">
				<div>
					<h2 class="text-on-surface-variant text-xs font-semibold tracking-[0.14em] uppercase">
						Saved notes
					</h2>
					<p class="text-on-surface-variant mt-1 text-sm leading-relaxed">
						Private library - notes are not visible to the model until they are activated.
					</p>
				</div>
			</div>

			{#if loadError}
				<div class="bg-surface-container-high ring-outline/50 rounded-xl p-4 ring-1">
					<p class="text-on-surface-variant text-sm">Unavailable offline.</p>
				</div>
			{:else if notes.length === 0}
				<div class="bg-surface-container-high ring-outline/50 rounded-xl p-4 ring-1">
					<p class="text-on-surface-variant text-sm leading-relaxed">
						No saved notes yet. Use <span class="text-on-surface">Save to library</span> to keep
						a copy for later.
					</p>
				</div>
			{:else}
				<ul
					class="bg-surface-container-high ring-outline/50 divide-outline/30 divide-y overflow-hidden rounded-xl ring-1"
					aria-label="Saved notes"
				>
					{#each notes as note (note.id)}
						<li class="px-3 py-3">
							<p class="text-on-surface truncate text-sm font-medium">{note.title}</p>

							<div class="mt-1 flex items-center justify-between gap-2">
								<p class="text-on-surface-variant text-xs">
									{formatUpdated(note.updatedAt)}
								</p>
								{#if activeId === note.id}
									<span class="bg-primary/15 text-primary rounded-md px-2 py-0.5 text-xs font-medium">
										active
									</span>
								{/if}
							</div>

							<div class="mt-2.5 flex flex-wrap items-center gap-1.5">
								<Button
									variant={activeId === note.id ? 'tonal' : 'filled'}
									disabled={activatingId !== null || activeId === note.id}
									click={() => activate(note.id)}
								>
									{activatingId === note.id
										? 'Applying…'
										: activeId === note.id
											? 'Active'
											: 'Set active'}
								</Button>
								<Button
									variant="text"
									disabled={deletingId !== null}
									click={() => remove(note.id)}
								>
									{deletingId === note.id ? '…' : 'Delete'}
								</Button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</aside>
	</div>
</main>

<style>
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border-width: 0;
	}
</style>

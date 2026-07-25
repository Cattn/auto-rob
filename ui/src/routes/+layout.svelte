<script lang="ts">
	import '../app.css';
	import '../main.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SideBar from '$lib/components/SideBar.svelte';
	import BottomBar from '$lib/components/BottomBar.svelte';
	import { getBackend } from '$lib/backend';
	import { anyRunReady } from '$lib/components/HarnessConnectPanel.svelte';
	import { ensureRunLogSubscription } from '$lib/run-log.svelte';

	let { children } = $props();

	const ALLOWED_ALWAYS = ['/settings', '/onboarding/setup'];
	const ALLOWED_PREFS = ['/settings', '/onboarding', '/onboarding/setup'];

	function normalizedPath(pathname: string): string {
		return pathname.replace(/\/$/, '') || '/';
	}

	onMount(() => ensureRunLogSubscription(getBackend()));

	$effect(() => {
		const path = normalizedPath(page.url.pathname);

		const api = getBackend();
		if (!api) return;

		let cancelled = false;
		void Promise.all([api.getHealth(), api.getOnboarding()])
			.then(([health, onboarding]) => {
				if (cancelled) return;
				const harnessReady = anyRunReady(health.harnesses);

				if (!harnessReady) {
					if (!ALLOWED_ALWAYS.includes(path)) {
						void goto(resolve('/onboarding/setup'));
					}
					return;
				}

				if (!onboarding.completedAt) {
					if (!ALLOWED_PREFS.includes(path)) {
						void goto(resolve('/onboarding'));
					}
					return;
				}
			})
			.catch(() => {});

		return () => {
			cancelled = true;
		};
	});
</script>

<SideBar />
<BottomBar />
<div class="fixed inset-0 left-0 overflow-x-hidden overflow-y-auto md:left-23">
	<div>
		{@render children()}
	</div>
</div>

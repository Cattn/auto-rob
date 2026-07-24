<script lang="ts">
	import '../app.css';
	import '../main.css';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import SideBar from '$lib/components/SideBar.svelte';
	import BottomBar from '$lib/components/BottomBar.svelte';
	import { getBackend } from '$lib/backend';

	let { children } = $props();

	function normalizedPath(pathname: string): string {
		return pathname.replace(/\/$/, '') || '/';
	}

	$effect(() => {
		const path = normalizedPath(page.url.pathname);
		if (path === '/onboarding' || path === '/settings') return;

		const api = getBackend();
		if (!api) return;

		let cancelled = false;
		void api
			.getOnboarding()
			.then((state) => {
				if (cancelled || state.completedAt) return;
				void goto(resolve('/onboarding'));
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

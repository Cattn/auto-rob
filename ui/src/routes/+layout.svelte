<script lang="ts">
	import '../app.css';
	import '../main.css';
	import SideBar from '$lib/components/SideBar.svelte';
	import BottomBar from '$lib/components/BottomBar.svelte';

	let { children } = $props();
</script>

<SideBar />
<BottomBar />
<div class="fixed inset-0 left-0 overflow-x-hidden overflow-y-auto md:left-23">
	<div>
		{@render children()}
	</div>
</div>

<script lang="ts">
	import Sidebar from './Sidebar.svelte';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<div class="flex h-screen bg-bg-primary">
	<Sidebar />
	<main class="flex-1 overflow-auto p-6">
		{@render children()}
	</main>
</div>

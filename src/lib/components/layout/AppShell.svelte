<script lang="ts">
	import Sidebar from './Sidebar.svelte';
	import type { Snippet } from 'svelte';

	let { children, username = null, authenticated = false }: { children: Snippet; username?: string | null; authenticated?: boolean } = $props();
</script>

<div class="flex h-screen bg-bg-primary">
	<Sidebar {username} {authenticated} />
	<main class="flex-1 overflow-auto p-6">
		{@render children()}
	</main>
</div>

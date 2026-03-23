<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';
	import { page } from '$app/stores';

	let { data, children } = $props();

	const standaloneRoutes = ['/setup', '/login'];
	let isStandalone = $derived(standaloneRoutes.some((r) => $page.url.pathname.startsWith(r)));
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

{#if isStandalone}
	{@render children()}
{:else}
	<AppShell>
		{#if !data.configured.proxmox}
			<Banner
				message="Proxmox ist nicht konfiguriert."
				linkText="Zu den Einstellungen"
				linkHref="/settings"
			/>
		{/if}
		{@render children()}
	</AppShell>
{/if}

<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import AppShell from '$lib/components/layout/AppShell.svelte';
	import Banner from '$lib/components/ui/Banner.svelte';

	let { data, children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<AppShell username={data.username} authenticated={data.authenticated}>
	{#if !data.configured.proxmox}
		<Banner
			message="Proxmox ist nicht konfiguriert."
			linkText="Zu den Einstellungen"
			linkHref="/settings"
		/>
	{/if}
	{@render children()}
</AppShell>

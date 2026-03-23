<script lang="ts">
	import ProxmoxTab from '$lib/components/settings/ProxmoxTab.svelte';
	import UnifiTab from '$lib/components/settings/UnifiTab.svelte';
	import CredentialsTab from '$lib/components/settings/CredentialsTab.svelte';

	let { data } = $props();

	const tabs = ['Proxmox', 'UniFi', 'Credentials'] as const;
	let activeTab = $state<(typeof tabs)[number]>('Proxmox');
</script>

<h1 class="text-2xl font-bold text-text-primary mb-6">Settings</h1>

<div class="border-b border-border mb-6">
	<div class="flex gap-0" role="tablist">
		{#each tabs as tab}
			<button
				role="tab"
				aria-selected={activeTab === tab}
				class="px-4 py-2 text-sm font-medium transition-colors border-b-2
					{activeTab === tab
					? 'border-accent text-text-primary'
					: 'border-transparent text-text-secondary hover:text-text-primary'}"
				onclick={() => (activeTab = tab)}
			>
				{tab}
			</button>
		{/each}
	</div>
</div>

<div>
	{#if activeTab === 'Proxmox'}
		<ProxmoxTab initialValues={data.proxmox} />
	{:else if activeTab === 'UniFi'}
		<UnifiTab initialValues={data.unifi} />
	{:else if activeTab === 'Credentials'}
		<CredentialsTab />
	{/if}
</div>

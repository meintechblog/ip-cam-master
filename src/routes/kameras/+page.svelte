<script lang="ts">
	import ContainerGrid from '$lib/components/containers/ContainerGrid.svelte';
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';

	let { data } = $props();
</script>

<div class="flex items-center justify-between mb-4">
	<h1 class="text-2xl font-bold text-text-primary">Kameras</h1>
	{#if data.proxmoxConfigured}
		<a href="/kameras/onboarding" class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 transition-colors">
			+ Kamera hinzufuegen
		</a>
	{:else}
		<span class="inline-flex items-center gap-2 px-4 py-2 bg-bg-input text-text-secondary rounded-lg cursor-not-allowed" title="Proxmox muss zuerst in den Einstellungen konfiguriert werden">
			+ Kamera hinzufuegen
		</span>
	{/if}
</div>


{#if data.error}
	<div class="mb-4">
		<InlineAlert type="error" message={data.error} />
	</div>
{/if}

<ContainerGrid containers={data.containers} />

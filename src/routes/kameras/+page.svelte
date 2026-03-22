<script lang="ts">
	import ContainerGrid from '$lib/components/containers/ContainerGrid.svelte';
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';

	let { data } = $props();
</script>

<h1 class="text-2xl font-bold text-text-primary mb-4">Kameras</h1>

{#if data.error}
	<div class="mb-4">
		<InlineAlert type="error" message={data.error} />
	</div>
{/if}

<ContainerGrid containers={data.containers} />

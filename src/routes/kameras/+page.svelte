<script lang="ts">
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import CameraDetailCard from '$lib/components/cameras/CameraDetailCard.svelte';
	import type { CameraCardData } from '$lib/types';
	import { Loader2 } from 'lucide-svelte';

	let { data } = $props();
	let cameras = $state<CameraCardData[]>([]);
	let loading = $state(true);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchCameras() {
		try {
			const res = await fetch('/api/cameras/status');
			if (res.ok) {
				cameras = await res.json();
			}
		} catch {
			// silently retry next poll
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		fetchCameras();
		pollTimer = setInterval(fetchCameras, 10000);
		return () => {
			if (pollTimer) clearInterval(pollTimer);
		};
	});
</script>

<div class="flex items-center justify-between mb-6">
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

{#if loading}
	<div class="flex items-center gap-3 text-text-secondary py-8">
		<Loader2 class="w-5 h-5 animate-spin" />
		<span>Kamerastatus wird geladen...</span>
	</div>
{:else if cameras.length === 0}
	<div class="text-text-secondary text-center py-12">
		<p class="text-lg mb-2">Keine Kameras eingerichtet</p>
		<p class="text-sm">Klicke "+ Kamera hinzufuegen" um loszulegen</p>
	</div>
{:else}
	<div class="space-y-4">
		{#each cameras as camera (camera.id)}
			<CameraDetailCard {camera} />
		{/each}
	</div>
{/if}

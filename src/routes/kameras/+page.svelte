<script lang="ts">
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import CameraDetailCard from '$lib/components/cameras/CameraDetailCard.svelte';
	import ExternalCamCard from '$lib/components/cameras/ExternalCamCard.svelte';
	import type { CameraCardData } from '$lib/types';
	import { Loader2 } from 'lucide-svelte';

	let { data } = $props();
	let cameras = $state<CameraCardData[]>([]);
	let loading = $state(true);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	// v1.3 Phase 22 Plan 03 Task 1 — partition into managed (always) + external
	// (only when data.hubEnabled). Per UI-SPEC §kameras-partition + CONTEXT.md
	// decisions: insertion-order preserved within each section, no search bar,
	// external section completely omitted when hub is disabled.
	let managedCams = $derived(cameras.filter((c) => c.source !== 'external'));
	let externalCams = $derived(cameras.filter((c) => c.source === 'external'));

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
			+ Kamera hinzufügen
		</a>
	{:else}
		<span class="inline-flex items-center gap-2 px-4 py-2 bg-bg-input text-text-secondary rounded-lg cursor-not-allowed" title="Proxmox muss zuerst in den Einstellungen konfiguriert werden">
			+ Kamera hinzufügen
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
		<p class="text-sm">Klicke "+ Kamera hinzufügen" um loszulegen</p>
	</div>
{:else}
	<div class="space-y-12">
		<section>
			<h2 class="text-base font-semibold text-text-primary mb-4">
				Eigene Kameras ({managedCams.length})
			</h2>
			<div class="space-y-4">
				{#each managedCams as camera (camera.id)}
					<CameraDetailCard {camera} />
				{/each}
			</div>
		</section>

		{#if data.hubEnabled}
			<section>
				<h2 class="text-base font-semibold text-text-primary mb-4">
					Aus UniFi Protect ({externalCams.length})
				</h2>
				<div class="space-y-4">
					{#each externalCams as camera (camera.id)}
						<ExternalCamCard {camera} bridgeIp={data.bridgeIp} />
					{:else}
						<p class="text-sm text-text-secondary">Noch keine Protect-Kameras erkannt.</p>
					{/each}
				</div>
			</section>
		{/if}
	</div>
{/if}

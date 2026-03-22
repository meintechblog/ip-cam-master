<script lang="ts">
	import OnboardingWizard from '$lib/components/onboarding/OnboardingWizard.svelte';
	import { Loader2, Wifi } from 'lucide-svelte';

	let { data } = $props();

	// Selected camera for wizard (null = manual entry)
	let selectedIp = $state<string | null>(null);

	// Discovery state
	let discovered = $state<{ ip: string; type: string; alreadyOnboarded: boolean }[]>([]);
	let scanning = $state(true);

	async function runDiscovery() {
		scanning = true;
		try {
			const res = await fetch('/api/discovery?start=1&end=50');
			if (res.ok) {
				const data = await res.json();
				discovered = data.cameras.filter((c: any) => !c.alreadyOnboarded);
			}
		} catch { /* ignore */ }
		finally { scanning = false; }
	}

	$effect(() => {
		runDiscovery();
	});

	function selectCamera(ip: string) {
		selectedIp = ip;
	}
</script>

<h1 class="text-2xl font-bold text-text-primary mb-6">Kamera einrichten</h1>

{#if selectedIp}
	<!-- Wizard with pre-filled IP -->
	<button onclick={() => selectedIp = null} class="text-accent hover:text-accent/80 text-sm mb-4 cursor-pointer">
		&larr; Zurueck zur Auswahl
	</button>
	<OnboardingWizard nextVmid={data.nextVmid} prefillIp={selectedIp} />
{:else}
	<!-- Manual entry -->
	<div class="mb-6">
		<OnboardingWizard nextVmid={data.nextVmid} />
	</div>

	<!-- Auto-Discovery -->
	<div class="border-t border-border pt-6">
		<div class="flex items-center gap-2 mb-4">
			<Wifi class="w-5 h-5 text-accent" />
			<h2 class="text-lg font-bold text-text-primary">Gefundene Kameras im Netzwerk</h2>
			{#if scanning}
				<Loader2 class="w-4 h-4 animate-spin text-text-secondary" />
				<span class="text-xs text-text-secondary">Scanne...</span>
			{:else}
				<span class="text-xs text-text-secondary">({discovered.length} neue gefunden)</span>
				<button onclick={runDiscovery} class="text-xs text-accent hover:text-accent/80 cursor-pointer ml-2">Erneut scannen</button>
			{/if}
		</div>

		{#if !scanning && discovered.length === 0}
			<p class="text-text-secondary text-sm">Keine neuen Kameras im Netzwerk gefunden.</p>
		{:else}
			<div class="space-y-3">
				{#each discovered as cam (cam.ip)}
					<div class="bg-bg-card border border-border rounded-lg p-4 flex items-center justify-between">
						<div>
							<div class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full bg-green-400"></span>
								<span class="text-text-primary font-mono font-medium">{cam.ip}</span>
								<span class="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent uppercase">{cam.type}</span>
							</div>
						</div>
						<button
							onclick={() => selectCamera(cam.ip)}
							class="bg-accent text-white rounded-lg px-4 py-2 hover:bg-accent/90 transition-colors text-sm cursor-pointer"
						>
							Einrichten
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

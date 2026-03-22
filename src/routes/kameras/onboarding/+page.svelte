<script lang="ts">
	import OnboardingWizard from '$lib/components/onboarding/OnboardingWizard.svelte';
	import { Loader2, Wifi, Check } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();

	let selectedIp = $state<string | null>(null);
	let discovered = $state<{ ip: string; type: string; alreadyOnboarded: boolean; name: string | null }[]>([]);
	let scanning = $state(true);

	// For ONVIF registration
	let registeringIp = $state<string | null>(null);
	let registerName = $state('');
	let registerUser = $state('');
	let registerPass = $state('');
	let registerError = $state<string | null>(null);
	let registerLoading = $state(false);

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

	$effect(() => { runDiscovery(); });

	let prefillName = $state('');

	async function selectCamera(ip: string, name?: string | null) {
		prefillName = name || '';
		// Try saved credentials first
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
					// Pre-fill credentials from matched preset
					prefillUser = data.username;
					prefillPass = data.password;
					prefillCredName = data.name;
				}
			}
		} catch { /* ignore */ }
		selectedIp = ip;
	}

	let prefillUser = $state('');
	let prefillPass = $state('');
	let prefillCredName = $state('');

	async function startRegister(ip: string, name?: string | null) {
		registeringIp = ip;
		registerName = name || '';
		registerUser = '';
		registerPass = '';
		registerError = null;
		// Try saved credentials
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
					registerUser = data.username;
					registerPass = data.password;
					// If we have name + credentials, register immediately
					if (registerName) {
						await submitRegister();
						return;
					}
				}
			}
		} catch { /* ignore */ }
	}

	async function submitRegister() {
		if (!registerName || !registerUser || !registerPass || !registeringIp) {
			registerError = 'Bitte alle Felder ausfuellen';
			return;
		}
		registerLoading = true;
		registerError = null;
		try {
			const res = await fetch('/api/cameras/register', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: registerName,
					ip: registeringIp,
					username: registerUser,
					password: registerPass,
					cameraType: 'mobotix-onvif'
				})
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error);
			goto('/kameras');
		} catch (err: any) {
			registerError = err.message || 'Registrierung fehlgeschlagen';
		} finally {
			registerLoading = false;
		}
	}
</script>

<h1 class="text-2xl font-bold text-text-primary mb-6">Kamera einrichten</h1>

{#if selectedIp}
	<button onclick={() => { selectedIp = null; prefillUser = ''; prefillPass = ''; prefillCredName = ''; }} class="text-accent hover:text-accent/80 text-sm mb-4 cursor-pointer">
		&larr; Zurueck zur Auswahl
	</button>
	{#if prefillCredName}
		<div class="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4 text-green-400 text-sm">
			Login "{prefillCredName}" automatisch erkannt und vorausgefuellt.
		</div>
	{/if}
	<OnboardingWizard nextVmid={data.nextVmid} prefillIp={selectedIp} prefillUsername={prefillUser} prefillPassword={prefillPass} prefillName={prefillName} />
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
					<div class="bg-bg-card border border-border rounded-lg p-4">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full bg-green-400"></span>
								{#if cam.name}
									<span class="text-text-primary font-medium">{cam.name}</span>
								{/if}
								<span class="text-text-primary font-mono {cam.name ? 'text-text-secondary text-xs' : 'font-medium'}">{cam.ip}</span>
								{#if cam.type === 'mobotix-onvif'}
									<span class="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-400">MOBOTIX ONVIF</span>
									<span class="text-xs text-text-secondary">Nativ — kein Container noetig</span>
								{:else if cam.type === 'mobotix'}
									<span class="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">MOBOTIX</span>
									<span class="text-xs text-text-secondary">Braucht Pipeline (go2rtc + ONVIF)</span>
								{:else}
									<span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 uppercase">{cam.type}</span>
								{/if}
							</div>
							{#if cam.type === 'mobotix-onvif'}
								<button
									onclick={() => startRegister(cam.ip, cam.name)}
									class="bg-green-600 text-white rounded-lg px-4 py-2 hover:bg-green-700 transition-colors text-sm cursor-pointer"
								>
									Registrieren
								</button>
							{:else}
								<button
									onclick={() => selectCamera(cam.ip, cam.name)}
									class="bg-accent text-white rounded-lg px-4 py-2 hover:bg-accent/90 transition-colors text-sm cursor-pointer"
								>
									Einrichten
								</button>
							{/if}
						</div>

						<!-- Inline register form for native ONVIF -->
						{#if registeringIp === cam.ip}
							<div class="mt-3 pt-3 border-t border-border space-y-3">
								{#if registerError}
									<div class="text-red-400 text-xs">{registerError}</div>
								{/if}
								<div class="grid grid-cols-3 gap-3">
									<input
										type="text"
										bind:value={registerName}
										placeholder="Kamera-Name"
										autocomplete="off"
										class="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
									/>
									<input
										type="text"
										bind:value={registerUser}
										placeholder="Benutzername"
										autocomplete="off"
										class="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
									/>
									<input
										type="password"
										bind:value={registerPass}
										placeholder="Passwort"
										autocomplete="off"
										class="bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
									/>
								</div>
								<div class="flex gap-2">
									<button
										onclick={submitRegister}
										disabled={registerLoading}
										class="bg-green-600 text-white rounded-lg px-4 py-2 hover:bg-green-700 transition-colors text-sm cursor-pointer disabled:opacity-50"
									>
										{#if registerLoading}
											<Loader2 class="w-4 h-4 animate-spin inline" />
										{:else}
											Speichern
										{/if}
									</button>
									<button
										onclick={() => registeringIp = null}
										class="bg-bg-input text-text-secondary rounded-lg px-4 py-2 hover:bg-bg-card text-sm cursor-pointer"
									>
										Abbrechen
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

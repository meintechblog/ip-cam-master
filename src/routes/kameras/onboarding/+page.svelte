<script lang="ts">
	import OnboardingWizard from '$lib/components/onboarding/OnboardingWizard.svelte';
	import { Loader2, Wifi, Check, PlayCircle, XCircle } from 'lucide-svelte';
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

	// Batch mode
	let batchMode = $state(false);
	let batchCancelled = $state(false);
	let batchCurrentIndex = $state(0);
	let batchResults = $state<{ ip: string; name: string; status: 'pending' | 'active' | 'done' | 'error' | 'skipped'; error?: string }[]>([]);
	let batchCurrentIp = $state<string | null>(null);

	// Pipeline cameras that need the wizard
	let pipelineCameras = $derived(discovered.filter(c => c.type === 'mobotix' || c.type === 'loxone'));
	let onvifCameras = $derived(discovered.filter(c => c.type === 'mobotix-onvif'));

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
	let selectedCameraType = $state('mobotix');

	async function selectCamera(ip: string, name?: string | null, type?: string) {
		prefillName = name || '';
		selectedCameraType = type || 'mobotix';
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip, cameraType: selectedCameraType })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
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
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip, cameraType: 'mobotix-onvif' })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) {
					registerUser = data.username;
					registerPass = data.password;
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

	// ── Batch: Add All ──────────────────────────────

	async function startBatch() {
		batchMode = true;
		batchCancelled = false;
		batchCurrentIndex = 0;

		// Build queue: ONVIF cameras first (instant), then pipeline cameras
		batchResults = [
			...onvifCameras.map(c => ({ ip: c.ip, name: c.name || c.ip, status: 'pending' as const })),
			...pipelineCameras.map(c => ({ ip: c.ip, name: c.name || c.ip, status: 'pending' as const }))
		];

		for (let i = 0; i < batchResults.length; i++) {
			if (batchCancelled) {
				// Mark remaining as skipped
				for (let j = i; j < batchResults.length; j++) {
					batchResults[j].status = 'skipped';
				}
				break;
			}

			batchCurrentIndex = i;
			batchResults[i].status = 'active';
			batchCurrentIp = batchResults[i].ip;
			const cam = discovered.find(c => c.ip === batchResults[i].ip);

			try {
				if (cam?.type === 'mobotix-onvif') {
					// Native ONVIF: just register
					await batchRegisterOnvif(cam);
				} else {
					// Pipeline: run full onboarding via API calls
					await batchOnboardPipeline(cam!);
				}
				batchResults[i].status = 'done';
			} catch (err: any) {
				batchResults[i].status = 'error';
				batchResults[i].error = err.message || 'Unbekannter Fehler';
			}
		}

		batchCurrentIp = null;
	}

	function cancelBatch() {
		batchCancelled = true;
	}

	async function batchRegisterOnvif(cam: { ip: string; name: string | null; type: string }) {
		// Try credentials
		let username = '';
		let password = '';
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip: cam.ip, cameraType: 'mobotix-onvif' })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) { username = data.username; password = data.password; }
			}
		} catch { /* ignore */ }

		if (!username || !password) throw new Error('Keine passenden Zugangsdaten gefunden');

		const res = await fetch('/api/cameras/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: cam.name || cam.ip, ip: cam.ip, username, password, cameraType: 'mobotix-onvif' })
		});
		const data = await res.json();
		if (!data.success) throw new Error(data.error || 'Registrierung fehlgeschlagen');
	}

	async function batchOnboardPipeline(cam: { ip: string; name: string | null; type: string }) {
		// Try credentials
		let username = '';
		let password = '';
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip: cam.ip, cameraType: cam.type })
			});
			if (res.ok) {
				const data = await res.json();
				if (data.success) { username = data.username; password = data.password; }
			}
		} catch { /* ignore */ }

		if (!username || !password) throw new Error('Keine passenden Zugangsdaten gefunden');

		// Get fresh nextVmid
		const vmidRes = await fetch('/api/proxmox/containers');
		const nextVmidRes = await fetch(`${window.location.origin}/kameras/onboarding`, { headers: { 'Accept': 'application/json' } });

		// Step 1: Test connection
		const testRes = await fetch('/api/onboarding/test-connection', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ip: cam.ip, username, password, cameraType: cam.type }),
			signal: AbortSignal.timeout(60000)
		});
		const testData = await testRes.json();
		if (!testData.success) throw new Error(testData.error || 'Verbindungstest fehlgeschlagen');

		// Save camera (get fresh VMID from server)
		const saveRes = await fetch('/api/onboarding/save-camera', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: cam.name || cam.ip,
				ip: cam.ip,
				username, password,
				width: testData.width || 1280,
				height: testData.height || 720,
				fps: testData.fps || 20,
				bitrate: testData.bitrate || 5000,
				vmid: testData.nextVmid || data.nextVmid + batchCurrentIndex,
				cameraType: cam.type
			}),
		});
		const saveData = await saveRes.json();
		if (!saveData.success) throw new Error(saveData.error || 'Kamera speichern fehlgeschlagen');
		const cameraId = saveData.cameraId;

		// Step 2: Create container
		const createRes = await fetch('/api/onboarding/create-container', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(120000)
		});
		const createData = await createRes.json();
		if (!createData.success) throw new Error(createData.error || 'Container fehlgeschlagen');

		// Step 3: Configure go2rtc
		const go2rtcRes = await fetch('/api/onboarding/configure-go2rtc', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(120000)
		});
		const go2rtcData = await go2rtcRes.json();
		if (!go2rtcData.success) throw new Error(go2rtcData.error || 'go2rtc fehlgeschlagen');

		// Step 3b: Configure nginx (Loxone only)
		if (cam.type === 'loxone') {
			const nginxRes = await fetch('/api/onboarding/configure-nginx', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId }),
				signal: AbortSignal.timeout(120000)
			});
			const nginxData = await nginxRes.json();
			if (!nginxData.success) throw new Error(nginxData.error || 'nginx fehlgeschlagen');
		}

		// Step 4: Configure ONVIF server
		const onvifRes = await fetch('/api/onboarding/configure-onvif', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(600000)
		});
		const onvifData = await onvifRes.json();
		if (!onvifData.success) throw new Error(onvifData.error || 'ONVIF fehlgeschlagen');

		// Step 5: Verify stream
		const verifyRes = await fetch('/api/onboarding/verify-stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(60000)
		});
		const verifyData = await verifyRes.json();
		if (!verifyData.success) throw new Error('Stream-Verifikation fehlgeschlagen');
	}
</script>

<h1 class="text-2xl font-bold text-text-primary mb-6">Kamera einrichten</h1>

{#if batchMode}
	<!-- Batch Mode UI -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<h2 class="text-lg font-bold text-text-primary">Alle Kameras hinzufuegen</h2>
			{#if batchCurrentIp}
				<button
					onclick={cancelBatch}
					class="flex items-center gap-2 px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm font-medium cursor-pointer"
				>
					<XCircle class="w-4 h-4" />
					Abbrechen
				</button>
			{:else}
				<button
					onclick={() => goto('/kameras')}
					class="px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 text-sm font-medium cursor-pointer"
				>
					Fertig — zu den Kameras
				</button>
			{/if}
		</div>

		<div class="space-y-2">
			{#each batchResults as result, i}
				<div class="bg-bg-card border border-border rounded-lg px-4 py-3 flex items-center gap-3">
					{#if result.status === 'done'}
						<Check class="w-5 h-5 text-green-400 shrink-0" />
					{:else if result.status === 'active'}
						<Loader2 class="w-5 h-5 text-accent animate-spin shrink-0" />
					{:else if result.status === 'error'}
						<XCircle class="w-5 h-5 text-red-400 shrink-0" />
					{:else if result.status === 'skipped'}
						<span class="w-5 h-5 text-text-secondary shrink-0 text-center">—</span>
					{:else}
						<span class="w-5 h-5 rounded-full border-2 border-border shrink-0"></span>
					{/if}

					<span class="text-text-primary text-sm font-medium flex-1">{result.name}</span>
					<span class="text-text-secondary text-xs font-mono">{result.ip}</span>

					{#if result.status === 'active'}
						<span class="text-xs text-accent">Wird eingerichtet...</span>
					{:else if result.status === 'error'}
						<span class="text-xs text-red-400">{result.error}</span>
					{:else if result.status === 'skipped'}
						<span class="text-xs text-text-secondary">Uebersprungen</span>
					{/if}
				</div>
			{/each}
		</div>

		{#if batchCancelled && !batchCurrentIp}
			<div class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
				Batch abgebrochen. Bereits eingerichtete Kameras bleiben bestehen.
			</div>
		{/if}
	</div>

{:else if selectedIp}
	<button onclick={() => { selectedIp = null; prefillUser = ''; prefillPass = ''; prefillCredName = ''; }} class="text-accent hover:text-accent/80 text-sm mb-4 cursor-pointer">
		&larr; Zurueck zur Auswahl
	</button>
	{#if prefillCredName}
		<div class="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4 text-green-400 text-sm">
			Login "{prefillCredName}" automatisch erkannt und vorausgefuellt.
		</div>
	{/if}
	<OnboardingWizard nextVmid={data.nextVmid} prefillIp={selectedIp} prefillUsername={prefillUser} prefillPassword={prefillPass} prefillName={prefillName} cameraType={selectedCameraType} />
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

		{#if !scanning && discovered.length > 0}
			<!-- Add All Button -->
			<div class="mb-4">
				<button
					onclick={startBatch}
					class="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg hover:bg-accent/90 text-sm font-medium cursor-pointer"
				>
					<PlayCircle class="w-4 h-4" />
					Alle hinzufuegen ({discovered.length})
				</button>
			</div>
		{/if}

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
									onclick={() => selectCamera(cam.ip, cam.name, cam.type)}
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

<script lang="ts">
	import OnboardingWizard from '$lib/components/onboarding/OnboardingWizard.svelte';
	import { Loader2, Wifi, Check, PlayCircle, XCircle } from 'lucide-svelte';
	import { goto } from '$app/navigation';
	import { tick } from 'svelte';

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
	interface BatchStep {
		label: string;
		status: 'pending' | 'active' | 'done' | 'error';
		detail?: string;
	}
	interface BatchCamera {
		ip: string;
		name: string;
		type: string;
		status: 'pending' | 'active' | 'done' | 'error' | 'skipped';
		error?: string;
		steps: BatchStep[];
		expanded: boolean;
	}
	let batchMode = $state(false);
	let batchCancelled = $state(false);
	let batchCurrentIndex = $state(0);
	let batchResults = $state<BatchCamera[]>([]);
	let batchCurrentIp = $state<string | null>(null);
	let batchDoneCount = $derived(batchResults.filter(r => r.status === 'done').length);
	let batchErrorCount = $derived(batchResults.filter(r => r.status === 'error').length);
	let batchRunning = $derived(batchResults.some(r => r.status === 'active'));

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

	function makePipelineSteps(type: string): BatchStep[] {
		const steps: BatchStep[] = [
			{ label: 'Zugangsdaten', status: 'pending' },
			{ label: 'Verbindungstest', status: 'pending' },
			{ label: 'Container erstellen', status: 'pending' },
			{ label: 'go2rtc', status: 'pending' },
		];
		if (type === 'loxone') steps.push({ label: 'nginx Proxy', status: 'pending' });
		steps.push({ label: 'ONVIF Server', status: 'pending' });
		steps.push({ label: 'Stream pruefen', status: 'pending' });
		return steps;
	}

	function makeOnvifSteps(): BatchStep[] {
		return [
			{ label: 'Zugangsdaten', status: 'pending' },
			{ label: 'Registrieren', status: 'pending' },
		];
	}

	function setStep(camIdx: number, stepIdx: number, status: BatchStep['status'], detail?: string) {
		batchResults[camIdx].steps[stepIdx].status = status;
		if (detail) batchResults[camIdx].steps[stepIdx].detail = detail;
	}

	async function startBatch() {
		batchMode = true;
		batchCancelled = false;
		batchCurrentIndex = 0;

		batchResults = [
			...onvifCameras.map(c => ({ ip: c.ip, name: c.name || c.ip, type: c.type, status: 'pending' as const, steps: makeOnvifSteps(), expanded: false })),
			...pipelineCameras.map(c => ({ ip: c.ip, name: c.name || c.ip, type: c.type, status: 'pending' as const, steps: makePipelineSteps(c.type), expanded: false }))
		];

		for (let i = 0; i < batchResults.length; i++) {
			if (batchCancelled) {
				for (let j = i; j < batchResults.length; j++) batchResults[j].status = 'skipped';
				break;
			}

			batchCurrentIndex = i;
			batchResults[i].status = 'active';
			batchResults[i].expanded = true;
			batchCurrentIp = batchResults[i].ip;
			await scrollToCamera(i);
			const cam = discovered.find(c => c.ip === batchResults[i].ip);

			try {
				if (cam?.type === 'mobotix-onvif') {
					await batchRegisterOnvif(i, cam);
				} else {
					await batchOnboardPipeline(i, cam!);
				}
				batchResults[i].status = 'done';
				batchResults[i].expanded = false;
			} catch (err: any) {
				batchResults[i].status = 'error';
				batchResults[i].error = err.message || 'Unbekannter Fehler';
				// Mark current step as error
				const activeStep = batchResults[i].steps.findIndex(s => s.status === 'active');
				if (activeStep >= 0) batchResults[i].steps[activeStep].status = 'error';
			}
		}

		batchCurrentIp = null;
	}

	function cancelBatch() {
		batchCancelled = true;
	}

	async function scrollToCamera(idx: number) {
		await tick();
		const el = document.getElementById(`batch-cam-${idx}`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	// Auto-scroll when step changes
	function setStepAndScroll(camIdx: number, stepIdx: number, status: BatchStep['status'], detail?: string) {
		setStep(camIdx, stepIdx, status, detail);
		if (status === 'active') scrollToCamera(camIdx);
	}

	async function batchRegisterOnvif(idx: number, cam: { ip: string; name: string | null; type: string }) {
		// Step 0: Credentials
		setStep(idx, 0, 'active');
		let username = '';
		let password = '';
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip: cam.ip, cameraType: 'mobotix-onvif' })
			});
			if (res.ok) {
				const d = await res.json();
				if (d.success) { username = d.username; password = d.password; }
			}
		} catch { /* ignore */ }
		if (!username || !password) throw new Error('Keine passenden Zugangsdaten');
		setStep(idx, 0, 'done', username);

		// Step 1: Register
		setStep(idx, 1, 'active');
		const res = await fetch('/api/cameras/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name: cam.name || cam.ip, ip: cam.ip, username, password, cameraType: 'mobotix-onvif' })
		});
		const d = await res.json();
		if (!d.success) throw new Error(d.error || 'Registrierung fehlgeschlagen');
		setStep(idx, 1, 'done', 'Nativ ONVIF — kein Container');
	}

	async function batchOnboardPipeline(idx: number, cam: { ip: string; name: string | null; type: string }) {
		let stepNum = 0;
		const isLoxone = cam.type === 'loxone';

		// Step 0: Credentials
		setStep(idx, stepNum, 'active');
		let username = '';
		let password = '';
		try {
			const res = await fetch('/api/credentials/test', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip: cam.ip, cameraType: cam.type })
			});
			if (res.ok) {
				const d = await res.json();
				if (d.success) { username = d.username; password = d.password; }
			}
		} catch { /* ignore */ }
		if (!username || !password) throw new Error('Keine passenden Zugangsdaten');
		setStep(idx, stepNum, 'done', username);
		stepNum++;

		// Step 1: Test connection
		setStep(idx, stepNum, 'active');
		const testRes = await fetch('/api/onboarding/test-connection', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ ip: cam.ip, username, password, cameraType: cam.type }),
			signal: AbortSignal.timeout(60000)
		});
		const testData = await testRes.json();
		if (!testData.success) throw new Error(testData.error || 'Verbindungstest fehlgeschlagen');
		setStep(idx, stepNum, 'done', `${testData.width || 1280}x${testData.height || 720} @ ${testData.fps || 20}fps`);
		stepNum++;

		// Save camera
		const saveRes = await fetch('/api/onboarding/save-camera', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				name: cam.name || cam.ip, ip: cam.ip, username, password,
				width: testData.width || 1280, height: testData.height || 720,
				fps: testData.fps || 20, bitrate: testData.bitrate || 5000,
				vmid: testData.nextVmid || data.nextVmid + idx, cameraType: cam.type
			}),
		});
		const saveData = await saveRes.json();
		if (!saveData.success) throw new Error(saveData.error || 'Speichern fehlgeschlagen');
		const cameraId = saveData.cameraId;

		// Step 2: Create container
		setStep(idx, stepNum, 'active');
		const createRes = await fetch('/api/onboarding/create-container', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(120000)
		});
		const createData = await createRes.json();
		if (!createData.success) throw new Error(createData.error || 'Container fehlgeschlagen');
		setStep(idx, stepNum, 'done', `LXC ${createData.vmid} @ ${createData.containerIp}`);
		stepNum++;

		// Step 3: go2rtc
		setStep(idx, stepNum, 'active');
		const g2rRes = await fetch('/api/onboarding/configure-go2rtc', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(120000)
		});
		const g2rData = await g2rRes.json();
		if (!g2rData.success) throw new Error(g2rData.error || 'go2rtc fehlgeschlagen');
		setStep(idx, stepNum, 'done', 'MJPEG → H.264 VAAPI');
		stepNum++;

		// Step 3b: nginx (Loxone)
		if (isLoxone) {
			setStep(idx, stepNum, 'active');
			const ngxRes = await fetch('/api/onboarding/configure-nginx', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId }),
				signal: AbortSignal.timeout(120000)
			});
			const ngxData = await ngxRes.json();
			if (!ngxData.success) throw new Error(ngxData.error || 'nginx fehlgeschlagen');
			setStep(idx, stepNum, 'done', 'Auth-Proxy aktiv');
			stepNum++;
		}

		// Step 4: ONVIF
		setStep(idx, stepNum, 'active');
		const onvifRes = await fetch('/api/onboarding/configure-onvif', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(600000)
		});
		const onvifData = await onvifRes.json();
		if (!onvifData.success) throw new Error(onvifData.error || 'ONVIF fehlgeschlagen');
		setStep(idx, stepNum, 'done', 'Port 8899 aktiv');
		stepNum++;

		// Step 5: Verify
		setStep(idx, stepNum, 'active');
		const verRes = await fetch('/api/onboarding/verify-stream', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ cameraId }),
			signal: AbortSignal.timeout(60000)
		});
		const verData = await verRes.json();
		if (!verData.success) throw new Error('Stream-Verifikation fehlgeschlagen');
		setStep(idx, stepNum, 'done', 'RTSP Stream OK');
	}
</script>

<h1 class="text-2xl font-bold text-text-primary mb-6">Kamera einrichten</h1>

{#if batchMode}
	<!-- Batch Mode UI -->
	<div class="space-y-4">
		<!-- Header with progress + cancel -->
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-lg font-bold text-text-primary">
					{#if batchRunning}
						Kameras werden eingerichtet...
					{:else}
						Einrichtung abgeschlossen
					{/if}
				</h2>
				<p class="text-sm text-text-secondary">
					{batchDoneCount}/{batchResults.length} fertig{#if batchErrorCount > 0}<span class="text-red-400"> — {batchErrorCount} Fehler</span>{/if}
				</p>
			</div>
			{#if batchRunning}
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

		<!-- Progress bar -->
		<div class="h-1.5 bg-bg-input rounded-full overflow-hidden">
			<div
				class="h-full rounded-full transition-all duration-500 {batchErrorCount > 0 ? 'bg-yellow-400' : 'bg-accent'}"
				style="width: {((batchDoneCount + batchErrorCount) / batchResults.length * 100).toFixed(0)}%"
			></div>
		</div>

		<!-- Camera cards -->
		<div class="space-y-3">
			{#each batchResults as cam, i (cam.ip)}
				<div id="batch-cam-{i}" class="bg-bg-card border rounded-lg overflow-hidden transition-colors
					{cam.status === 'active' ? 'border-accent/50' : cam.status === 'error' ? 'border-red-500/30' : cam.status === 'done' ? 'border-green-500/20' : 'border-border'}">

					<!-- Camera header -->
					<div class="px-4 py-3 flex items-center gap-3">
						{#if cam.status === 'done'}
							<div class="w-7 h-7 rounded-full bg-green-500/15 flex items-center justify-center shrink-0">
								<Check class="w-4 h-4 text-green-400" />
							</div>
						{:else if cam.status === 'active'}
							<div class="w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center shrink-0">
								<Loader2 class="w-4 h-4 text-accent animate-spin" />
							</div>
						{:else if cam.status === 'error'}
							<div class="w-7 h-7 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
								<XCircle class="w-4 h-4 text-red-400" />
							</div>
						{:else if cam.status === 'skipped'}
							<div class="w-7 h-7 rounded-full bg-bg-input flex items-center justify-center shrink-0">
								<span class="text-text-secondary text-xs">—</span>
							</div>
						{:else}
							<div class="w-7 h-7 rounded-full border-2 border-border shrink-0"></div>
						{/if}

						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2">
								<span class="text-text-primary text-sm font-semibold">{cam.name}</span>
								<span class="text-text-secondary text-xs font-mono">{cam.ip}</span>
								{#if cam.type === 'mobotix-onvif'}
									<span class="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">ONVIF</span>
								{:else if cam.type === 'loxone'}
									<span class="text-xs px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400">Loxone</span>
								{:else}
									<span class="text-xs px-1.5 py-0.5 rounded bg-accent/10 text-accent">Mobotix</span>
								{/if}
							</div>
							{#if cam.status === 'error' && cam.error}
								<p class="text-xs text-red-400 mt-0.5">{cam.error}</p>
							{/if}
						</div>

						<!-- Compact step indicators for done/pending cameras -->
						{#if cam.status === 'done'}
							<div class="flex items-center gap-1">
								{#each cam.steps as step}
									<div class="w-2 h-2 rounded-full bg-green-400"></div>
								{/each}
							</div>
						{:else if cam.status === 'pending'}
							<div class="flex items-center gap-1">
								{#each cam.steps as step}
									<div class="w-2 h-2 rounded-full bg-border"></div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Live step details (always visible for active, stays visible for done/error) -->
					{#if cam.status === 'active' || cam.expanded || cam.status === 'error'}
						<div class="px-4 pb-3 border-t border-border/50">
							<div class="space-y-1.5 pt-2.5">
								{#each cam.steps as step, si}
									<div class="flex items-center gap-2.5 text-xs">
										{#if step.status === 'done'}
											<Check class="w-3.5 h-3.5 text-green-400 shrink-0" />
										{:else if step.status === 'active'}
											<Loader2 class="w-3.5 h-3.5 text-accent animate-spin shrink-0" />
										{:else if step.status === 'error'}
											<XCircle class="w-3.5 h-3.5 text-red-400 shrink-0" />
										{:else}
											<div class="w-3.5 h-3.5 rounded-full border border-border shrink-0"></div>
										{/if}

										<span class="{step.status === 'active' ? 'text-accent font-medium' : step.status === 'done' ? 'text-text-primary' : step.status === 'error' ? 'text-red-400' : 'text-text-secondary'}">
											{step.label}
										</span>

										{#if step.detail}
											<span class="text-text-secondary ml-auto font-mono">{step.detail}</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if batchCancelled && !batchRunning}
			<div class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 text-yellow-400 text-sm">
				Abgebrochen. Bereits eingerichtete Kameras bleiben bestehen.
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

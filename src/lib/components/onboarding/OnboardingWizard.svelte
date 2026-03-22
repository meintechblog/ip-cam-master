<script lang="ts">
	import { goto } from '$app/navigation';
	import StepIndicator from './StepIndicator.svelte';
	import StepCredentials from './StepCredentials.svelte';
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import { Loader2, CheckCircle, Camera } from 'lucide-svelte';

	let {
		nextVmid,
		prefillIp = '',
		prefillUsername = '',
		prefillPassword = '',
		prefillName = ''
	}: {
		nextVmid: number;
		prefillIp?: string;
		prefillUsername?: string;
		prefillPassword?: string;
		prefillName?: string;
	} = $props();

	// Wizard state
	let currentStep = $state(0);
	let loading = $state(false);
	let error = $state<string | null>(null);
	let cameraId = $state<number | null>(null);
	let credentialsMatched = $derived(!!(prefillUsername && prefillPassword));

	// Form data
	let ip = $state(prefillIp);
	let username = $state(prefillUsername);
	let password = $state(prefillPassword);
	let name = $state(prefillName);

	// Transcode params (auto-detected)
	let width = $state(1280);
	let height = $state(720);
	let fps = $state(20);
	let bitrate = $state(5000);

	// Results
	let snapshotUrl = $state<string | null>(null);
	let connectionInfo = $state<string | null>(null);
	let containerIp = $state<string | null>(null);
	let containerVmid = $state<number | null>(null);
	let rtspUrl = $state<string | null>(null);
	let streamName = $derived(`cam-${nextVmid}`);

	// Step log
	let stepLog = $state<{ step: number; label: string; detail: string; status: 'done' | 'active' | 'pending' }[]>([]);

	function addLog(step: number, label: string, detail: string, status: 'done' | 'active' | 'pending' = 'active') {
		const existing = stepLog.find(l => l.step === step);
		if (existing) {
			existing.detail = detail;
			existing.status = status;
			stepLog = [...stepLog];
		} else {
			stepLog = [...stepLog, { step, label, detail, status }];
		}
	}

	// Load snapshot from camera
	async function loadSnapshot() {
		if (!ip || !username || !password) return;
		try {
			const res = await fetch('/api/onboarding/snapshot', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip, username, password })
			});
			if (res.ok) {
				const blob = await res.blob();
				snapshotUrl = URL.createObjectURL(blob);
			}
		} catch { /* optional */ }
	}

	// Step 0: Save camera
	async function handleCredentialsSubmit() {
		if (!name || !ip || !username || !password) {
			error = 'Bitte alle Pflichtfelder ausfuellen';
			return;
		}
		loading = true;
		error = null;

		try {
			const res = await fetch('/api/onboarding/save-camera', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name, ip, username, password, width, height, fps, bitrate, vmid: nextVmid })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Kamera konnte nicht gespeichert werden');
			cameraId = data.cameraId;

			// Start automated pipeline
			currentStep = 1;
			await runStep1_TestConnection();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			loading = false;
		}
	}

	// Step 1: Test connection
	async function runStep1_TestConnection() {
		currentStep = 1;
		error = null;
		addLog(1, 'Verbindung', 'Teste Kamera-Verbindung...', 'active');

		try {
			const res = await fetch('/api/onboarding/test-connection', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip, username, password })
			});
			const data = await res.json();
			if (!data.success && !data.resolution) throw new Error(data.error || 'Verbindungstest fehlgeschlagen');

			// Auto-fill params
			if (data.resolution) {
				const parts = data.resolution.split('x');
				if (parts.length === 2) { width = parseInt(parts[0]) || width; height = parseInt(parts[1]) || height; }
			}
			if (data.fps) fps = data.fps;
			const pixels = width * height;
			bitrate = Math.max(1000, Math.min(Math.round((pixels * fps * 0.1) / 1000 / 500) * 500, 10000));

			connectionInfo = `${width}x${height} @ ${fps}fps, ${bitrate} kbit/s`;
			addLog(1, 'Verbindung', `Erfolgreich — ${connectionInfo}`, 'done');

			// Load snapshot + show for 3s
			loadSnapshot();
			await new Promise(r => setTimeout(r, 3000));

			await runStep2_CreateContainer();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(1, 'Verbindung', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 2: Create container
	async function runStep2_CreateContainer() {
		currentStep = 2;
		error = null;
		addLog(2, 'Container', `LXC ${nextVmid} wird erstellt (Debian 12, 192MB RAM, VAAPI)...`, 'active');

		try {
			const res = await fetch('/api/onboarding/create-container', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Container konnte nicht erstellt werden');
			containerIp = data.containerIp;
			containerVmid = data.vmid;

			addLog(2, 'Container', `LXC ${data.vmid} erstellt — IP ${containerIp}`, 'done');
			await runStep3_ConfigureGo2rtc();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(2, 'Container', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 3: Configure go2rtc
	async function runStep3_ConfigureGo2rtc() {
		currentStep = 3;
		error = null;
		addLog(3, 'go2rtc', 'ffmpeg + go2rtc werden installiert, VAAPI-Transcoding konfiguriert...', 'active');

		try {
			const res = await fetch('/api/onboarding/configure-go2rtc', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'go2rtc Konfiguration fehlgeschlagen');

			addLog(3, 'go2rtc', `go2rtc laeuft — MJPEG → H.264 VAAPI, ${width}x${height}@${fps}fps`, 'done');
			await runStep4_ConfigureOnvif();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(3, 'go2rtc', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 4: Configure ONVIF
	async function runStep4_ConfigureOnvif() {
		currentStep = 4;
		error = null;
		addLog(4, 'ONVIF', 'Node.js + ONVIF Server installieren, Device-Naming konfigurieren...', 'active');

		try {
			const res = await fetch('/api/onboarding/configure-onvif', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'ONVIF Konfiguration fehlgeschlagen');

			addLog(4, 'ONVIF', `ONVIF Server laeuft — Geraet "${name}", Manufacturer "${name}", Model "Mobotix"`, 'done');
			await runStep5_VerifyStream();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(4, 'ONVIF', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 5: Verify stream
	async function runStep5_VerifyStream() {
		currentStep = 5;
		error = null;
		addLog(5, 'Verifizieren', 'go2rtc Stream wird geprueft...', 'active');

		try {
			const res = await fetch('/api/onboarding/verify-stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Stream-Verifikation fehlgeschlagen');
			rtspUrl = data.rtspUrl;

			addLog(5, 'Verifizieren', `Stream aktiv — ${rtspUrl}`, 'done');
			loading = false;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(5, 'Verifizieren', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	function retryCurrentStep() {
		error = null;
		if (currentStep === 1) runStep1_TestConnection();
		else if (currentStep === 2) runStep2_CreateContainer();
		else if (currentStep === 3) runStep3_ConfigureGo2rtc();
		else if (currentStep === 4) runStep4_ConfigureOnvif();
		else if (currentStep === 5) runStep5_VerifyStream();
	}
</script>

<div class="max-w-3xl">
	<StepIndicator {currentStep} />

	<div class="flex flex-col lg:flex-row gap-4">
		<!-- Left: Snapshot (persistent during onboarding) -->
		{#if snapshotUrl || currentStep > 0}
			<div class="lg:w-72 shrink-0">
				<div class="bg-black rounded-lg overflow-hidden" style="aspect-ratio: 16/9;">
					{#if snapshotUrl}
						<img src={snapshotUrl} alt={name} class="w-full h-full object-contain" />
					{:else}
						<div class="w-full h-full flex items-center justify-center text-text-secondary/50">
							<Camera class="w-8 h-8" />
						</div>
					{/if}
				</div>
				{#if name}
					<p class="text-sm text-text-primary font-medium mt-2">{name}</p>
					<p class="text-xs text-text-secondary font-mono">{ip}</p>
				{/if}
			</div>
		{/if}

		<!-- Right: Step content -->
		<div class="flex-1">
			<div class="bg-bg-card border border-border rounded-lg p-6">
				{#if error}
					<div class="mb-4">
						<InlineAlert type="error" message={error} />
						<button onclick={retryCurrentStep} class="mt-2 bg-accent text-white rounded-lg px-4 py-2 text-sm hover:bg-accent/90 cursor-pointer">
							Erneut versuchen
						</button>
					</div>
				{/if}

				{#if currentStep === 0}
					<StepCredentials
						bind:ip
						bind:username
						bind:password
						bind:name
						bind:width
						bind:height
						bind:fps
						bind:bitrate
						onSubmit={handleCredentialsSubmit}
						{credentialsMatched}
					/>
				{:else}
					<!-- Step log -->
					<div class="space-y-3">
						{#each stepLog as log (log.step)}
							<div class="flex items-start gap-3">
								{#if log.status === 'done'}
									<CheckCircle class="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
								{:else}
									<Loader2 class="w-5 h-5 text-accent animate-spin shrink-0 mt-0.5" />
								{/if}
								<div>
									<span class="text-sm font-medium text-text-primary">{log.label}</span>
									<p class="text-xs text-text-secondary">{log.detail}</p>
								</div>
							</div>
						{/each}
					</div>

					<!-- Final result -->
					{#if rtspUrl && !loading && !error}
						<div class="mt-6 pt-4 border-t border-border">
							<div class="flex items-center gap-2 mb-3">
								<CheckCircle class="w-5 h-5 text-green-400" />
								<span class="text-text-primary font-bold">Einrichtung abgeschlossen</span>
							</div>
							<div class="bg-bg-primary rounded-lg px-3 py-2 mb-4">
								<span class="text-xs text-text-secondary">RTSP</span>
								<code class="text-xs text-text-primary font-mono ml-2">{rtspUrl}</code>
							</div>
							<p class="text-xs text-text-secondary mb-4">Die Kamera ist jetzt per ONVIF in UniFi Protect auffindbar.</p>
							<button onclick={() => goto('/kameras')} class="bg-accent text-white rounded-lg px-6 py-2 hover:bg-accent/90 transition-colors font-medium cursor-pointer">
								Zur Kamerauebersicht
							</button>
						</div>
					{/if}
				{/if}
			</div>
		</div>
	</div>
</div>

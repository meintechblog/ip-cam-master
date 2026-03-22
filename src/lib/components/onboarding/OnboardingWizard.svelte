<script lang="ts">
	import { goto } from '$app/navigation';
	import StepIndicator from './StepIndicator.svelte';
	import StepCredentials from './StepCredentials.svelte';
	import StepTestConnection from './StepTestConnection.svelte';
	import StepCreateContainer from './StepCreateContainer.svelte';
	import StepConfigureGo2rtc from './StepConfigureGo2rtc.svelte';
	import StepVerifyStream from './StepVerifyStream.svelte';

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

	// Form data
	let ip = $state(prefillIp);
	let username = $state(prefillUsername);
	let password = $state(prefillPassword);
	let credentialsMatched = $derived(!!(prefillUsername && prefillPassword));
	let name = $state(prefillName);

	// Transcode params
	let width = $state(1280);
	let height = $state(720);
	let fps = $state(20);
	let bitrate = $state(5000);

	// Results
	let connectionResult = $state<{ resolution?: string; fps?: number; streamPath?: string } | null>(null);
	let containerIp = $state<string | null>(null);
	let rtspUrl = $state<string | null>(null);
	let streamInfo = $state<{ active: boolean; codec: string | null; producers: number } | null>(null);
	let go2rtcDone = $state(false);

	// Derived
	let streamName = $derived(`cam-${nextVmid}`);

	// Step 0: Save camera record and advance
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
			currentStep = 1;
			runTestConnection();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	// Step 1: Test connection
	async function runTestConnection() {
		loading = true;
		error = null;
		connectionResult = null;

		try {
			const res = await fetch('/api/onboarding/test-connection', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip, username, password })
			});
			const data = await res.json();
			if (!data.success && !data.resolution) throw new Error(data.error || 'Verbindungstest fehlgeschlagen');

			connectionResult = {
				resolution: data.resolution,
				fps: data.fps,
				streamPath: data.streamPath
			};

			// Auto-fill detected values if available
			if (data.resolution) {
				const parts = data.resolution.split('x');
				if (parts.length === 2) {
					width = parseInt(parts[0]) || width;
					height = parseInt(parts[1]) || height;
				}
			}
			if (data.fps) {
				fps = data.fps;
			}
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	// Step 2: Create container
	async function runCreateContainer() {
		loading = true;
		error = null;

		try {
			const res = await fetch('/api/onboarding/create-container', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Container konnte nicht erstellt werden');
			containerIp = data.containerIp;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	// Step 3: Configure go2rtc
	async function runConfigureGo2rtc() {
		loading = true;
		error = null;
		go2rtcDone = false;

		try {
			const res = await fetch('/api/onboarding/configure-go2rtc', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'go2rtc konnte nicht konfiguriert werden');
			go2rtcDone = true;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	// Step 4: Verify stream
	async function runVerifyStream() {
		loading = true;
		error = null;

		try {
			const res = await fetch('/api/onboarding/verify-stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Stream konnte nicht verifiziert werden');
			rtspUrl = data.rtspUrl;
			streamInfo = data.streamInfo;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	}

	function advanceToStep(step: number) {
		currentStep = step;
		error = null;
		if (step === 2) runCreateContainer();
		else if (step === 3) runConfigureGo2rtc();
		else if (step === 4) runVerifyStream();
	}

	function handleComplete() {
		goto('/kameras');
	}
</script>

<div class="max-w-3xl">
	<StepIndicator {currentStep} />

	<div class="bg-bg-card border border-border rounded-lg p-6">
		{#if error}
			<div class="bg-red-500/10 border border-red-500/30 rounded-lg p-3 mb-4 text-red-400 text-sm">
				{error}
			</div>
		{/if}
		{#if loading}
			<div class="flex items-center gap-2 mb-4 text-text-secondary text-sm">
				<svg class="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
				Wird verarbeitet...
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
		{:else if currentStep === 1}
			<StepTestConnection
				{loading}
				{error}
				{connectionResult}
				{ip}
				{username}
				{password}
				onRetry={runTestConnection}
				onNext={() => advanceToStep(2)}
			/>
		{:else if currentStep === 2}
			<StepCreateContainer
				{loading}
				{error}
				vmid={nextVmid}
				{containerIp}
				onRetry={runCreateContainer}
				onNext={() => advanceToStep(3)}
			/>
		{:else if currentStep === 3}
			<StepConfigureGo2rtc
				{loading}
				{error}
				done={go2rtcDone}
				onRetry={runConfigureGo2rtc}
				onNext={() => advanceToStep(4)}
			/>
		{:else if currentStep === 4}
			<StepVerifyStream
				{loading}
				{error}
				{containerIp}
				{streamName}
				{rtspUrl}
				{streamInfo}
				onRetry={runVerifyStream}
				onComplete={handleComplete}
			/>
		{/if}
	</div>
</div>

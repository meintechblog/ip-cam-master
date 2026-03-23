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
		prefillName = '',
		cameraType = 'mobotix'
	}: {
		nextVmid: number;
		prefillIp?: string;
		prefillUsername?: string;
		prefillPassword?: string;
		prefillName?: string;
		cameraType?: string;
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

	// Long-running fetch with 5 min timeout
	function longFetch(url: string, body: any): Promise<Response> {
		return fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(300000)
		});
	}

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

	// Sub-log for granular progress within a step
	let subLog = $state<string[]>([]);
	let subLogQueue: string[] = [];
	let subLogTimer: ReturnType<typeof setInterval> | null = null;

	function addSubLog(msg: string) {
		subLogQueue.push(msg);
	}
	function flushSubLog() {
		// Show all queued messages immediately
		if (subLogQueue.length > 0) {
			subLog = [...subLog, ...subLogQueue];
			subLogQueue = [];
		}
	}
	function startSubLogDrip() {
		// Drip-feed queued messages one by one with delay
		if (subLogTimer) clearInterval(subLogTimer);
		subLogTimer = setInterval(() => {
			if (subLogQueue.length > 0) {
				subLog = [...subLog, subLogQueue.shift()!];
			}
		}, 400);
	}
	function clearSubLog() {
		subLog = [];
		subLogQueue = [];
		if (subLogTimer) { clearInterval(subLogTimer); subLogTimer = null; }
	}

	// Auto-scroll sub-log to bottom
	$effect(() => {
		if (subLog.length > 0) {
			setTimeout(() => {
				const el = document.getElementById('sublog');
				if (el) el.scrollTop = el.scrollHeight;
			}, 50);
		}
	});

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
		// Auto-generate name if empty
		if (!name && ip) {
			const lastOctet = ip.split('.').pop();
			name = cameraType === 'loxone' ? `Intercom` : `Kamera-${lastOctet}`;
		}
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
				body: JSON.stringify({ name, ip, username, password, width, height, fps, bitrate, vmid: nextVmid, cameraType })
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
		clearSubLog();
		addLog(1, 'Verbindung testen', 'Starte Verbindungstest...', 'active');
		addSubLog(`SSH-Verbindung zum Proxmox-Host wird aufgebaut...`);
		addSubLog(`Teste RTSP-Zugang: rtsp://${username}:***@${ip}:554/stream0/mobotix.mjpeg`);
		startSubLogDrip();

		try {
			const res = await fetch('/api/onboarding/test-connection', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ip, username, password, cameraType })
			});
			const data = await res.json();
			if (!data.success && !data.resolution) throw new Error(data.error || 'Verbindungstest fehlgeschlagen');

			if (data.resolution) {
				const parts = data.resolution.split('x');
				if (parts.length === 2) { width = parseInt(parts[0]) || width; height = parseInt(parts[1]) || height; }
				addSubLog(`Kamera-Aufloesung erkannt: ${data.resolution}`);
			}
			if (data.fps) {
				fps = data.fps;
				addSubLog(`Kamera-Framerate erkannt: ${fps} fps (aus Mobotix framerate100)`);
			}
			const pixels = width * height;
			bitrate = Math.max(1000, Math.min(Math.round((pixels * fps * 0.1) / 1000 / 500) * 500, 10000));
			addSubLog(`Bitrate berechnet: ${bitrate} kbit/s (${width}x${height} x ${fps}fps x 0.1bpp)`);
			addSubLog(`Stream-Pfad: ${data.streamPath || '/stream0/mobotix.mjpeg'}`);

			connectionInfo = `${width}x${height} @ ${fps}fps, ${bitrate} kbit/s`;
			addLog(1, 'Verbindung testen', `Kamera erreichbar — ${connectionInfo}`, 'done');

			const snapshotPath = cameraType === 'loxone' ? '/mjpg/video.mjpg' : '/record/current.jpg';
		addSubLog(`Lade Vorschaubild von http://${ip}${snapshotPath} ...`);
			loadSnapshot();
			await new Promise(r => setTimeout(r, 3000));

			await runStep2_CreateContainer();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(1, 'Verbindung testen', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 2: Create container
	async function runStep2_CreateContainer() {
		currentStep = 2;
		error = null;
		clearSubLog();
		const hostname = `cam-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
		addLog(2, 'Container erstellen', `LXC ${nextVmid} wird auf Proxmox erstellt...`, 'active');
		startSubLogDrip();
		addSubLog(`Proxmox API: POST /nodes/prox3/lxc`);
		addSubLog(`VMID: ${nextVmid}, Hostname: ${hostname}`);
		addSubLog(`Template: debian-12-standard_12.12-1_amd64.tar.zst`);
		addSubLog(`RAM: 192 MB, Disk: 4 GB, CPU: 1 Core`);
		addSubLog(`Network: vmbr0 (DHCP)`);
		addSubLog(`VAAPI Passthrough: /dev/dri/renderD128 (via SSH pct set)`);

		try {
			const res = await longFetch('/api/onboarding/create-container', { cameraId });
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Container konnte nicht erstellt werden');
			containerIp = data.containerIp;
			containerVmid = data.vmid;

			addSubLog(`Container gestartet, DHCP-IP erhalten: ${containerIp}`);
			addLog(2, 'Container erstellen', `LXC ${data.vmid} erstellt — ${hostname} @ ${containerIp}`, 'done');

			if (cameraType === 'loxone') {
				await runStep3_ConfigureNginx();
			} else {
				await runStep3_ConfigureGo2rtc();
			}
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(2, 'Container erstellen', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 3 (Loxone only): Configure nginx auth-proxy
	async function runStep3_ConfigureNginx() {
		currentStep = 3;
		error = null;
		clearSubLog();
		addLog(3, 'nginx Reverse Proxy', 'nginx wird installiert und konfiguriert...', 'active');
		startSubLogDrip();
		addSubLog(`apt-get install -y nginx`);
		addSubLog(`nginx.conf generieren:`);
		addSubLog(`  listen 127.0.0.1:8081`);
		addSubLog(`  proxy_pass http://${ip}/mjpg/`);
		addSubLog(`  Authorization: Basic header einbetten (${username}:***)`);
		addSubLog(`  proxy_buffering off (wichtig fuer MJPEG-Streams)`);
		addSubLog(`  proxy_http_version 1.1`);
		addSubLog(`Config schreiben: /etc/nginx/nginx.conf`);
		addSubLog(`systemctl restart nginx`);
		addSubLog(`Ergebnis: http://localhost:8081/mjpg/video.mjpg (ohne Auth)`);

		try {
			const res = await longFetch('/api/onboarding/configure-nginx', { cameraId });
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'nginx Konfiguration fehlgeschlagen');

			flushSubLog();
			addSubLog(`nginx laeuft auf Port 8081 — Auth-Stripping aktiv`);
			addLog(3, 'nginx Reverse Proxy', `nginx laeuft — strippt Auth fuer ${ip}`, 'done');
			await runStep4_ConfigureGo2rtcLoxone();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(3, 'nginx Reverse Proxy', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 4 (Loxone): Configure go2rtc (reads from nginx)
	async function runStep4_ConfigureGo2rtcLoxone() {
		currentStep = 4;
		error = null;
		clearSubLog();
		addLog(4, 'go2rtc konfigurieren', 'Installiere ffmpeg + go2rtc im Container...', 'active');
		startSubLogDrip();
		addSubLog(`pct exec ${containerVmid} -- apt-get install -y ffmpeg wget`);
		addSubLog(`go2rtc Binary von github.com/AlexxIT/go2rtc herunterladen...`);
		addSubLog(`go2rtc.yaml generieren:`);
		addSubLog(`  Stream: ${streamName}`);
		addSubLog(`  Source: http://localhost:8081/mjpg/video.mjpg (via nginx)`);
		addSubLog(`  Transcode: MJPEG → H.264, ${width}x${height}@${fps}fps, ${bitrate}k`);
		addSubLog(`  Hardware: VAAPI (Intel /dev/dri/renderD128)`);
		addSubLog(`Config schreiben: /etc/go2rtc/go2rtc.yaml`);
		addSubLog(`systemd Unit: /etc/systemd/system/go2rtc.service`);
		addSubLog(`systemctl daemon-reload && enable && restart go2rtc`);

		try {
			const res = await longFetch('/api/onboarding/configure-go2rtc', { cameraId });
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'go2rtc Konfiguration fehlgeschlagen');

			flushSubLog();
			addSubLog(`go2rtc Service laeuft auf Port 8554 (RTSP) + 1984 (HTTP/WebRTC)`);
			addLog(4, 'go2rtc konfigurieren', `go2rtc laeuft — liest von nginx @ localhost:8081`, 'done');
			await runStep5_ConfigureOnvifLoxone();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(4, 'go2rtc konfigurieren', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 5 (Loxone): Configure ONVIF
	async function runStep5_ConfigureOnvifLoxone() {
		currentStep = 5;
		error = null;
		clearSubLog();
		const safeName = name.replace(/[^a-zA-Z0-9]/g, '');
		addLog(5, 'ONVIF Server', 'Node.js + ONVIF Server werden installiert...', 'active');
		startSubLogDrip();
		addSubLog(`Node.js 22 LTS installieren`);
		addSubLog(`git clone github.com/daniela-hase/onvif-server`);
		addSubLog(`npm install --production`);
		addSubLog(`onvif-server.js patchen: Manufacturer → "${safeName}", Model → "Loxone"`);
		addSubLog(`config.yaml generieren mit MAC, UUID, Stream-Mapping`);
		addSubLog(`systemd Unit anlegen + starten`);

		try {
			const res = await longFetch('/api/onboarding/configure-onvif', { cameraId });
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'ONVIF Konfiguration fehlgeschlagen');

			flushSubLog();
			addSubLog(`ONVIF Server laeuft auf Port 8899`);
			addLog(5, 'ONVIF Server', `ONVIF laeuft — "${safeName}" @ ${containerIp}:8899`, 'done');
			await runStep6_VerifyStreamLoxone();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(5, 'ONVIF Server', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 6 (Loxone): Verify stream
	async function runStep6_VerifyStreamLoxone() {
		currentStep = 6;
		error = null;
		clearSubLog();
		addLog(6, 'Stream verifizieren', 'Pruefe ob alles laeuft...', 'active');
		startSubLogDrip();
		addSubLog(`GET http://${containerIp}:1984/api/streams`);
		addSubLog(`Pruefe Stream "${streamName}" ...`);

		try {
			const res = await fetch('/api/onboarding/verify-stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Stream-Verifikation fehlgeschlagen');
			rtspUrl = data.rtspUrl;

			flushSubLog();
			addSubLog(`Stream aktiv: Intercom → nginx → go2rtc → RTSP`);
			addSubLog(`RTSP-Output: ${rtspUrl}`);
			addSubLog(`ONVIF-Discovery aktiv fuer UniFi Protect`);
			addLog(6, 'Stream verifizieren', `Alles laeuft — ${rtspUrl}`, 'done');
			loading = false;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(6, 'Stream verifizieren', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 3 (Mobotix): Configure go2rtc
	async function runStep3_ConfigureGo2rtc() {
		currentStep = 3;
		error = null;
		clearSubLog();
		addLog(3, 'go2rtc konfigurieren', 'Installiere ffmpeg + go2rtc im Container...', 'active');
		startSubLogDrip();
		addSubLog(`pct exec ${containerVmid} -- apt-get update && apt-get install -y ffmpeg wget`);
		addSubLog(`go2rtc Binary von github.com/AlexxIT/go2rtc herunterladen...`);
		addSubLog(`/usr/local/bin/go2rtc installiert`);
		if (cameraType === 'loxone') {
			addSubLog(`nginx installieren (Reverse Proxy fuer Auth-Stripping)...`);
			addSubLog(`nginx.conf generieren:`);
			addSubLog(`  listen 127.0.0.1:8081`);
			addSubLog(`  proxy_pass http://${ip}/mjpg/`);
			addSubLog(`  Authorization: Basic (${username}:***) eingebettet`);
			addSubLog(`  proxy_buffering off`);
			addSubLog(`Config schreiben: /etc/nginx/nginx.conf`);
			addSubLog(`nginx neu starten...`);
			addSubLog(`go2rtc.yaml generieren:`);
			addSubLog(`  Stream: ${streamName}`);
			addSubLog(`  Source: http://localhost:8081/mjpg/video.mjpg (via nginx)`);
		} else {
			addSubLog(`go2rtc.yaml generieren:`);
			addSubLog(`  Stream: ${streamName}`);
			addSubLog(`  Source: rtsp://${username}:***@${ip}:554/stream0/mobotix.mjpeg`);
		}
		addSubLog(`  Transcode: MJPEG → H.264, ${width}x${height}@${fps}fps, ${bitrate}k`);
		addSubLog(`  Hardware: VAAPI (Intel /dev/dri/renderD128)`);
		addSubLog(`Config schreiben: /etc/go2rtc/go2rtc.yaml`);
		addSubLog(`systemd Unit: /etc/systemd/system/go2rtc.service`);
		addSubLog(`systemctl daemon-reload && enable && restart go2rtc`);

		try {
			const res = await longFetch('/api/onboarding/configure-go2rtc', { cameraId });
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'go2rtc Konfiguration fehlgeschlagen');

			addSubLog(`go2rtc Service laeuft auf Port 8554 (RTSP) + 1984 (HTTP/WebRTC)`);
			addLog(3, 'go2rtc konfigurieren', `go2rtc laeuft — MJPEG → H.264 VAAPI @ ${containerIp}:8554`, 'done');
			await runStep4_ConfigureOnvif();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(3, 'go2rtc konfigurieren', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 4: Configure ONVIF
	async function runStep4_ConfigureOnvif() {
		currentStep = 4;
		error = null;
		clearSubLog();
		const safeName = name.replace(/[^a-zA-Z0-9]/g, '');
		addLog(4, 'ONVIF Server', 'Node.js + ONVIF Server werden installiert...', 'active');
		startSubLogDrip();
		addSubLog(`Node.js 22 LTS installieren (curl deb.nodesource.com | bash)`);
		addSubLog(`git clone github.com/daniela-hase/onvif-server`);
		addSubLog(`npm install --production`);
		addSubLog(`MAC-Adresse auslesen: ip link show eth0`);
		addSubLog(`UUID generieren: /proc/sys/kernel/random/uuid`);
		addSubLog(`onvif-server.js patchen:`);
		addSubLog(`  Manufacturer: 'Onvif' → '${safeName}'`);
		addSubLog(`  Model: 'Cardinal' → 'Mobotix'`);
		addSubLog(`  ONVIF-Name: 'Cardinal' → 'MOBOTIXS15'`);
		addSubLog(`config.yaml generieren:`);
		addSubLog(`  Stream: /${streamName} → localhost:8554`);
		addSubLog(`  Snapshot: /api/frame.jpeg?src=${streamName} → localhost:1984`);
		addSubLog(`  ONVIF Port: 8899`);
		addSubLog(`systemd Unit: /etc/systemd/system/onvif-server.service`);
		addSubLog(`systemctl daemon-reload && enable && restart onvif-server`);

		try {
			const res = await longFetch('/api/onboarding/configure-onvif', { cameraId });
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'ONVIF Konfiguration fehlgeschlagen');

			addSubLog(`ONVIF Server laeuft auf Port 8899 — Discovery aktiv`);
			addLog(4, 'ONVIF Server', `ONVIF laeuft — "${safeName}" @ ${containerIp}:8899`, 'done');
			await runStep5_VerifyStream();
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(4, 'ONVIF Server', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	// Step 5: Verify stream
	async function runStep5_VerifyStream() {
		currentStep = 5;
		error = null;
		clearSubLog();
		addLog(5, 'Stream verifizieren', 'Pruefe ob alles laeuft...', 'active');
		startSubLogDrip();
		addSubLog(`GET http://${containerIp}:1984/api/streams`);
		addSubLog(`Pruefe Stream "${streamName}" ...`);
		addSubLog(`Erwarte: mindestens 1 Producer (ffmpeg/go2rtc)`);

		try {
			const res = await fetch('/api/onboarding/verify-stream', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ cameraId })
			});
			const data = await res.json();
			if (!data.success) throw new Error(data.error || 'Stream-Verifikation fehlgeschlagen');
			rtspUrl = data.rtspUrl;

			addSubLog(`Stream aktiv: ${data.streamInfo?.producers || 1} Producer`);
			addSubLog(`RTSP-Output: ${rtspUrl}`);
			addSubLog(`Kamera ist jetzt per ONVIF-Discovery in UniFi Protect auffindbar`);
			addLog(5, 'Stream verifizieren', `Alles laeuft — ${rtspUrl}`, 'done');
			loading = false;
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
			addLog(5, 'Stream verifizieren', `Fehler: ${error}`, 'done');
			loading = false;
		}
	}

	function retryCurrentStep() {
		error = null;
		if (cameraType === 'loxone') {
			if (currentStep === 1) runStep1_TestConnection();
			else if (currentStep === 2) runStep2_CreateContainer();
			else if (currentStep === 3) runStep3_ConfigureNginx();
			else if (currentStep === 4) runStep4_ConfigureGo2rtcLoxone();
			else if (currentStep === 5) runStep5_ConfigureOnvifLoxone();
			else if (currentStep === 6) runStep6_VerifyStreamLoxone();
		} else {
			if (currentStep === 1) runStep1_TestConnection();
			else if (currentStep === 2) runStep2_CreateContainer();
			else if (currentStep === 3) runStep3_ConfigureGo2rtc();
			else if (currentStep === 4) runStep4_ConfigureOnvif();
			else if (currentStep === 5) runStep5_VerifyStream();
		}
	}
</script>

<div class="max-w-3xl">
	<StepIndicator {currentStep} {cameraType} />

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
								<div class="flex-1 min-w-0">
									<span class="text-sm font-medium text-text-primary">{log.label}</span>
									<p class="text-xs text-text-secondary">{log.detail}</p>
								</div>
							</div>
						{/each}
					</div>

					<!-- Sub-log: animated task list with spinners -->
					{#if subLog.length > 0}
						<div class="mt-4 bg-bg-primary/50 rounded-lg p-3 max-h-[500px] overflow-y-auto" id="sublog">
							<div class="space-y-1.5">
								{#each subLog as line, i}
									<div class="flex items-start gap-2">
										{#if i < subLog.length - 1 || !loading}
											<span class="text-green-400 text-xs mt-0.5 shrink-0">&#10003;</span>
										{:else}
											<Loader2 class="w-3.5 h-3.5 text-accent animate-spin shrink-0 mt-px" />
										{/if}
										<p class="font-mono text-[11px] leading-relaxed {i === subLog.length - 1 && loading ? 'text-text-primary font-medium' : 'text-text-secondary/70'}">
											{line}
										</p>
									</div>
									<!-- Show progress bar for download lines -->
									{#if (line.includes('herunterladen') || line.includes('installieren') || line.includes('clone')) && i === subLog.length - 1 && loading}
										<div class="ml-5 mt-1">
											<div class="w-full h-1 bg-bg-input rounded-full overflow-hidden">
												<div class="h-full bg-accent rounded-full animate-pulse" style="width: 65%; animation: progress 2s ease-in-out infinite;"></div>
											</div>
										</div>
									{/if}
								{/each}
							</div>
						</div>
					{/if}

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

<script lang="ts">
	import type { CameraCardData } from '$lib/types';
	import { ExternalLink, Copy, Check, Play, Square, RotateCw, Trash2, Pencil, KeyRound, Loader2, Power } from 'lucide-svelte';
	import AdoptionGuide from './AdoptionGuide.svelte';

	let { camera }: { camera: CameraCardData } = $props();
	let copied = $state(false);
	let editing = $state(false);
	let editName = $state(camera.name);
	let renameLoading = $state(false);

	async function saveName() {
		if (!editName.trim() || editName === camera.name) { editing = false; return; }
		renameLoading = true;
		try {
			const res = await fetch(`/api/cameras/${camera.id}/rename`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: editName.trim() })
			});
			if ((await res.json()).success) {
				camera.name = editName.trim();
			}
		} catch { /* ignore */ }
		finally { renameLoading = false; editing = false; }
	}

	// Camera probe data (loaded separately, every 5s)
	let probeData = $state<{
		liveFps: number | null;
		maxFps: number | null;
		cameraModel: string | null;
		firmwareVersion: string | null;
		codec: string | null;
	} | null>(null);

	function copyRtsp() {
		if (camera.rtspUrl) {
			navigator.clipboard.writeText(camera.rtspUrl);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		}
	}

	let actionLoading = $state(false);
	let showDeleteConfirm = $state(false);

	// Credentials modal
	let showCredentials = $state(false);
	let credUsername = $state('');
	let credPassword = $state('');
	let credLoading = $state(false);
	let credError = $state('');
	let credSuccess = $state(false);

	function openCredentials() {
		credUsername = '';
		credPassword = '';
		credError = '';
		credSuccess = false;
		showCredentials = true;
	}

	async function saveCredentials() {
		credLoading = true;
		credError = '';
		credSuccess = false;
		try {
			const res = await fetch(`/api/cameras/${camera.id}/credentials`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ username: credUsername, password: credPassword, test: true })
			});
			const data = await res.json();
			if (data.success) {
				credSuccess = true;
				setTimeout(() => { showCredentials = false; }, 1500);
			} else {
				credError = data.error || 'Fehler beim Speichern';
			}
		} catch {
			credError = 'Verbindung fehlgeschlagen';
		} finally {
			credLoading = false;
		}
	}

	// Camera reboot (Mobotix)
	let rebootLoading = $state(false);
	let rebootConfirm = $state(false);
	let rebooting = $state(false);

	async function rebootCamera() {
		rebootLoading = true;
		rebootConfirm = false;
		try {
			const res = await fetch(`/api/cameras/${camera.id}/reboot`, { method: 'POST' });
			const data = await res.json();
			if (data.success) {
				rebooting = true;
				snapshotSrc = '';
				// Mobotix reboot takes ~60-90s, clear state after 90s
				setTimeout(() => { rebooting = false; }, 90000);
			}
		} catch { /* ignore */ }
		finally {
			rebootLoading = false;
		}
	}

	async function containerAction(action: 'start' | 'stop' | 'restart') {
		actionLoading = true;
		try {
			const res = await fetch(`/api/proxmox/containers/${camera.vmid}/${action}`, { method: 'POST' });
			if (!res.ok) {
				// Silently handle — status will update on next poll
			}
		} catch { /* network error during restart is expected */ }
		finally {
			// Wait a moment for Proxmox to process, then release
			setTimeout(() => { actionLoading = false; }, 3000);
		}
	}

	async function deleteCamera() {
		actionLoading = true;
		try {
			await fetch(`/api/cameras/${camera.id}/delete`, { method: 'POST' });
		} catch { /* ignore */ }
		showDeleteConfirm = false;
		window.location.reload();
	}

	let showAdoptionGuide = $state(false);
	let showAdoptInline = $state(false);

	let isNativeOnvif = $derived(camera.status === 'native-onvif' || camera.cameraType === 'mobotix-onvif');
	let isRunning = $derived(isNativeOnvif || camera.containerStatus === 'running');
	let snapshotSrc = $state('');

	function refreshSnapshot() {
		if (!isRunning || rebooting) return;
		if (!camera.snapshotUrl && !isNativeOnvif) return;
		const img = new Image();
		img.onload = () => { if (!rebooting) snapshotSrc = img.src; };
		img.onerror = () => {
			// Snapshot failed — camera might be rebooting or offline
			if (rebooting) snapshotSrc = '';
		};
		img.src = `${camera.snapshotUrl}?t=${Date.now()}`;
	}

	$effect(() => {
		if (isRunning) refreshSnapshot();
		const timer = setInterval(refreshSnapshot, 10000);
		return () => clearInterval(timer);
	});

	async function fetchProbe() {
		try {
			const res = await fetch(`/api/cameras/${camera.id}/probe`);
			if (res.ok) probeData = await res.json();
		} catch { /* ignore */ }
	}

	$effect(() => {
		fetchProbe();
		const timer = setInterval(fetchProbe, 30000);
		return () => clearInterval(timer);
	});

	function formatBytes(bytes: number): string {
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
	}
</script>

<div class="bg-bg-card border border-border rounded-lg overflow-hidden w-full">
	<!-- Top: Stream + LXC info side by side -->
	<div class="flex flex-col lg:flex-row">
		<!-- Live Stream -->
		<div class="flex-1 relative bg-black {!isRunning ? 'opacity-40' : ''}" style="aspect-ratio: {camera.width || 16}/{camera.height || 9};">
			{#if rebooting}
				<div class="absolute inset-0 flex flex-col items-center justify-center text-warning text-sm gap-2">
					<Loader2 class="w-6 h-6 animate-spin" />
					<span>Kamera startet neu...</span>
				</div>
			{:else if snapshotSrc && isRunning}
				<img src={snapshotSrc} alt={camera.name} class="w-full h-full object-contain" />
			{:else}
				<div class="absolute inset-0 flex items-center justify-center text-text-secondary/50 text-sm">
					{isRunning ? 'Bild wird geladen...' : 'Container gestoppt'}
				</div>
			{/if}
			<div class="absolute top-3 left-3 flex items-center gap-2">
				{#if editing}
					<div class="flex items-center gap-1 bg-black/70 backdrop-blur-sm rounded-md px-2 py-1">
						<input
							type="text"
							bind:value={editName}
							class="bg-transparent text-text-primary text-sm font-bold outline-none w-32"
							onkeydown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') editing = false; }}
						/>
						<button onclick={saveName} class="text-green-400 hover:text-green-300 cursor-pointer"><Check class="w-4 h-4" /></button>
					</div>
				{:else}
					<span class="bg-black/70 backdrop-blur-sm text-text-primary text-sm font-bold px-3 py-1 rounded-md">{camera.name}</span>
					<button onclick={() => { editName = camera.name; editing = true; }} class="bg-black/70 backdrop-blur-sm text-text-secondary hover:text-text-primary rounded-md p-1 cursor-pointer" title="Umbenennen">
						<Pencil class="w-3.5 h-3.5" />
					</button>
					<button onclick={openCredentials} class="bg-black/70 backdrop-blur-sm text-text-secondary hover:text-text-primary rounded-md p-1 cursor-pointer" title="Zugangsdaten aendern">
						<KeyRound class="w-3.5 h-3.5" />
					</button>
					<a href={camera.cameraWebUrl || `http://${camera.cameraIp}`} target="_blank" class="bg-black/70 backdrop-blur-sm text-text-secondary hover:text-text-primary rounded-md p-1" title="Kamera-Webinterface oeffnen">
						<ExternalLink class="w-3.5 h-3.5" />
					</a>
					{#if camera.cameraType === 'mobotix' || camera.cameraType === 'mobotix-onvif' || camera.cameraType === 'loxone'}
						{#if rebootConfirm}
							<button onclick={rebootCamera} disabled={rebootLoading} class="bg-red-500/80 backdrop-blur-sm text-white rounded-md px-2 py-0.5 text-xs cursor-pointer">
								Neustart?
							</button>
							<button onclick={() => rebootConfirm = false} class="bg-black/70 backdrop-blur-sm text-text-secondary hover:text-text-primary rounded-md px-2 py-0.5 text-xs cursor-pointer">
								Abbrechen
							</button>
						{:else}
							<button onclick={() => rebootConfirm = true} class="bg-black/70 backdrop-blur-sm text-text-secondary hover:text-text-primary rounded-md p-1 cursor-pointer" title="Kamera neustarten">
								<Power class="w-3.5 h-3.5" />
							</button>
						{/if}
					{/if}
				{/if}
			</div>
		</div>

		<!-- LXC Container Info (only for pipeline cameras) -->
		{#if !isNativeOnvif}
		<div class="lg:w-64 xl:w-72 shrink-0 p-4 bg-bg-primary/30 border-l border-border">
			<div class="flex items-center gap-2 mb-3">
				<span class="w-2.5 h-2.5 rounded-full {camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
				<span class="text-sm font-bold text-text-primary">LXC {camera.vmid}</span>
				<span class="text-xs text-text-secondary ml-auto">{camera.containerStatus}</span>
			</div>
			<div class="space-y-2 text-xs">
				<div>
					<div class="flex justify-between text-text-secondary mb-0.5">
						<span>CPU</span>
						<span class="text-text-primary">{camera.lxcCpu != null ? `${(camera.lxcCpu * 100).toFixed(1)}%` : '—'}</span>
					</div>
					{#if camera.lxcCpu != null}
						<div class="w-full h-1.5 bg-bg-input rounded-full overflow-hidden">
							<div class="h-full rounded-full {camera.lxcCpu > 0.8 ? 'bg-red-400' : camera.lxcCpu > 0.5 ? 'bg-yellow-400' : 'bg-green-400'}"
								style="width: {Math.min(camera.lxcCpu * 100, 100)}%"></div>
						</div>
					{/if}
				</div>
				<div>
					<div class="flex justify-between text-text-secondary mb-0.5">
						<span>RAM</span>
						<span class="text-text-primary">
							{#if camera.lxcMemory}
								{formatBytes(camera.lxcMemory.used)} / {formatBytes(camera.lxcMemory.total)}
							{:else}
								—
							{/if}
						</span>
					</div>
					{#if camera.lxcMemory}
						{@const memPercent = camera.lxcMemory.used / camera.lxcMemory.total}
						<div class="w-full h-1.5 bg-bg-input rounded-full overflow-hidden">
							<div class="h-full rounded-full {memPercent > 0.8 ? 'bg-red-400' : memPercent > 0.5 ? 'bg-yellow-400' : 'bg-green-400'}"
								style="width: {Math.min(memPercent * 100, 100)}%"></div>
						</div>
					{/if}
				</div>
				<div class="flex justify-between text-text-secondary">
					<span>IP</span>
					<span class="font-mono text-text-primary">{camera.containerIp || '—'}</span>
				</div>
				<div class="flex justify-between text-text-secondary">
					<span>Hostname</span>
					<span class="text-text-primary">cam-{camera.vmid}</span>
				</div>
				{#if camera.lxcMac}
					<div class="flex justify-between text-text-secondary">
						<span>MAC</span>
						<span class="font-mono text-text-primary text-[10px]">{camera.lxcMac}</span>
					</div>
				{/if}
			</div>

			<!-- Container Actions -->
			<div class="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
				<button onclick={() => containerAction('start')} disabled={actionLoading || camera.containerStatus === 'running'}
					class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer" title="Start">
					<Play class="w-3 h-3" /> Start
				</button>
				<button onclick={() => containerAction('stop')} disabled={actionLoading || camera.containerStatus === 'stopped'}
					class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer" title="Stop">
					<Square class="w-3 h-3" /> Stop
				</button>
				<button onclick={() => containerAction('restart')} disabled={actionLoading}
					class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer" title="Restart">
					<RotateCw class="w-3 h-3" /> Restart
				</button>
				<button onclick={() => showDeleteConfirm = true} disabled={actionLoading}
					class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ml-auto" title="Loeschen">
					<Trash2 class="w-3 h-3" />
				</button>
			</div>

			<!-- Delete Confirm -->
			{#if showDeleteConfirm}
				<div class="mt-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
					<p class="text-xs text-red-400 mb-2">"{camera.name}" (LXC {camera.vmid}) wirklich loeschen?</p>
					<div class="flex gap-2">
						<button onclick={deleteCamera} class="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 cursor-pointer">Loeschen</button>
						<button onclick={() => showDeleteConfirm = false} class="px-3 py-1 text-xs bg-bg-input text-text-secondary rounded hover:bg-bg-card cursor-pointer">Abbrechen</button>
					</div>
				</div>
			{/if}
		</div>
		{:else}
		<!-- Native ONVIF info panel -->
		<div class="lg:w-64 xl:w-72 shrink-0 p-4 bg-bg-primary/30 border-l border-border">
			<div class="flex items-center gap-2 mb-3">
				<span class="w-2.5 h-2.5 rounded-full {rebooting ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}"></span>
				<span class="text-sm font-bold text-text-primary">{rebooting ? 'Neustart...' : 'Nativ ONVIF'}</span>
				{#if camera.cameraWebUrl}
					<a href={camera.cameraWebUrl} target="_blank" class="text-accent hover:text-accent/80 ml-auto" title="Kamera-Webinterface oeffnen">
						<ExternalLink class="w-3.5 h-3.5" />
					</a>
				{/if}
			</div>
			<div class="space-y-0.5 text-xs text-text-secondary">
				<div class="flex justify-between"><span>IP</span><span class="font-mono text-text-primary">{camera.cameraIp}</span></div>
				{#if probeData?.cameraModel}
					<div class="flex justify-between"><span>Modell</span><span class="text-text-primary">{probeData.cameraModel}</span></div>
				{/if}
				{#if probeData?.firmwareVersion}
					<div class="flex justify-between"><span>Firmware</span><span class="text-text-primary">{probeData.firmwareVersion}</span></div>
				{/if}
				{#if probeData?.codec}
					<div class="flex justify-between"><span>Codec</span><span class="text-text-primary">{probeData.codec}</span></div>
				{/if}
				{#if probeData?.liveFps}
					<div class="flex justify-between"><span>FPS</span><span class="text-text-primary">{probeData.liveFps}</span></div>
				{/if}
			</div>
			<!-- Protect status for native ONVIF -->
			{#if camera.protectConfigured}
				<div class="mt-3 pt-3 border-t border-border">
					<div class="flex items-center gap-2 mb-1.5">
						{#if camera.protectStatus?.isAdopted && camera.protectStatus?.state === 'CONNECTED'}
							<span class="w-2 h-2 rounded-full shrink-0 bg-green-400"></span>
							<span class="text-xs text-green-400 font-medium">In Protect adoptiert</span>
						{:else if camera.protectStatus?.isAdopted}
							<span class="w-2 h-2 rounded-full shrink-0 bg-red-400"></span>
							<span class="text-xs text-red-400 font-medium">Getrennt ({camera.protectStatus.state})</span>
						{:else}
							<span class="w-2 h-2 rounded-full shrink-0 bg-yellow-400"></span>
							<span class="text-xs text-yellow-400">Nicht in Protect</span>
						{/if}
					</div>
					{#if camera.protectStatus?.protectName}
						<div class="flex justify-between text-xs text-text-secondary"><span>Protect Name</span><span class="text-text-primary">{camera.protectStatus.protectName}</span></div>
					{/if}
				</div>
			{/if}
			<!-- Delete button for native ONVIF -->
			<div class="pt-2">
				{#if !showDeleteConfirm}
					<button onclick={() => showDeleteConfirm = true}
						class="flex items-center gap-1 px-2 py-1 text-xs rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 cursor-pointer">
						<Trash2 class="w-3 h-3" /> Entfernen
					</button>
				{:else}
					<div class="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
						<p class="text-xs text-red-400 mb-2">Kamera "{camera.name}" wirklich entfernen?</p>
						<div class="flex gap-2">
							<button onclick={deleteCamera} class="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 cursor-pointer">Entfernen</button>
							<button onclick={() => showDeleteConfirm = false} class="px-3 py-1 text-xs bg-bg-input text-text-secondary rounded hover:bg-bg-card cursor-pointer">Abbrechen</button>
						</div>
					</div>
				{/if}
			</div>
		</div>
		{/if}
	</div>

	{#if !isNativeOnvif}
	<!-- Pipeline: horizontal flow with arrows -->
	<div class="p-4 border-t border-border {!isRunning ? 'opacity-40 pointer-events-none' : ''}">
		<div class="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-0 items-stretch">

			<!-- Kamera -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="w-2 h-2 rounded-full shrink-0 {rebooting ? 'bg-yellow-400 animate-pulse' : camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-sm font-medium text-text-primary">{rebooting ? 'Neustart...' : 'Kamera'}</span>
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between"><span>Name</span><span class="text-text-primary">{camera.name}</span></div>
					<div class="flex justify-between"><span>Modell</span><span class="text-text-primary">{probeData?.cameraModel || camera.cameraType}</span></div>
					<div class="flex justify-between"><span>IP</span><span class="font-mono text-text-primary">{camera.cameraIp}</span></div>
					<div class="flex justify-between"><span>Video</span><span class="text-text-primary">{probeData?.codec || 'MJPEG'}</span></div>
					<div class="flex justify-between"><span>Audio</span><span class="text-text-primary">{camera.streamInfo?.audioCodec ? 'G.711 mulaw' : '—'}</span></div>
					{#if probeData?.firmwareVersion}
						<div class="flex justify-between"><span>FW</span><span class="text-text-primary">{probeData.firmwareVersion}</span></div>
					{/if}
				</div>
			</div>

			<!-- Arrow -->
			<div class="hidden md:flex items-center justify-center px-1 text-text-secondary/30 text-lg">&#9654;</div>

			<!-- go2rtc -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="w-2 h-2 rounded-full shrink-0 {camera.go2rtcRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-sm font-medium text-text-primary">go2rtc</span>
					{#if camera.go2rtcRunning && camera.go2rtcWebUrl}
						<a href={camera.go2rtcWebUrl} target="_blank" class="text-accent hover:text-accent/80 ml-auto">
							<ExternalLink class="w-3.5 h-3.5" />
						</a>
					{/if}
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between"><span>Video</span><span class="text-text-primary">MJPEG → H.264 (VAAPI)</span></div>
					<div class="flex justify-between">
						<span>Audio</span>
						<span class="text-text-primary">
							{#if camera.streamInfo?.audioCodec}
								{camera.streamInfo.audioCodec}
							{:else}
								—
							{/if}
						</span>
					</div>
					<div class="flex justify-between">
						<span>FPS</span>
						<span class="text-text-primary">
							{#if probeData?.liveFps != null}
								{probeData.liveFps}
							{:else}
								—
							{/if}
						</span>
					</div>
					<div class="flex justify-between"><span>Bitrate</span><span class="text-text-primary">{camera.bitrate} kbit/s</span></div>
					<div class="flex justify-between"><span>Clients</span><span class="text-text-primary">{camera.connectedClients}</span></div>
				</div>
			</div>

			<!-- Arrow -->
			<div class="hidden md:flex items-center justify-center px-1 text-text-secondary/30 text-lg">&#9654;</div>

			<!-- ONVIF Server -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="w-2 h-2 rounded-full shrink-0 {camera.onvifRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-sm font-medium text-text-primary">ONVIF</span>
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between"><span>Port</span><span class="font-mono text-text-primary">8899</span></div>
					<div class="flex justify-between"><span>Geraet</span><span class="text-text-primary">{camera.name}</span></div>
					<div class="flex justify-between"><span>Discovery</span><span class="{camera.onvifRunning ? 'text-green-400' : 'text-red-400'}">{camera.onvifRunning ? 'aktiv' : 'aus'}</span></div>
				</div>
			</div>

			<!-- Arrow -->
			<div class="hidden md:flex items-center justify-center px-1 text-text-secondary/30 text-lg">&#9654;</div>

			<!-- UniFi Protect -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					{#if camera.protectStatus?.isAdopted && camera.protectStatus?.state === 'CONNECTED'}
						<span class="w-2 h-2 rounded-full shrink-0 bg-green-400"></span>
					{:else if camera.protectStatus?.isAdopted}
						<span class="w-2 h-2 rounded-full shrink-0 bg-red-400"></span>
					{:else if camera.protectConfigured}
						<span class="w-2 h-2 rounded-full shrink-0 bg-yellow-400"></span>
					{:else}
						<span class="w-2 h-2 rounded-full shrink-0 bg-gray-400"></span>
					{/if}
					<span class="text-sm font-medium text-text-primary">UniFi Protect</span>
					{#if camera.flapping}
						<span class="text-xs px-2 py-0.5 rounded-full bg-warning/15 text-warning font-medium">instabil</span>
					{/if}
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between">
						<span>Status</span>
						{#if camera.protectStatus?.isAdopted && camera.protectStatus?.state === 'CONNECTED'}
							<span class="text-green-400 font-medium">Adoptiert</span>
						{:else if camera.protectStatus?.isAdopted}
							<span class="text-red-400 font-medium">Getrennt ({camera.protectStatus.state})</span>
						{:else if camera.protectConfigured}
							<span class="text-yellow-400">Nicht adoptiert</span>
						{:else}
							<span class="text-gray-400">Nicht konfiguriert</span>
						{/if}
					</div>
					{#if camera.protectStatus?.protectName}
						<div class="flex justify-between"><span>Protect Name</span><span class="text-text-primary">{camera.protectStatus.protectName}</span></div>
					{/if}
					{#if camera.protectStatus?.connectedSince}
						<div class="flex justify-between"><span>Verbunden seit</span><span class="text-text-primary">{new Date(camera.protectStatus.connectedSince).toLocaleString('de-DE')}</span></div>
					{/if}
					{#if camera.protectStatus?.isThirdPartyCamera}
						<div class="flex justify-between"><span>Typ</span><span class="text-text-primary">Third-Party</span></div>
					{/if}
					<div class="flex justify-between"><span>Codec</span><span class="text-text-primary">{(camera.streamInfo?.codec || 'H.264').replace('H264', 'H.264')}</span></div>
				</div>
				{#if camera.protectConfigured && !camera.protectStatus?.isAdopted}
					{#if showAdoptInline}
						<div class="mt-2 bg-bg-primary rounded-lg p-3 space-y-2 text-xs">
							<p class="text-text-primary font-medium">Kamera in Protect aufnehmen:</p>
							<p class="text-text-secondary">Diese Kamera ist per ONVIF sichtbar. Oeffne Protect und uebernimm sie unter "Geraete".</p>
							{#if camera.protectUrl}
								<a href={camera.protectUrl} target="_blank"
									class="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 font-medium">
									Protect oeffnen ↗
								</a>
							{/if}
							<button onclick={() => showAdoptInline = false}
								class="text-text-secondary hover:text-text-primary text-xs cursor-pointer w-full">Schliessen</button>
						</div>
					{:else}
						<button
							onclick={() => showAdoptInline = true}
							class="mt-2 text-xs px-3 py-1.5 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 transition-colors font-medium cursor-pointer w-full"
						>
							In Protect aufnehmen
						</button>
					{/if}
				{/if}
			</div>
		</div>

		<!-- RTSP URL bar -->
		{#if camera.rtspUrl}
			<div class="flex items-center gap-2 bg-bg-primary rounded-lg px-3 py-2 mt-3">
				<span class="text-xs text-text-secondary shrink-0">RTSP</span>
				<code class="text-xs text-text-primary font-mono flex-1 truncate">{camera.rtspUrl}</code>
				<button onclick={copyRtsp} class="text-text-secondary hover:text-text-primary shrink-0 cursor-pointer" title="Kopieren">
					{#if copied}
						<Check class="w-4 h-4 text-green-400" />
					{:else}
						<Copy class="w-4 h-4" />
					{/if}
				</button>
			</div>
		{/if}
	</div>
	{/if}
</div>

<!-- Adoption Guide Modal -->
{#if showAdoptionGuide}
	<AdoptionGuide
		cameraId={camera.id}
		cameraName={camera.name}
		containerIp={camera.containerIp}
		cameraIp={camera.cameraIp}
		isNativeOnvif={isNativeOnvif}
		onClose={() => showAdoptionGuide = false}
	/>
{/if}

<!-- Credentials Modal -->
{#if showCredentials}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center" onclick={(e) => { if (e.target === e.currentTarget) showCredentials = false; }}>
		<div class="bg-bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 p-5">
			<h3 class="text-text-primary font-bold text-sm mb-1">Zugangsdaten — {camera.name}</h3>
			<p class="text-text-secondary text-xs mb-4">{camera.cameraIp} ({camera.cameraType})</p>

			{#if credSuccess}
				<div class="flex items-center gap-2 text-success text-sm py-4 justify-center">
					<Check class="w-5 h-5" />
					<span>Gespeichert und verifiziert</span>
				</div>
			{:else}
				<div class="space-y-3">
					<div>
						<label for="cred-user" class="block text-xs text-text-secondary mb-1">Benutzername</label>
						<input id="cred-user" type="text" bind:value={credUsername} placeholder="admin"
							class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 outline-none focus:border-accent" />
					</div>
					<div>
						<label for="cred-pass" class="block text-xs text-text-secondary mb-1">Passwort</label>
						<input id="cred-pass" type="password" bind:value={credPassword}
							onkeydown={(e) => { if (e.key === 'Enter' && credUsername && credPassword) saveCredentials(); }}
							class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent" />
					</div>

					{#if credError}
						<div class="bg-danger/10 border border-danger/30 rounded-lg px-3 py-2 text-xs text-danger">{credError}</div>
					{/if}

					<div class="flex gap-2 pt-1">
						<button onclick={saveCredentials} disabled={credLoading || !credUsername || !credPassword}
							class="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer">
							{#if credLoading}
								<Loader2 class="w-4 h-4 animate-spin" /> Teste...
							{:else}
								Testen & Speichern
							{/if}
						</button>
						<button onclick={() => showCredentials = false}
							class="px-3 py-2 text-sm bg-bg-input text-text-secondary rounded-lg hover:bg-bg-primary cursor-pointer">
							Abbrechen
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

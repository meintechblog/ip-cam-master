<script lang="ts">
	import type { CameraCardData } from '$lib/types';
	import { Monitor, Radio, Wifi, ExternalLink, Copy, Check } from 'lucide-svelte';

	let { camera }: { camera: CameraCardData } = $props();
	let copied = $state(false);
	let snapshotKey = $state(0);

	function copyRtsp() {
		if (camera.rtspUrl) {
			navigator.clipboard.writeText(camera.rtspUrl);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		}
	}

	// Refresh snapshot every 15s
	$effect(() => {
		const timer = setInterval(() => { snapshotKey++; }, 15000);
		return () => clearInterval(timer);
	});
</script>

<div class="bg-bg-card border border-border rounded-lg overflow-hidden w-full">
	<div class="flex flex-col lg:flex-row">
		<!-- Snapshot -->
		<div class="lg:w-80 xl:w-96 shrink-0 bg-black flex items-center justify-center min-h-[200px]">
			{#if camera.snapshotUrl}
				{#key snapshotKey}
					<img
						src="{camera.snapshotUrl}?t={Date.now()}"
						alt={camera.name}
						class="w-full h-full object-cover"
					/>
				{/key}
			{:else}
				<div class="text-text-secondary/50 text-sm">Kein Vorschaubild</div>
			{/if}
		</div>

		<!-- Info -->
		<div class="flex-1 p-5">
			<!-- Header -->
			<div class="flex items-center justify-between mb-4">
				<div>
					<h2 class="text-lg font-bold text-text-primary">{camera.name}</h2>
					<span class="text-xs text-text-secondary uppercase tracking-wide">{camera.cameraType} &middot; VMID {camera.vmid}</span>
				</div>
				<div class="flex items-center gap-2">
					<!-- Container status -->
					<span class="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full
						{camera.containerStatus === 'running' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}">
						<span class="w-2 h-2 rounded-full {camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
						LXC {camera.containerStatus}
					</span>
				</div>
			</div>

			<!-- Service Status Badges -->
			<div class="flex flex-wrap gap-3 mb-4">
				<div class="flex items-center gap-1.5 text-xs">
					<span class="w-2 h-2 rounded-full {camera.go2rtcRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-text-secondary">go2rtc</span>
					{#if camera.go2rtcRunning && camera.go2rtcWebUrl}
						<a href={camera.go2rtcWebUrl} target="_blank" class="text-accent hover:text-accent/80">
							<ExternalLink class="w-3 h-3" />
						</a>
					{/if}
				</div>
				<div class="flex items-center gap-1.5 text-xs">
					<span class="w-2 h-2 rounded-full {camera.onvifRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-text-secondary">ONVIF Server</span>
				</div>
				<div class="flex items-center gap-1.5 text-xs">
					<span class="w-2 h-2 rounded-full {camera.streamInfo?.active ? 'bg-green-400' : 'bg-yellow-400'}"></span>
					<span class="text-text-secondary">Stream {camera.streamInfo?.active ? 'aktiv' : 'inaktiv'}</span>
				</div>
				<div class="flex items-center gap-1.5 text-xs">
					{#if camera.streamInfo?.unifiConnected}
						<span class="w-2 h-2 rounded-full bg-green-400"></span>
						<span class="text-text-secondary">UniFi Protect</span>
						<span class="text-green-400 font-medium">verbunden ({camera.streamInfo.unifiStreams} Streams)</span>
					{:else}
						<span class="w-2 h-2 rounded-full bg-yellow-400"></span>
						<span class="text-text-secondary">UniFi Protect</span>
						<span class="text-yellow-400">nicht verbunden</span>
					{/if}
				</div>
			</div>

			<!-- Details Grid -->
			<div class="grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm mb-4">
				<div>
					<span class="text-text-secondary">Kamera-IP</span>
					<p class="text-text-primary font-mono">{camera.cameraIp}</p>
				</div>
				<div>
					<span class="text-text-secondary">Container-IP</span>
					<p class="text-text-primary font-mono">{camera.containerIp || '—'}</p>
				</div>
				<div>
					<span class="text-text-secondary">Transcode</span>
					<p class="text-text-primary">{camera.width}x{camera.height} @ {camera.fps}fps</p>
				</div>
				<div>
					<span class="text-text-secondary">Bitrate</span>
					<p class="text-text-primary">{camera.bitrate} kbit/s</p>
				</div>
				<div>
					<span class="text-text-secondary">Codec</span>
					<p class="text-text-primary">{camera.streamInfo?.codec || 'H.264 (VAAPI)'}</p>
				</div>
				<div>
					<span class="text-text-secondary">Clients verbunden</span>
					<p class="text-text-primary">{camera.connectedClients}</p>
				</div>
			</div>

			<!-- RTSP URL -->
			{#if camera.rtspUrl}
				<div class="flex items-center gap-2 bg-bg-primary rounded-lg px-3 py-2">
					<span class="text-xs text-text-secondary shrink-0">RTSP</span>
					<code class="text-xs text-text-primary font-mono flex-1 truncate">{camera.rtspUrl}</code>
					<button onclick={copyRtsp} class="text-text-secondary hover:text-text-primary shrink-0" title="Kopieren">
						{#if copied}
							<Check class="w-4 h-4 text-green-400" />
						{:else}
							<Copy class="w-4 h-4" />
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</div>
</div>

<script lang="ts">
	import type { CameraCardData } from '$lib/types';
	import { ExternalLink, Copy, Check } from 'lucide-svelte';

	let { camera }: { camera: CameraCardData } = $props();
	let copied = $state(false);
	let snapshotSrc = $state('');

	function copyRtsp() {
		if (camera.rtspUrl) {
			navigator.clipboard.writeText(camera.rtspUrl);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		}
	}

	function refreshSnapshot() {
		if (!camera.snapshotUrl) return;
		const img = new Image();
		img.onload = () => { snapshotSrc = img.src; };
		img.src = `${camera.snapshotUrl}?t=${Date.now()}`;
	}

	$effect(() => {
		refreshSnapshot();
		const timer = setInterval(refreshSnapshot, 10000);
		return () => clearInterval(timer);
	});
</script>

<div class="bg-bg-card border border-border rounded-lg overflow-hidden w-full">
	<!-- Top: Snapshot full width with aspect ratio -->
	<div class="relative bg-black" style="aspect-ratio: {camera.width}/{camera.height};">
		{#if snapshotSrc}
			<img src={snapshotSrc} alt={camera.name} class="w-full h-full object-contain" />
		{:else}
			<div class="absolute inset-0 flex items-center justify-center text-text-secondary/50 text-sm">Kein Vorschaubild</div>
		{/if}
		<!-- Overlay: camera name + status -->
		<div class="absolute top-3 left-3 flex items-center gap-2">
			<span class="bg-black/70 backdrop-blur-sm text-text-primary text-sm font-bold px-3 py-1 rounded-md">{camera.name}</span>
			<span class="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-black/70 backdrop-blur-sm
				{camera.containerStatus === 'running' ? 'text-green-400' : 'text-red-400'}">
				<span class="w-2 h-2 rounded-full {camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
				LXC {camera.vmid}
			</span>
		</div>
	</div>

	<!-- Bottom: Pipeline + Info -->
	<div class="p-4">
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">

			<!-- Layer 1: Kamera -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="w-2 h-2 rounded-full shrink-0 {camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-sm font-medium text-text-primary">Kamera</span>
					<a href={camera.cameraWebUrl || `http://${camera.cameraIp}`} target="_blank" class="text-accent hover:text-accent/80 ml-auto" title="Kamera-Webinterface oeffnen">
						<ExternalLink class="w-3.5 h-3.5" />
					</a>
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between"><span>IP</span><span class="font-mono text-text-primary">{camera.cameraIp}</span></div>
					<div class="flex justify-between"><span>Modell</span><span class="text-text-primary">{camera.cameraModel || camera.cameraType}</span></div>
					<div class="flex justify-between"><span>Aufloesung</span><span class="text-text-primary">{camera.width}x{camera.height}</span></div>
					<div class="flex justify-between">
						<span>FPS</span>
						<span class="text-text-primary">
							{#if camera.liveFps}
								<span class="{camera.liveFps < camera.fps ? 'text-yellow-400' : 'text-green-400'}">{camera.liveFps}</span>/{camera.fps}
							{:else}
								{camera.fps}
							{/if}
						</span>
					</div>
					{#if camera.firmwareVersion}
						<div class="flex justify-between"><span>Firmware</span><span class="text-text-primary">{camera.firmwareVersion}</span></div>
					{/if}
				</div>
			</div>

			<!-- Layer 2: go2rtc -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="w-2 h-2 rounded-full shrink-0 {camera.go2rtcRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-sm font-medium text-text-primary">go2rtc</span>
					{#if camera.go2rtcRunning && camera.go2rtcWebUrl}
						<a href={camera.go2rtcWebUrl} target="_blank" class="text-accent hover:text-accent/80 ml-auto" title="go2rtc Web-UI">
							<ExternalLink class="w-3.5 h-3.5" />
						</a>
					{/if}
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between"><span>Transcode</span><span class="text-text-primary">MJPEG &rarr; H.264</span></div>
					<div class="flex justify-between"><span>HW-Accel</span><span class="text-text-primary">VAAPI</span></div>
					<div class="flex justify-between"><span>Bitrate</span><span class="text-text-primary">{camera.bitrate} kbit/s</span></div>
					<div class="flex justify-between"><span>Clients</span><span class="text-text-primary">{camera.connectedClients}</span></div>
				</div>
			</div>

			<!-- Layer 3: ONVIF Server -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="w-2 h-2 rounded-full shrink-0 {camera.onvifRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-sm font-medium text-text-primary">ONVIF Server</span>
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between"><span>Port</span><span class="font-mono text-text-primary">8899</span></div>
					<div class="flex justify-between"><span>Geraet</span><span class="text-text-primary">{camera.name}</span></div>
					<div class="flex justify-between"><span>Discovery</span><span class="text-text-primary">{camera.onvifRunning ? 'aktiv' : 'inaktiv'}</span></div>
					<div class="flex justify-between"><span>Container</span><span class="font-mono text-text-primary">{camera.containerIp || '—'}</span></div>
				</div>
			</div>

			<!-- Layer 4: UniFi Protect -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					{#if camera.streamInfo?.unifiConnected}
						<span class="w-2 h-2 rounded-full shrink-0 bg-green-400"></span>
					{:else}
						<span class="w-2 h-2 rounded-full shrink-0 bg-yellow-400"></span>
					{/if}
					<span class="text-sm font-medium text-text-primary">UniFi Protect</span>
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between">
						<span>Status</span>
						{#if camera.streamInfo?.unifiConnected}
							<span class="text-green-400 font-medium">verbunden</span>
						{:else}
							<span class="text-yellow-400">nicht verbunden</span>
						{/if}
					</div>
					{#if camera.streamInfo?.unifiConnected}
						<div class="flex justify-between"><span>Streams</span><span class="text-text-primary">{camera.streamInfo.unifiStreams}</span></div>
					{/if}
					<div class="flex justify-between"><span>Stream</span><span class="text-text-primary">{camera.streamInfo?.active ? 'aktiv' : 'inaktiv'}</span></div>
					<div class="flex justify-between"><span>Codec</span><span class="text-text-primary">{camera.streamInfo?.codec || 'H.264'}</span></div>
				</div>
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
</div>

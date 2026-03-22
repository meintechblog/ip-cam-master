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

	// Preload snapshot to avoid flicker: load into hidden img, swap on load
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
	<div class="flex flex-col lg:flex-row">
		<!-- Snapshot -->
		<div class="lg:w-80 xl:w-96 shrink-0 bg-black flex items-center justify-center min-h-[200px]">
			{#if snapshotSrc}
				<img src={snapshotSrc} alt={camera.name} class="w-full h-full object-cover" />
			{:else}
				<div class="text-text-secondary/50 text-sm">Kein Vorschaubild</div>
			{/if}
		</div>

		<!-- Info -->
		<div class="flex-1 p-5">
			<!-- Header -->
			<div class="flex items-center justify-between mb-5">
				<div>
					<h2 class="text-lg font-bold text-text-primary">{camera.name}</h2>
					<span class="text-xs text-text-secondary uppercase tracking-wide">{camera.cameraType} &middot; VMID {camera.vmid}</span>
				</div>
				<span class="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full
					{camera.containerStatus === 'running' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}">
					<span class="w-2 h-2 rounded-full {camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
					LXC {camera.containerStatus}
				</span>
			</div>

			<!-- Pipeline: vertical service stack -->
			<div class="space-y-3 mb-5">

				<!-- Layer 1: Kamera -->
				<div class="flex items-start gap-3 bg-bg-primary/50 rounded-lg px-4 py-3">
					<span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 {camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium text-text-primary">Kamera</span>
							<span class="text-xs text-text-secondary font-mono">{camera.cameraIp}</span>
						</div>
						<div class="text-xs text-text-secondary mt-0.5">
							{camera.width}x{camera.height} @ {camera.fps}fps &middot; Quelle: MJPEG via RTSP
						</div>
					</div>
				</div>

				<!-- Arrow -->
				<div class="flex justify-center text-text-secondary/30 text-xs">&#x25BC;</div>

				<!-- Layer 2: go2rtc -->
				<div class="flex items-start gap-3 bg-bg-primary/50 rounded-lg px-4 py-3">
					<span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 {camera.go2rtcRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2">
								<span class="text-sm font-medium text-text-primary">go2rtc</span>
								{#if camera.go2rtcRunning && camera.go2rtcWebUrl}
									<a href={camera.go2rtcWebUrl} target="_blank" class="text-accent hover:text-accent/80" title="go2rtc Web-UI oeffnen">
										<ExternalLink class="w-3.5 h-3.5" />
									</a>
								{/if}
							</div>
							<span class="text-xs text-text-secondary font-mono">{camera.containerIp || '—'}:1984</span>
						</div>
						<div class="text-xs text-text-secondary mt-0.5">
							{#if camera.go2rtcRunning}
								Transcode: MJPEG &rarr; H.264 (VAAPI) &middot; {camera.bitrate} kbit/s &middot;
								{camera.connectedClients} Client{camera.connectedClients !== 1 ? 's' : ''} verbunden
							{:else}
								Dienst nicht erreichbar
							{/if}
						</div>
					</div>
				</div>

				<!-- Arrow -->
				<div class="flex justify-center text-text-secondary/30 text-xs">&#x25BC;</div>

				<!-- Layer 3: ONVIF Server -->
				<div class="flex items-start gap-3 bg-bg-primary/50 rounded-lg px-4 py-3">
					<span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 {camera.onvifRunning ? 'bg-green-400' : 'bg-red-400'}"></span>
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium text-text-primary">ONVIF Server</span>
							<span class="text-xs text-text-secondary font-mono">{camera.containerIp || '—'}:8899</span>
						</div>
						<div class="text-xs text-text-secondary mt-0.5">
							{#if camera.onvifRunning}
								ONVIF-Discovery aktiv &middot; Geraetename: {camera.name}
							{:else}
								Dienst nicht erreichbar
							{/if}
						</div>
					</div>
				</div>

				<!-- Arrow -->
				<div class="flex justify-center text-text-secondary/30 text-xs">&#x25BC;</div>

				<!-- Layer 4: UniFi Protect -->
				<div class="flex items-start gap-3 bg-bg-primary/50 rounded-lg px-4 py-3">
					{#if camera.streamInfo?.unifiConnected}
						<span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 bg-green-400"></span>
					{:else}
						<span class="w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 bg-yellow-400"></span>
					{/if}
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between">
							<span class="text-sm font-medium text-text-primary">UniFi Protect</span>
							{#if camera.streamInfo?.unifiConnected}
								<span class="text-xs text-green-400 font-medium">verbunden</span>
							{:else}
								<span class="text-xs text-yellow-400">nicht verbunden</span>
							{/if}
						</div>
						<div class="text-xs text-text-secondary mt-0.5">
							{#if camera.streamInfo?.unifiConnected}
								{camera.streamInfo.unifiStreams} Stream{camera.streamInfo.unifiStreams !== 1 ? 's' : ''} aktiv &middot; User-Agent: Media Server (www.ui.com)
							{:else}
								Warte auf ONVIF-Adoption in Protect
							{/if}
						</div>
					</div>
				</div>

			</div>

			<!-- RTSP URL -->
			{#if camera.rtspUrl}
				<div class="flex items-center gap-2 bg-bg-primary rounded-lg px-3 py-2">
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
</div>

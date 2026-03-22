<script lang="ts">
	import type { CameraCardData } from '$lib/types';
	import { ExternalLink, Copy, Check } from 'lucide-svelte';

	let { camera }: { camera: CameraCardData } = $props();
	let copied = $state(false);

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

	let streamUrl = $derived(
		camera.containerIp && camera.go2rtcRunning
			? `http://${camera.containerIp}:1984/stream.html?src=${camera.streamName}&mode=webrtc`
			: null
	);

	async function fetchProbe() {
		try {
			const res = await fetch(`/api/cameras/${camera.id}/probe`);
			if (res.ok) probeData = await res.json();
		} catch { /* ignore */ }
	}

	$effect(() => {
		fetchProbe();
		const timer = setInterval(fetchProbe, 5000);
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
		<div class="flex-1 relative bg-black" style="aspect-ratio: {camera.width}/{camera.height};">
			{#if streamUrl}
				<iframe
					src={streamUrl}
					title="{camera.name} Live"
					class="w-full h-full border-0"
					allow="autoplay"
				></iframe>
			{:else}
				<div class="absolute inset-0 flex items-center justify-center text-text-secondary/50 text-sm">Kein Stream verfuegbar</div>
			{/if}
			<div class="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
				<span class="bg-black/70 backdrop-blur-sm text-text-primary text-sm font-bold px-3 py-1 rounded-md">{camera.name}</span>
			</div>
		</div>

		<!-- LXC Container Info -->
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
			</div>
		</div>
	</div>

	<!-- Pipeline: horizontal flow with arrows -->
	<div class="p-4 border-t border-border">
		<div class="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-0 items-stretch">

			<!-- Kamera -->
			<div class="bg-bg-primary/50 rounded-lg px-3 py-2.5">
				<div class="flex items-center gap-2 mb-1.5">
					<span class="w-2 h-2 rounded-full shrink-0 {camera.containerStatus === 'running' ? 'bg-green-400' : 'bg-red-400'}"></span>
					<span class="text-sm font-medium text-text-primary">Kamera</span>
					<a href={camera.cameraWebUrl || `http://${camera.cameraIp}`} target="_blank" class="text-accent hover:text-accent/80 ml-auto">
						<ExternalLink class="w-3.5 h-3.5" />
					</a>
				</div>
				<div class="space-y-0.5 text-xs text-text-secondary">
					<div class="flex justify-between"><span>Name</span><span class="text-text-primary">{camera.name}</span></div>
					<div class="flex justify-between"><span>Modell</span><span class="text-text-primary">{probeData?.cameraModel || camera.cameraType}</span></div>
					<div class="flex justify-between"><span>IP</span><span class="font-mono text-text-primary">{camera.cameraIp}</span></div>
					<div class="flex justify-between"><span>Codec</span><span class="text-text-primary">{probeData?.codec || 'MJPEG'}</span></div>
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
					<div class="flex justify-between"><span>Transcode</span><span class="text-text-primary">MJPEG → H.264</span></div>
					<div class="flex justify-between"><span>Accel</span><span class="text-text-primary">VAAPI</span></div>
					<div class="flex justify-between">
						<span>FPS</span>
						<span class="text-text-primary">
							{#if probeData?.liveFps != null}
								<span class="{probeData.liveFps < camera.fps ? 'text-yellow-400' : 'text-green-400'}">{probeData.liveFps}</span>/{camera.fps}
							{:else}
								{camera.fps}
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
							<span class="text-yellow-400">wartend</span>
						{/if}
					</div>
					{#if camera.streamInfo?.unifiConnected}
						<div class="flex justify-between"><span>Streams</span><span class="text-text-primary">{camera.streamInfo.unifiStreams}</span></div>
					{/if}
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

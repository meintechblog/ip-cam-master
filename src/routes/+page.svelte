<script lang="ts">
	import type { CameraCardData } from '$lib/types';
	import {
		Loader2,
		CheckCircle,
		AlertTriangle,
		XCircle,
		Monitor,
		Server,
		Radio,
		Shield,
		Activity,
		ArrowRight
	} from 'lucide-svelte';

	let cameras = $state<CameraCardData[]>([]);
	let loading = $state(true);
	let lastUpdate = $state<Date | null>(null);
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	async function fetchCameras() {
		try {
			const res = await fetch('/api/cameras/status');
			if (res.ok) {
				cameras = await res.json();
				lastUpdate = new Date();
			}
		} catch {
			// retry next poll
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		fetchCameras();
		pollTimer = setInterval(fetchCameras, 10000);
		return () => {
			if (pollTimer) clearInterval(pollTimer);
		};
	});

	// Derived stats
	let total = $derived(cameras.length);
	let nativeOnvif = $derived(cameras.filter((c) => c.status === 'native-onvif' || c.cameraType === 'mobotix-onvif').length);
	let pipeline = $derived(total - nativeOnvif);

	let containersRunning = $derived(cameras.filter((c) => c.containerStatus === 'running').length);
	let containersStopped = $derived(cameras.filter((c) => c.containerStatus === 'stopped').length);
	let containersError = $derived(cameras.filter((c) => c.containerStatus === 'error').length);

	let streamsActive = $derived(cameras.filter((c) => c.streamInfo?.active).length);
	let go2rtcUp = $derived(cameras.filter((c) => c.go2rtcRunning).length);
	let onvifUp = $derived(cameras.filter((c) => c.onvifRunning).length);

	let unifiConnected = $derived(cameras.filter((c) => c.streamInfo?.unifiConnected).length);
	let totalClients = $derived(cameras.reduce((sum, c) => sum + c.connectedClients, 0));

	// Pipeline cameras only (have containers)
	let pipelineCameras = $derived(cameras.filter((c) => c.vmid > 0));

	// Overall health
	let problems = $derived(cameras.filter((c) => {
		if (c.vmid === 0) return false; // native ONVIF — no container to check
		return c.containerStatus !== 'running' || !c.go2rtcRunning || !c.streamInfo?.active;
	}));
	let healthStatus = $derived<'good' | 'warn' | 'bad'>(
		problems.length === 0 && total > 0 ? 'good' : problems.length <= 1 ? 'warn' : 'bad'
	);

	// CPU/RAM aggregates for pipeline cameras
	let avgCpu = $derived(() => {
		const withCpu = pipelineCameras.filter((c) => c.lxcCpu !== null);
		if (withCpu.length === 0) return null;
		return withCpu.reduce((sum, c) => sum + (c.lxcCpu ?? 0), 0) / withCpu.length;
	});
	let totalRamUsed = $derived(() => {
		return pipelineCameras.reduce((sum, c) => sum + (c.lxcMemory?.used ?? 0), 0);
	});
	let totalRamTotal = $derived(() => {
		return pipelineCameras.reduce((sum, c) => sum + (c.lxcMemory?.total ?? 0), 0);
	});

	let ramPct = $derived(totalRamTotal() > 0 ? (totalRamUsed() / totalRamTotal()) * 100 : 0);

	function formatBytes(bytes: number): string {
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	function formatTime(date: Date): string {
		return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
	}
</script>

<div class="space-y-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<h1 class="text-2xl font-bold text-text-primary">Dashboard</h1>
		{#if lastUpdate}
			<span class="text-xs text-text-secondary">
				Aktualisiert: {formatTime(lastUpdate)}
			</span>
		{/if}
	</div>

	{#if loading}
		<div class="flex items-center gap-3 text-text-secondary py-16 justify-center">
			<Loader2 class="w-5 h-5 animate-spin" />
			<span>Status wird geladen...</span>
		</div>
	{:else if total === 0}
		<div class="text-center py-16">
			<Monitor class="w-12 h-12 text-text-secondary mx-auto mb-4 opacity-40" />
			<p class="text-lg text-text-secondary mb-2">Keine Kameras eingerichtet</p>
			<a href="/kameras/onboarding" class="text-accent hover:underline text-sm">
				Erste Kamera hinzufuegen
			</a>
		</div>
	{:else}
		<!-- Health Banner -->
		<div class="rounded-xl p-5 border {healthStatus === 'good'
			? 'bg-success/5 border-success/20'
			: healthStatus === 'warn'
				? 'bg-warning/5 border-warning/20'
				: 'bg-danger/5 border-danger/20'}">
			<div class="flex items-center gap-3">
				{#if healthStatus === 'good'}
					<div class="w-10 h-10 rounded-full bg-success/15 flex items-center justify-center">
						<CheckCircle class="w-5 h-5 text-success" />
					</div>
					<div>
						<p class="text-text-primary font-semibold">Alles laeuft</p>
						<p class="text-text-secondary text-sm">{total} Kamera{total !== 1 ? 's' : ''} online — keine Probleme</p>
					</div>
				{:else if healthStatus === 'warn'}
					<div class="w-10 h-10 rounded-full bg-warning/15 flex items-center justify-center">
						<AlertTriangle class="w-5 h-5 text-warning" />
					</div>
					<div>
						<p class="text-text-primary font-semibold">{problems.length} Problem{problems.length !== 1 ? 'e' : ''}</p>
						<p class="text-text-secondary text-sm">
							{problems.map((c) => c.name).join(', ')}
						</p>
					</div>
				{:else}
					<div class="w-10 h-10 rounded-full bg-danger/15 flex items-center justify-center">
						<XCircle class="w-5 h-5 text-danger" />
					</div>
					<div>
						<p class="text-text-primary font-semibold">{problems.length} Probleme</p>
						<p class="text-text-secondary text-sm">
							{problems.map((c) => c.name).join(', ')}
						</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Stat Cards Row -->
		<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
			<!-- Cameras -->
			<div class="bg-bg-card rounded-xl p-4 border border-border">
				<div class="flex items-center gap-2 text-text-secondary text-xs font-medium mb-3 uppercase tracking-wider">
					<Monitor class="w-3.5 h-3.5" />
					Kameras
				</div>
				<p class="text-3xl font-bold text-text-primary">{total}</p>
				<div class="flex gap-3 mt-2 text-xs text-text-secondary">
					{#if pipeline > 0}
						<span>{pipeline} Pipeline</span>
					{/if}
					{#if nativeOnvif > 0}
						<span>{nativeOnvif} Nativ</span>
					{/if}
				</div>
			</div>

			<!-- Containers -->
			<div class="bg-bg-card rounded-xl p-4 border border-border">
				<div class="flex items-center gap-2 text-text-secondary text-xs font-medium mb-3 uppercase tracking-wider">
					<Server class="w-3.5 h-3.5" />
					Container
				</div>
				<p class="text-3xl font-bold text-text-primary">{containersRunning}<span class="text-lg text-text-secondary font-normal">/{pipelineCameras.length}</span></p>
				<div class="flex gap-3 mt-2 text-xs">
					{#if containersRunning > 0}
						<span class="text-success">{containersRunning} aktiv</span>
					{/if}
					{#if containersStopped > 0}
						<span class="text-warning">{containersStopped} gestoppt</span>
					{/if}
					{#if containersError > 0}
						<span class="text-danger">{containersError} Fehler</span>
					{/if}
				</div>
			</div>

			<!-- Streams -->
			<div class="bg-bg-card rounded-xl p-4 border border-border">
				<div class="flex items-center gap-2 text-text-secondary text-xs font-medium mb-3 uppercase tracking-wider">
					<Radio class="w-3.5 h-3.5" />
					Streams
				</div>
				<p class="text-3xl font-bold text-text-primary">{streamsActive}<span class="text-lg text-text-secondary font-normal">/{pipelineCameras.length}</span></p>
				<div class="flex gap-3 mt-2 text-xs text-text-secondary">
					<span>{totalClients} Client{totalClients !== 1 ? 's' : ''} verbunden</span>
				</div>
			</div>

			<!-- UniFi Protect -->
			<div class="bg-bg-card rounded-xl p-4 border border-border">
				<div class="flex items-center gap-2 text-text-secondary text-xs font-medium mb-3 uppercase tracking-wider">
					<Shield class="w-3.5 h-3.5" />
					UniFi Protect
				</div>
				<p class="text-3xl font-bold text-text-primary">{unifiConnected}<span class="text-lg text-text-secondary font-normal">/{total}</span></p>
				<div class="flex gap-3 mt-2 text-xs">
					{#if unifiConnected > 0}
						<span class="text-success">{unifiConnected} adoptiert</span>
					{/if}
					{#if total - unifiConnected > 0}
						<span class="text-text-secondary">{total - unifiConnected} wartend</span>
					{/if}
				</div>
			</div>
		</div>

		<!-- Resource Usage (only if pipeline cameras exist) -->
		{#if pipelineCameras.length > 0}
			<div class="bg-bg-card rounded-xl p-5 border border-border">
				<div class="flex items-center gap-2 text-text-secondary text-xs font-medium mb-4 uppercase tracking-wider">
					<Activity class="w-3.5 h-3.5" />
					Ressourcen (LXC Container)
				</div>
				<div class="grid grid-cols-1 md:grid-cols-2 gap-6">
					<!-- CPU -->
					<div>
						<div class="flex justify-between text-sm mb-2">
							<span class="text-text-secondary">CPU Durchschnitt</span>
							<span class="text-text-primary font-medium">
								{avgCpu() !== null ? `${(avgCpu()! * 100).toFixed(1)}%` : '—'}
							</span>
						</div>
						<div class="h-2 bg-bg-input rounded-full overflow-hidden">
							<div
								class="h-full rounded-full transition-all duration-500 {(avgCpu() ?? 0) > 0.8 ? 'bg-danger' : (avgCpu() ?? 0) > 0.5 ? 'bg-warning' : 'bg-accent'}"
								style="width: {((avgCpu() ?? 0) * 100).toFixed(1)}%"
							></div>
						</div>
					</div>
					<!-- RAM -->
					<div>
						<div class="flex justify-between text-sm mb-2">
							<span class="text-text-secondary">RAM Gesamt</span>
							<span class="text-text-primary font-medium">
								{totalRamTotal() > 0
									? `${formatBytes(totalRamUsed())} / ${formatBytes(totalRamTotal())}`
									: '—'}
							</span>
						</div>
							<div class="h-2 bg-bg-input rounded-full overflow-hidden">
							<div
								class="h-full rounded-full transition-all duration-500 {ramPct > 80 ? 'bg-danger' : ramPct > 50 ? 'bg-warning' : 'bg-accent'}"
								style="width: {ramPct.toFixed(1)}%"
							></div>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Camera Status Table -->
		<div class="bg-bg-card rounded-xl border border-border overflow-hidden">
			<div class="px-5 py-4 border-b border-border flex items-center justify-between">
				<span class="text-text-secondary text-xs font-medium uppercase tracking-wider">Kamera-Uebersicht</span>
				<a href="/kameras" class="text-xs text-accent hover:underline flex items-center gap-1">
					Alle Kameras <ArrowRight class="w-3 h-3" />
				</a>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-text-secondary text-xs uppercase tracking-wider border-b border-border">
							<th class="text-left px-5 py-3 font-medium">Status</th>
							<th class="text-left px-5 py-3 font-medium">Name</th>
							<th class="text-left px-5 py-3 font-medium">IP</th>
							<th class="text-left px-5 py-3 font-medium">Typ</th>
							<th class="text-left px-5 py-3 font-medium">Container</th>
							<th class="text-left px-5 py-3 font-medium">go2rtc</th>
							<th class="text-left px-5 py-3 font-medium">Stream</th>
							<th class="text-left px-5 py-3 font-medium">UniFi</th>
						</tr>
					</thead>
					<tbody>
						{#each cameras as cam (cam.id)}
							{@const isNative = cam.status === 'native-onvif' || cam.cameraType === 'mobotix-onvif'}
							{@const allGood = isNative || (cam.containerStatus === 'running' && cam.go2rtcRunning && cam.streamInfo?.active)}
							<tr class="border-b border-border/50 hover:bg-bg-input/30 transition-colors">
								<!-- Overall status dot -->
								<td class="px-5 py-3">
									<span class="inline-block w-2.5 h-2.5 rounded-full {allGood ? 'bg-success' : 'bg-danger'} {allGood ? 'shadow-[0_0_6px_rgba(34,197,94,0.4)]' : 'shadow-[0_0_6px_rgba(239,68,68,0.4)]'}"></span>
								</td>
								<!-- Name -->
								<td class="px-5 py-3 text-text-primary font-medium">{cam.name}</td>
								<!-- IP -->
								<td class="px-5 py-3 text-text-secondary font-mono text-xs">{cam.cameraIp}</td>
								<!-- Type -->
								<td class="px-5 py-3">
									{#if cam.cameraType === 'mobotix-onvif'}
										<span class="text-xs px-2 py-0.5 rounded-full bg-success/10 text-success">ONVIF</span>
									{:else if cam.cameraType === 'mobotix'}
										<span class="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent">Mobotix</span>
									{:else if cam.cameraType === 'loxone'}
										<span class="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">Loxone</span>
									{:else}
										<span class="text-xs text-text-secondary">{cam.cameraType}</span>
									{/if}
								</td>
								<!-- Container -->
								<td class="px-5 py-3">
									{#if isNative}
										<span class="text-xs text-text-secondary">—</span>
									{:else if cam.containerStatus === 'running'}
										<span class="text-xs text-success">aktiv</span>
									{:else if cam.containerStatus === 'stopped'}
										<span class="text-xs text-warning">gestoppt</span>
									{:else}
										<span class="text-xs text-danger">Fehler</span>
									{/if}
								</td>
								<!-- go2rtc -->
								<td class="px-5 py-3">
									{#if isNative}
										<span class="text-xs text-text-secondary">—</span>
									{:else if cam.go2rtcRunning}
										<span class="text-xs text-success">ok</span>
									{:else}
										<span class="text-xs text-danger">down</span>
									{/if}
								</td>
								<!-- Stream -->
								<td class="px-5 py-3">
									{#if isNative}
										<span class="text-xs text-success">nativ</span>
									{:else if cam.streamInfo?.active}
										<span class="text-xs text-success">aktiv</span>
									{:else}
										<span class="text-xs text-danger">inaktiv</span>
									{/if}
								</td>
								<!-- UniFi -->
								<td class="px-5 py-3">
									{#if cam.streamInfo?.unifiConnected}
										<span class="text-xs text-success">verbunden</span>
									{:else}
										<span class="text-xs text-warning">wartend</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}
</div>

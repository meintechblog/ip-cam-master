<script lang="ts">
	// v1.3 Phase 19 Plan 04 — Settings "Protect Hub" tab content.
	// Renders the read-only catalog (HUB-CAT-01..06) populated by
	// POST /api/protect-hub/discover (Plan 03). Auto-discovers on
	// first visit when cache is empty (D-REFRESH-01); manual refresh
	// otherwise. Falls back to cached display + orange banner on
	// controller_unreachable (HUB-CAT-05).
	//
	// HUB-WIZ-01 boundary: this tab is the ENTRY POINT, not the wizard.
	// The toggle widget + provisioning trigger land in P20 alongside the
	// wizard route (/settings/protect-hub/onboarding).
	import {
		RefreshCw,
		AlertTriangle,
		ExternalLink,
		Loader2,
		ShieldCheck,
		ShieldQuestion,
		Building2
	} from 'lucide-svelte';
	import { invalidateAll } from '$app/navigation';

	let { hub, switchTab } = $props<{
		hub: {
			enabled: boolean;
			credsConfigured: boolean;
			cams: Array<{
				id: number;
				name: string;
				mac: string | null;
				manufacturer: string | null;
				modelName: string | null;
				kind: string;
				status: string;
			}>;
			catalogByCamId: Record<
				number,
				Array<{
					quality: string;
					codec: string | null;
					width: number | null;
					height: number | null;
					fps: number | null;
					bitrate: number | null;
				}>
			>;
			lastDiscoveredAt: number | null;
		};
		switchTab: (tab: string) => void;
	}>();

	let refreshing = $state(false);
	let unreachable = $state(false);
	let authFailed = $state(false);
	let errorMessage = $state<string | null>(null);
	let autoDiscoverFired = $state(false);

	async function refresh() {
		refreshing = true;
		unreachable = false;
		authFailed = false;
		errorMessage = null;
		try {
			const res = await fetch('/api/protect-hub/discover', { method: 'POST' });
			const body = await res.json();
			if (!res.ok || !body.ok) {
				if (body.reason === 'controller_unreachable') unreachable = true;
				else if (body.reason === 'auth_failed') authFailed = true;
				else errorMessage = body.error || 'Aktualisierung fehlgeschlagen';
			}
			await invalidateAll();
		} catch (err) {
			errorMessage = err instanceof Error ? err.message : 'Netzwerkfehler';
		} finally {
			refreshing = false;
		}
	}

	// D-REFRESH-01: auto-discover on first visit when cache is empty.
	// `autoDiscoverFired` guard prevents repeated fires if the discover()
	// call returns 0 cams (avoids effect re-run loop after invalidateAll).
	$effect(() => {
		if (
			!autoDiscoverFired &&
			hub.credsConfigured &&
			hub.cams.length === 0 &&
			!refreshing &&
			!errorMessage &&
			!unreachable &&
			!authFailed
		) {
			autoDiscoverFired = true;
			refresh();
		}
	});

	function lastDiscoveredText(): string {
		if (hub.lastDiscoveredAt === null) return 'noch nie';
		return new Date(hub.lastDiscoveredAt).toLocaleString('de-DE');
	}
</script>

<div class="max-w-4xl space-y-6">
	{#if !hub.credsConfigured}
		<!-- Q-OPEN-04 / no-creds branch: deep-link to UniFi tab -->
		<div class="bg-yellow-500/10 border border-yellow-500/30 px-4 py-3 rounded">
			<p class="text-text-primary mb-2">
				Konfiguriere zuerst die UniFi-Verbindung, um den Protect Hub zu nutzen.
			</p>
			<button
				class="inline-flex items-center gap-2 px-3 py-1.5 bg-accent text-white rounded
					hover:bg-accent/90 transition-colors"
				onclick={() => switchTab('UniFi')}
			>
				Zur UniFi-Konfiguration <ExternalLink class="h-4 w-4" />
			</button>
		</div>
	{:else}
		<!-- Status + refresh card -->
		<div class="bg-bg-card rounded-lg border border-border p-6">
			<h2 class="text-lg font-semibold text-text-primary mb-2">
				Protect Hub — Stream-Katalog
			</h2>
			<p class="text-sm text-text-secondary mb-4">
				Letzte Aktualisierung: <span class="font-mono">{lastDiscoveredText()}</span>
				· Erfasste Kameras: <span class="font-mono">{hub.cams.length}</span>
			</p>
			<button
				onclick={refresh}
				disabled={refreshing}
				class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded font-medium
					hover:bg-accent/90 transition-colors disabled:opacity-50"
			>
				<RefreshCw class="w-4 h-4 {refreshing ? 'animate-spin' : ''}" />
				Aktualisieren
			</button>
		</div>

		<!-- HUB-CAT-05: controller-unreachable banner (cache fallback) -->
		{#if unreachable}
			<div
				class="bg-orange-500/10 border border-orange-500/30 text-orange-300 px-4 py-3 rounded
					flex items-start gap-2"
			>
				<AlertTriangle class="w-5 h-5 flex-shrink-0 mt-0.5" />
				<div>
					<p class="font-medium">Controller nicht erreichbar — Anzeige aus Cache</p>
					<p class="text-sm">Letzte Aktualisierung: {lastDiscoveredText()}</p>
				</div>
			</div>
		{/if}
		{#if authFailed}
			<div
				class="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded"
			>
				Anmeldung bei UniFi fehlgeschlagen. Bitte Zugangsdaten prüfen → UniFi-Tab.
			</div>
		{/if}
		{#if errorMessage}
			<div
				class="bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded"
			>
				{errorMessage}
			</div>
		{/if}

		<!-- Catalog body -->
		{#if refreshing && hub.cams.length === 0}
			<div class="flex items-center gap-3 text-text-secondary py-8">
				<Loader2 class="w-5 h-5 animate-spin" />
				<span>Kamerakatalog wird geladen...</span>
			</div>
		{:else if hub.cams.length === 0}
			<p class="text-text-secondary text-sm">
				Noch keine Protect-Kameras gefunden. Klicke auf "Aktualisieren".
			</p>
		{:else}
			<div class="bg-bg-card rounded-lg border border-border overflow-hidden">
				<table class="w-full text-sm">
					<thead class="bg-bg-darker">
						<tr class="text-left text-text-secondary text-xs uppercase">
							<th class="px-4 py-2">Cam</th>
							<th class="px-4 py-2">Hersteller</th>
							<th class="px-4 py-2">Modell</th>
							<th class="px-4 py-2">MAC</th>
							<th class="px-4 py-2">Klassifizierung</th>
							<th class="px-4 py-2">Streams</th>
						</tr>
					</thead>
					<tbody>
						{#each hub.cams as cam (cam.id)}
							<tr class="border-t border-border align-top">
								<td class="px-4 py-3 font-medium">{cam.name}</td>
								<td class="px-4 py-3">{cam.manufacturer ?? '?'}</td>
								<td class="px-4 py-3">{cam.modelName ?? '?'}</td>
								<td class="px-4 py-3 font-mono text-xs">{cam.mac ?? '?'}</td>
								<td class="px-4 py-3">
									{#if cam.kind === 'first-party'}
										<span
											class="inline-flex items-center gap-1 px-2 py-0.5
												bg-blue-500/15 border border-blue-500/30 text-blue-300
												rounded text-xs"
										>
											<ShieldCheck class="w-3 h-3" /> first-party
										</span>
									{:else if cam.kind === 'third-party'}
										<span
											class="inline-flex items-center gap-1 px-2 py-0.5
												bg-purple-500/15 border border-purple-500/30 text-purple-300
												rounded text-xs"
										>
											<Building2 class="w-3 h-3" /> third-party
										</span>
									{:else}
										<span
											class="inline-flex items-center gap-1 px-2 py-0.5
												bg-gray-500/15 border border-gray-500/30 text-gray-300
												rounded text-xs"
										>
											<ShieldQuestion class="w-3 h-3" /> unbekannt
										</span>
									{/if}
								</td>
								<td class="px-4 py-3 space-y-1">
									<!-- HUB-CAT-06: one row per actual channel; never assume 3 -->
									{#each hub.catalogByCamId[cam.id] ?? [] as ch}
										<div class="text-xs font-mono">
											<span class="font-medium">{ch.quality}</span>
											{#if ch.codec}· {ch.codec}{/if}
											{#if ch.width && ch.height}· {ch.width}×{ch.height}{/if}
											{#if ch.fps}@ {ch.fps}fps{/if}
											{#if ch.bitrate}· {Math.round(ch.bitrate / 1000)} kbps{/if}
										</div>
									{:else}
										<span class="text-text-secondary text-xs">keine Streams</span>
									{/each}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	{/if}
</div>

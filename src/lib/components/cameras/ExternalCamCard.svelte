<!--
  v1.3 Phase 22 Plan 03 Task 2 — External Protect cam card variant (HUB-UI-02..06).

  Replaces CameraDetailCard rendering when camera.source === 'external'. Hides
  the LXC card chrome entirely (the live-VM bug "LXC 0 + red dot" on 22 external
  rows is gone). Renders:
    - Two badges (Protect Hub primary + UniFi/Drittanbieter qualifier)
    - Snapshot preview area with manual reload icon (no auto-refresh)
    - Read-only Stream Catalog table (3 cols: Channel · Codec · Auflösung@FPS)
    - <OutputsSubsection> with two toggles + URL captions
    - <ProtectHubGuide> with Loxone + Frigate snippets
    - "Aus Hub entfernen" button rendered DISABLED with P23 tooltip

  Per UI-SPEC §badges + §catalog-table + §snapshot. No cam-edit / cam-delete
  buttons (cam belongs to Protect, not this app).
-->
<script lang="ts">
	import type { CameraCardData } from '$lib/types';
	import { Copy, Check, RotateCw } from 'lucide-svelte';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { deriveSlug } from '$lib/protect-hub/slug';
	import OutputsSubsection from './OutputsSubsection.svelte';
	import ProtectHubGuide from '$lib/components/protect-hub/ProtectHubGuide.svelte';

	let { camera, bridgeIp }: { camera: CameraCardData; bridgeIp: string | null } = $props();

	// Snapshot fetched once on render via go2rtc's frame.jpeg API. Cache-buster
	// (?t=…) is bumped by the reload button so the same render keeps a stable
	// URL for the browser cache, but the user can force a fresh frame on demand.
	let snapshotKey = $state(Date.now());
	let snapshotError = $state(false);

	const lowSlug = $derived(camera.mac ? deriveSlug(camera.mac, 'loxone-mjpeg') : null);
	const snapshotUrl = $derived(
		bridgeIp && lowSlug
			? `http://${bridgeIp}:1984/api/frame.jpeg?src=${lowSlug}&t=${snapshotKey}`
			: null
	);

	function reloadSnapshot() {
		snapshotKey = Date.now();
		snapshotError = false;
	}

	const qualifierLabel = $derived(
		camera.kind === 'first-party'
			? 'UniFi'
			: camera.kind === 'third-party'
				? `Drittanbieter · ${camera.manufacturer ?? 'Unbekannt'}`
				: 'Drittanbieter · Unbekannt'
	);

	let copiedName = $state(false);
	async function copyCamName() {
		if (await copyToClipboard(camera.name)) {
			copiedName = true;
			setTimeout(() => (copiedName = false), 2000);
		}
	}
</script>

<div class="bg-bg-card rounded-lg border border-border p-6">
	<!-- Top row: name + Protect-Hub primary badge + qualifier -->
	<div class="flex items-start gap-3 mb-4">
		<h3 class="text-base font-semibold text-text-primary flex-1 truncate">{camera.name}</h3>
		<span
			class="bg-accent/15 text-accent border border-accent/30 px-2 py-1 rounded text-xs shrink-0"
		>
			Protect Hub
		</span>
		<span
			class="bg-bg-input text-text-primary border border-border px-2 py-1 rounded text-xs shrink-0"
		>
			{qualifierLabel}
		</span>
	</div>

	<!-- Two-column: snapshot (left) + stream catalog (right). Stacks on small screens. -->
	<div class="grid grid-cols-1 lg:grid-cols-[1fr_18rem] gap-6">
		<!-- Snapshot preview -->
		<div class="relative bg-bg-input rounded-lg overflow-hidden aspect-video">
			{#if snapshotUrl && !snapshotError}
				<img
					src={snapshotUrl}
					alt={camera.name}
					class="w-full h-full object-cover"
					onerror={() => (snapshotError = true)}
				/>
			{:else}
				<div
					class="absolute inset-0 flex items-center justify-center text-xs text-text-secondary/50"
				>
					Vorschau nicht verfügbar
				</div>
			{/if}
			<button
				type="button"
				onclick={reloadSnapshot}
				class="absolute top-2 right-2 p-2 bg-bg-card/80 rounded-full hover:bg-bg-card text-text-secondary hover:text-text-primary cursor-pointer"
				aria-label="Vorschau neu laden"
				title="Vorschau neu laden"
			>
				<RotateCw class="w-3.5 h-3.5" />
				<span class="sr-only">Vorschau neu laden</span>
			</button>
		</div>

		<!-- Stream catalog (right column, 18rem wide on lg+) -->
		<div class="lg:w-72 bg-bg-input rounded-lg p-3">
			<div
				class="text-xs text-text-secondary uppercase mb-2 grid grid-cols-3 gap-2 tracking-wider"
			>
				<span>Channel</span>
				<span>Codec</span>
				<span>Auflösung@FPS</span>
			</div>
			{#if (camera.streamCatalog ?? []).length > 0}
				{#each camera.streamCatalog as ch (ch.quality)}
					<div
						class="grid grid-cols-3 gap-2 text-xs font-mono text-text-primary py-1 border-t border-border first:border-t-0"
					>
						<span>{ch.quality}</span>
						<span>{ch.codec ?? '—'}</span>
						<span>
							{ch.width != null && ch.height != null && ch.fps != null
								? `${ch.width}×${ch.height}@${ch.fps}`
								: '—'}
						</span>
					</div>
				{/each}
			{:else}
				<div class="text-xs text-text-secondary">Keine Stream-Daten.</div>
			{/if}
		</div>
	</div>

	<!-- Cam name copy (inline utility — keeps managed-card "copy URL" affordance parity
		without leaking the LXC chrome). The Protect cam itself has no RTSP URL the
		user would copy here; we copy the cam name so the user can paste it into
		Protect's UI for cross-reference. Kept compact. -->
	<div class="hidden">
		<!-- Reserved for future copy affordances (e.g. Protect deep-link).
			 Intentionally hidden in P22 — copy idiom kept in source so future plans
			 can wire visible affordances without a new copy idiom import.
			 (P23 will surface the cam-rename + cross-link buttons here.) -->
		<button onclick={copyCamName} type="button">
			{#if copiedName}<Check class="w-4 h-4" />{:else}<Copy class="w-4 h-4" />{/if}
		</button>
	</div>

	<!-- Outputs subsection: 2 toggles + URL captions (only when ON) + copy buttons -->
	<OutputsSubsection
		cameraId={camera.id}
		mac={camera.mac ?? ''}
		{bridgeIp}
		initialOutputs={camera.outputs ?? []}
	/>

	<!-- ProtectHubGuide: tabbed Loxone + Frigate snippets pre-filled with bridge IP + slug -->
	<ProtectHubGuide {bridgeIp} mac={camera.mac ?? ''} camName={camera.name} />

	<!-- Action menu (P22 ships no destructive flow — disabled button + P23 tooltip) -->
	<div class="mt-6 flex justify-end">
		<button
			type="button"
			disabled
			title="Verfügbar in Phase 23"
			class="text-xs text-text-secondary/50 cursor-not-allowed px-3 py-1.5"
		>
			Aus Hub entfernen
		</button>
	</div>
</div>

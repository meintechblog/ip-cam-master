<script lang="ts">
	// v1.3 Phase 20 Plan 02 — Protect Hub Bridge onboarding wizard (Steps 1-2).
	// Step 1: Verify Protect connection via /api/protect-hub/discover.
	// Step 2: Provision bridge LXC via /api/protect-hub/bridge/provision.
	// Steps 3-6 land in P22.
	import { CheckCircle2, XCircle, Loader2, Shield, ArrowLeft, Server } from 'lucide-svelte';
	import { goto } from '$app/navigation';

	let { data } = $props();

	// Wizard state
	let currentStep = $state(1);

	// Step 1 state
	let checking = $state(false);
	let checkOk = $state(false);
	let checkError = $state<string | null>(null);
	let checkReason = $state<string | null>(null);

	// Step 2 state
	let provisioning = $state(false);
	let provisionOk = $state(false);
	let provisionError = $state<string | null>(null);
	let bridgeIp = $state<string | null>(null);

	// Auto-check Protect connection on mount if creds are configured
	$effect(() => {
		if (data.credsConfigured && !checkOk && !checking && !checkError) {
			verifyProtect();
		}
	});

	async function verifyProtect() {
		checking = true;
		checkOk = false;
		checkError = null;
		checkReason = null;
		try {
			const res = await fetch('/api/protect-hub/discover', { method: 'POST' });
			const body = await res.json();
			if (res.ok && body.ok) {
				checkOk = true;
			} else {
				checkReason = body.reason ?? null;
				if (body.reason === 'auth_failed') {
					checkError = 'Anmeldung bei UniFi Protect fehlgeschlagen. Bitte Zugangsdaten prüfen.';
				} else if (body.reason === 'controller_unreachable') {
					checkError = 'UniFi Controller nicht erreichbar. Bitte Netzwerkverbindung prüfen.';
				} else {
					checkError = body.error || 'Verbindung fehlgeschlagen';
				}
			}
		} catch (err) {
			checkError = err instanceof Error ? err.message : 'Netzwerkfehler';
		} finally {
			checking = false;
		}
	}

	async function provisionBridge() {
		provisioning = true;
		provisionOk = false;
		provisionError = null;
		bridgeIp = null;
		try {
			const res = await fetch('/api/protect-hub/bridge/provision', { method: 'POST' });
			const body = await res.json();
			if (res.ok && body.ok) {
				provisionOk = true;
				bridgeIp = body.bridge?.containerIp ?? null;
			} else {
				provisionError = body.error || 'Bereitstellung fehlgeschlagen';
			}
		} catch (err) {
			provisionError = err instanceof Error ? err.message : 'Netzwerkfehler';
		} finally {
			provisioning = false;
		}
	}
</script>

<div class="max-w-2xl">
	<!-- Breadcrumb -->
	<a href="/settings" class="inline-flex items-center gap-1.5 text-sm text-accent hover:text-accent/80 mb-6">
		<ArrowLeft class="w-4 h-4" />
		Zurück zu Einstellungen
	</a>

	<h1 class="text-2xl font-bold text-text-primary mb-2">Protect Hub — Bridge einrichten</h1>
	<p class="text-sm text-text-secondary mb-8">
		Der Bridge-Container stellt go2rtc für alle Hub-Streams bereit.
	</p>

	<!-- Step indicator -->
	<div class="flex items-center gap-3 mb-8">
		{#each [1, 2] as step}
			<div class="flex items-center gap-2">
				<div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
					{currentStep > step
						? 'bg-green-500/20 text-green-400 border border-green-500/40'
						: currentStep === step
							? 'bg-accent/20 text-accent border border-accent/40'
							: 'bg-bg-input text-text-secondary border border-border'}">
					{#if currentStep > step}
						<CheckCircle2 class="w-4 h-4" />
					{:else}
						{step}
					{/if}
				</div>
				<span class="text-sm {currentStep >= step ? 'text-text-primary' : 'text-text-secondary'}">
					{step === 1 ? 'Protect-Verbindung' : 'Bridge bereitstellen'}
				</span>
			</div>
			{#if step < 2}
				<div class="flex-1 h-px {currentStep > 1 ? 'bg-green-500/40' : 'bg-border'}"></div>
			{/if}
		{/each}
	</div>

	<!-- Step 1: Protect connection check -->
	{#if currentStep === 1}
		<div class="bg-bg-card rounded-lg border border-border p-6 space-y-4">
			<h2 class="text-lg font-semibold text-text-primary">Schritt 1: Protect-Verbindung prüfen</h2>

			{#if !data.credsConfigured}
				<!-- No creds configured -->
				<div class="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 space-y-3">
					<div class="flex items-center gap-2">
						<XCircle class="w-5 h-5 text-yellow-400" />
						<span class="text-sm font-medium text-yellow-400">Keine UniFi-Zugangsdaten konfiguriert</span>
					</div>
					<p class="text-sm text-text-secondary">
						Konfiguriere zuerst die UniFi-Verbindung in den Einstellungen.
					</p>
					<button
						onclick={() => goto('/settings')}
						class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg
							hover:bg-accent/90 transition-colors text-sm font-medium cursor-pointer"
					>
						Zur UniFi-Konfiguration
					</button>
				</div>
			{:else if checking}
				<!-- Checking -->
				<div class="flex items-center gap-3 text-text-secondary py-4">
					<Loader2 class="w-5 h-5 animate-spin text-accent" />
					<span class="text-sm">Verbindung wird geprüft...</span>
				</div>
			{:else if checkOk}
				<!-- Success -->
				<div class="bg-green-500/10 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
					<CheckCircle2 class="w-5 h-5 text-green-400 shrink-0" />
					<div>
						<span class="text-sm font-medium text-green-400">Protect-Verbindung erfolgreich</span>
						<p class="text-xs text-text-secondary mt-0.5">Kamerakatalog wurde aktualisiert.</p>
					</div>
				</div>
				<button
					onclick={() => { currentStep = 2; }}
					class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg
						hover:bg-accent/90 transition-colors text-sm font-medium cursor-pointer"
				>
					Weiter
				</button>
			{:else if checkError}
				<!-- Error -->
				<div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
					<div class="flex items-center gap-2">
						<XCircle class="w-5 h-5 text-red-400 shrink-0" />
						<span class="text-sm font-medium text-red-400">{checkError}</span>
					</div>
					{#if checkReason === 'auth_failed'}
						<button
							onclick={() => goto('/settings')}
							class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg
								hover:bg-accent/90 transition-colors text-sm font-medium cursor-pointer"
						>
							Zur UniFi-Konfiguration
						</button>
					{/if}
					<button
						onclick={verifyProtect}
						class="inline-flex items-center gap-2 px-3 py-1.5 border border-border text-text-secondary
							rounded-lg hover:text-text-primary hover:bg-bg-input transition-colors text-sm cursor-pointer"
					>
						Erneut prüfen
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Step 2: Bridge provisioning -->
	{#if currentStep === 2}
		<div class="bg-bg-card rounded-lg border border-border p-6 space-y-4">
			<h2 class="text-lg font-semibold text-text-primary">Schritt 2: Bridge-Container bereitstellen</h2>

			<!-- LAN-trust info panel (HUB-WIZ-04 / success criterion 8) -->
			<div class="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 flex items-start gap-3">
				<Shield class="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
				<div>
					<p class="text-sm text-blue-300">
						Bridge-Endpunkte sind absichtlich nicht authentifiziert. Stellen Sie sicher, dass der LXC-Container in einem vertrauenswürdigen LAN-Segment läuft.
					</p>
					<p class="text-xs text-text-secondary mt-1">
						Empfehlung: DHCP-Reservierung für eine stabile Bridge-IP.
					</p>
				</div>
			</div>

			{#if provisionOk}
				<!-- Success -->
				<div class="bg-green-500/10 border border-green-500/30 rounded-lg p-4 space-y-3">
					<div class="flex items-center gap-3">
						<CheckCircle2 class="w-5 h-5 text-green-400 shrink-0" />
						<span class="text-sm font-medium text-green-400">Bridge-Container erfolgreich bereitgestellt</span>
					</div>
					{#if bridgeIp}
						<div class="flex items-center gap-2 px-3 py-2 rounded bg-bg-input border border-border">
							<Server class="w-4 h-4 text-text-secondary" />
							<span class="text-sm text-text-secondary">Bridge-IP:</span>
							<span class="text-sm font-mono text-text-primary">{bridgeIp}</span>
						</div>
					{/if}
				</div>
				<a
					href="/settings"
					class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg
						hover:bg-accent/90 transition-colors text-sm font-medium"
				>
					Zurück zu Einstellungen
				</a>
			{:else if provisioning}
				<!-- Provisioning spinner -->
				<div class="flex items-center gap-3 py-4">
					<Loader2 class="w-5 h-5 animate-spin text-accent" />
					<div>
						<span class="text-sm text-text-primary">Bridge wird bereitgestellt...</span>
						<p class="text-xs text-text-secondary mt-0.5">Dies kann beim ersten Mal einige Minuten dauern.</p>
					</div>
				</div>
			{:else if provisionError}
				<!-- Error -->
				<div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4 space-y-3">
					<div class="flex items-center gap-2">
						<XCircle class="w-5 h-5 text-red-400 shrink-0" />
						<span class="text-sm font-medium text-red-400">{provisionError}</span>
					</div>
				</div>
				<button
					onclick={provisionBridge}
					class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg
						hover:bg-accent/90 transition-colors text-sm font-medium cursor-pointer"
				>
					Erneut versuchen
				</button>
			{:else}
				<!-- Initial state — provision button -->
				<button
					onclick={provisionBridge}
					class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-lg
						hover:bg-accent/90 transition-colors text-sm font-medium cursor-pointer"
				>
					<Server class="w-4 h-4" />
					Bridge bereitstellen
				</button>
			{/if}
		</div>

		<!-- Back to step 1 -->
		<button
			onclick={() => { currentStep = 1; }}
			class="mt-4 text-sm text-text-secondary hover:text-text-primary cursor-pointer"
		>
			&larr; Zurück zu Schritt 1
		</button>
	{/if}
</div>

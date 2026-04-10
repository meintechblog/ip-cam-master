<script lang="ts">
	import { RefreshCw, AlertTriangle, CheckCircle2, ArrowUpCircle } from 'lucide-svelte';

	type CurrentShape = {
		label: string;
		sha: string;
		tag: string | null;
		isDev: boolean;
		isDirty: boolean;
	};

	type StatusShape = {
		current: CurrentShape;
		lastCheckedAt: string | null;
		latestSha: string | null;
		latestCommitDate: string | null;
		latestCommitMessage: string | null;
		lastError: string | null;
		hasUpdate: boolean;
	};

	type CheckResponse = StatusShape & {
		checkResult:
			| { error: null }
			| { error: 'rate_limited'; resetAt: string }
			| { error: 'network'; message: string }
			| { error: 'dev_mode' };
	};

	let status = $state<StatusShape | null>(null);
	let loading = $state(false);
	let errorBanner = $state<string | null>(null);

	function formatRelativeTime(iso: string | null): string {
		if (!iso) return 'nie';
		const then = new Date(iso).getTime();
		if (Number.isNaN(then)) return 'nie';
		const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
		if (deltaSec < 60) return 'gerade eben';
		const deltaMin = Math.round(deltaSec / 60);
		if (deltaMin < 60) return `vor ${deltaMin} ${deltaMin === 1 ? 'Minute' : 'Minuten'}`;
		const deltaH = Math.round(deltaMin / 60);
		if (deltaH < 24) return `vor ${deltaH} ${deltaH === 1 ? 'Stunde' : 'Stunden'}`;
		const deltaD = Math.round(deltaH / 24);
		return `vor ${deltaD} ${deltaD === 1 ? 'Tag' : 'Tagen'}`;
	}

	function formatResetTime(iso: string): string {
		try {
			const d = new Date(iso);
			const hh = String(d.getHours()).padStart(2, '0');
			const mm = String(d.getMinutes()).padStart(2, '0');
			return `${hh}:${mm}`;
		} catch {
			return iso;
		}
	}

	function shortSha(sha: string | null): string {
		if (!sha) return 'unbekannt';
		return sha.slice(0, 7);
	}

	async function loadStatus() {
		try {
			const res = await fetch('/api/update/status');
			if (!res.ok) {
				errorBanner = 'Status konnte nicht geladen werden';
				return;
			}
			status = (await res.json()) as StatusShape;
		} catch {
			errorBanner = 'Status konnte nicht geladen werden';
		}
	}

	async function checkNow() {
		loading = true;
		errorBanner = null;
		try {
			const res = await fetch('/api/update/check', { method: 'POST' });
			const body = (await res.json()) as CheckResponse;

			// Always refresh the status fields from the response
			status = {
				current: body.current,
				lastCheckedAt: body.lastCheckedAt,
				latestSha: body.latestSha,
				latestCommitDate: body.latestCommitDate,
				latestCommitMessage: body.latestCommitMessage,
				lastError: body.lastError,
				hasUpdate: body.hasUpdate
			};

			const result = body.checkResult;
			if (result.error === 'rate_limited') {
				errorBanner = `Rate limit — nächste Prüfung möglich um ${formatResetTime(result.resetAt)}`;
			} else if (result.error === 'network') {
				errorBanner = 'Netzwerkfehler — GitHub nicht erreichbar';
			} else if (result.error === 'dev_mode') {
				errorBanner = 'Dev-Modus — Version-Check deaktiviert';
			}
		} catch (e) {
			errorBanner = `Netzwerkfehler: ${(e as Error).message}`;
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		loadStatus();
	});
</script>

<div class="max-w-2xl space-y-6">
	{#if status === null}
		<div class="bg-bg-card rounded-lg border border-border p-6 text-text-secondary">
			Lade Version…
		</div>
	{:else}
		<!-- Card 1: Installed version -->
		<div class="bg-bg-card rounded-lg border border-border p-6">
			<h2 class="text-lg font-semibold text-text-primary mb-4">Installierte Version</h2>
			<div class="text-2xl font-mono text-text-primary">{status.current.label}</div>
			<div class="text-xs font-mono text-text-secondary mt-1 break-all">{status.current.sha}</div>

			{#if status.current.isDirty}
				<div
					class="mt-4 bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-3 rounded flex items-start gap-2"
				>
					<AlertTriangle class="w-5 h-5 flex-shrink-0 mt-0.5" />
					<span
						>Lokale Änderungen im Installationsverzeichnis — Update blockiert.</span
					>
				</div>
			{/if}

			{#if status.current.isDev}
				<div
					class="mt-4 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-4 py-3 rounded"
				>
					Dev-Modus — kein Git-Repository erkannt.
				</div>
			{/if}
		</div>

		<!-- Card 2: Update status -->
		<div class="bg-bg-card rounded-lg border border-border p-6 space-y-4">
			<h2 class="text-lg font-semibold text-text-primary">Update-Status</h2>

			<div class="space-y-2 text-sm text-text-secondary">
				<div>
					<span class="text-text-secondary">Zuletzt geprüft:</span>
					<span class="text-text-primary">{formatRelativeTime(status.lastCheckedAt)}</span>
				</div>
				<div>
					<span class="text-text-secondary">Neueste Version auf main:</span>
					<span class="text-text-primary font-mono">{shortSha(status.latestSha)}</span>
				</div>
				{#if status.latestCommitMessage}
					<div class="italic text-text-secondary">"{status.latestCommitMessage}"</div>
				{/if}
				{#if status.latestCommitDate}
					<div class="text-xs">vom {formatRelativeTime(status.latestCommitDate)}</div>
				{/if}
			</div>

			<!-- Status badge -->
			{#if status.current.isDev}
				<div
					class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-500/10 border border-gray-500/30 text-gray-400 font-semibold"
				>
					Dev-Modus
				</div>
			{:else if status.current.isDirty}
				<div
					class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-400 font-semibold"
				>
					<AlertTriangle class="w-4 h-4" />
					Lokale Änderungen — Update blockiert
				</div>
			{:else if status.hasUpdate}
				<div
					class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-500/10 border border-green-500/30 text-green-400 font-semibold"
				>
					<ArrowUpCircle class="w-4 h-4" />
					Update verfügbar
				</div>
			{:else if status.latestSha}
				<div
					class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-400 font-semibold"
				>
					<CheckCircle2 class="w-4 h-4" />
					Auf dem neuesten Stand
				</div>
			{:else}
				<div
					class="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gray-500/10 border border-gray-500/30 text-gray-400 font-semibold"
				>
					Noch nicht geprüft
				</div>
			{/if}

			{#if errorBanner}
				<div
					class="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-4 py-3 rounded text-sm"
				>
					{errorBanner}
				</div>
			{/if}

			<div>
				<button
					type="button"
					onclick={checkNow}
					disabled={loading || status.current.isDev}
					class="inline-flex items-center gap-2 px-4 py-2 bg-accent text-white rounded font-medium hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
				>
					{#if loading}
						<RefreshCw class="w-4 h-4 animate-spin" />
						Wird geprüft…
					{:else}
						<RefreshCw class="w-4 h-4" />
						Jetzt prüfen
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>

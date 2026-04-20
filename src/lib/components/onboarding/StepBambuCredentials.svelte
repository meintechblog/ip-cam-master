<script lang="ts">
	import { Loader2, Eye, EyeOff } from 'lucide-svelte';

	let {
		ip,
		prefillSerial = '',
		onSubmit
	}: {
		ip: string;
		prefillSerial?: string;
		onSubmit: (result: { serialNumber: string; accessCode: string }) => void;
	} = $props();

	type SavedBambu = { id: number; name: string; serialNumber: string };

	let serialNumber = $state(prefillSerial);
	let accessCode = $state('');
	let savedBambu = $state<SavedBambu[]>([]);
	let loadingSaved = $state(true);
	let picking = $state(false);
	let selectedId = $state<number | null>(null);
	let autoMatchedName = $state<string | null>(null);
	let accessCodeVisible = $state(false);

	let canSubmit = $derived(serialNumber.trim().length > 0 && accessCode.trim().length > 0);

	$effect(() => {
		(async () => {
			try {
				const res = await fetch('/api/credentials');
				if (!res.ok) return;
				const rows = (await res.json()) as Array<{ id: number; name: string; type: string; serialNumber?: string }>;
				savedBambu = rows
					.filter((r) => r.type === 'bambu' && r.serialNumber)
					.map((r) => ({ id: r.id, name: r.name, serialNumber: r.serialNumber ?? '' }));

				// Auto-apply saved creds when the discovered serial matches an
				// entry. No clicks needed — the wizard skips straight to the
				// "Weiter" button with serial + access code already filled in.
				if (prefillSerial && !accessCode) {
					const match = savedBambu.find((c) => c.serialNumber === prefillSerial);
					if (match) {
						autoMatchedName = match.name;
						await applySaved(match.id);
					}
				}
			} finally {
				loadingSaved = false;
			}
		})();
	});

	async function applySaved(id: number) {
		picking = true;
		selectedId = id;
		try {
			const res = await fetch(`/api/credentials/${id}`);
			if (!res.ok) return;
			const data = await res.json();
			if (data.type === 'bambu') {
				serialNumber = data.serialNumber ?? '';
				accessCode = data.accessCode ?? '';
			}
		} finally {
			picking = false;
		}
	}

	function handleSubmit() {
		if (!canSubmit) return;
		onSubmit({ serialNumber: serialNumber.trim(), accessCode: accessCode.trim() });
	}
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-lg font-bold text-text-primary mb-1">Bambu Lab — Zugangsdaten</h2>
		<p class="text-sm text-text-secondary">
			Drucker-IP: <span class="font-mono text-text-primary">{ip}</span>
		</p>
	</div>

	{#if loadingSaved}
		<div class="flex items-center gap-2 text-xs text-text-secondary">
			<Loader2 class="w-3.5 h-3.5 animate-spin" />
			<span>Gespeicherte Bambu-Logins laden...</span>
		</div>
	{:else if savedBambu.length > 0}
		<div class="bg-bg-input/50 border border-border rounded-lg p-3 space-y-2">
			{#if autoMatchedName}
				<p class="text-xs text-green-400">Gespeicherten Login „{autoMatchedName}" automatisch übernommen (Seriennummer passt).</p>
			{:else}
				<p class="text-xs text-text-secondary">Gespeicherte Bambu-Logins — übernehmen statt tippen:</p>
			{/if}
			<div class="flex flex-wrap gap-2">
				{#each savedBambu as cred (cred.id)}
					<button
						type="button"
						onclick={() => applySaved(cred.id)}
						disabled={picking}
						class="text-xs px-3 py-1.5 rounded-md font-medium transition-colors cursor-pointer disabled:opacity-50
							{selectedId === cred.id ? 'bg-accent text-white' : 'bg-bg-input text-text-secondary hover:text-text-primary'}"
						title="SN {cred.serialNumber}"
					>
						{#if picking && selectedId === cred.id}
							<Loader2 class="w-3 h-3 animate-spin inline mr-1" />
						{/if}
						{cred.name}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div>
			<label for="bambu-serial" class="block text-sm font-medium text-text-secondary mb-1">Seriennummer</label>
			<input
				id="bambu-serial"
				type="text"
				bind:value={serialNumber}
				autocomplete="off"
				placeholder="z.B. 31B8BP611201453"
				class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent font-mono"
			/>
			<p class="mt-1 text-xs text-text-secondary">Am Drucker-Display: Einstellungen → Geräteinformationen</p>
		</div>
		<div>
			<label for="bambu-code" class="block text-sm font-medium text-text-secondary mb-1">Access Code</label>
			<div class="relative">
				<input
					id="bambu-code"
					type={accessCodeVisible ? 'text' : 'password'}
					bind:value={accessCode}
					autocomplete="off"
					inputmode="text"
					maxlength="8"
					placeholder="z.B. 12345678"
					class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 pr-10 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent font-mono tracking-widest"
				/>
				<button
					type="button"
					onclick={() => (accessCodeVisible = !accessCodeVisible)}
					class="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary cursor-pointer p-1"
					title={accessCodeVisible ? 'Verbergen' : 'Anzeigen'}
					aria-label={accessCodeVisible ? 'Access Code verbergen' : 'Access Code anzeigen'}
				>
					{#if accessCodeVisible}
						<EyeOff class="w-4 h-4" />
					{:else}
						<Eye class="w-4 h-4" />
					{/if}
				</button>
			</div>
			<p class="mt-1 text-xs text-text-secondary">Am Drucker-Display: Einstellungen → Netzwerk → Access Code</p>
			<p class="mt-1 text-xs text-yellow-400/90">⚠ Tippfalle: Im Code können <span class="font-mono font-bold">0</span> (Null) und <span class="font-mono font-bold">O</span> (großes O) sehr ähnlich aussehen. Am Drucker-Display sind sie klar unterscheidbar — zur Sicherheit dort gegenprüfen.</p>
		</div>
	</div>

	<div class="bg-bg-input/50 border border-border rounded-lg p-3 text-xs text-text-secondary">
		Hinweis: Für die Pre-Flight-Prüfung muss <span class="text-text-primary">LAN Mode</span> am Drucker aktiviert sein
		(Einstellungen → Netzwerk → LAN Mode).
	</div>

	<div class="flex justify-end">
		<button
			type="button"
			onclick={handleSubmit}
			disabled={!canSubmit}
			class="bg-accent text-white rounded-lg px-6 py-2 hover:bg-accent/90 transition-colors font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
		>
			Weiter — Pre-Flight prüfen
		</button>
	</div>
</div>

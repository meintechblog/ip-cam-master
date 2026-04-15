<script lang="ts">
	let {
		ip,
		prefillSerial = '',
		onSubmit
	}: {
		ip: string;
		prefillSerial?: string;
		onSubmit: (result: { serialNumber: string; accessCode: string }) => void;
	} = $props();

	let serialNumber = $state(prefillSerial);
	let accessCode = $state('');

	let canSubmit = $derived(serialNumber.trim().length > 0 && accessCode.trim().length > 0);

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
			<input
				id="bambu-code"
				type="text"
				bind:value={accessCode}
				autocomplete="off"
				inputmode="text"
				maxlength="8"
				placeholder="z.B. 12345678"
				class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent font-mono tracking-widest"
			/>
			<p class="mt-1 text-xs text-text-secondary">Am Drucker-Display: Einstellungen → Netzwerk → Access Code</p>
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

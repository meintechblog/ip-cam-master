<script lang="ts">
	let { data } = $props();

	let username = $state('');
	let password = $state('');
	let isYolo = $derived(!username && !password);
	let newPassword = $state('');
	let showDeleteConfirm = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);
	let loading = $state(false);

	async function submitForm(action: string, body: Record<string, string>) {
		loading = true;
		error = null;
		success = null;
		try {
			const formData = new FormData();
			for (const [k, v] of Object.entries(body)) formData.append(k, v);
			const res = await fetch(`/setup?/${action}`, { method: 'POST', body: formData });
			if (res.redirected) {
				window.location.href = res.url;
				return;
			}
			const json = await res.json();
			if (json.type === 'failure') {
				const parsed = JSON.parse(json.data);
				error = parsed[1] || 'Fehler';
			} else if (json.type === 'success' && json.data) {
				const parsed = JSON.parse(json.data);
				success = parsed[1] || 'Gespeichert.';
			}
		} catch { error = 'Fehler'; }
		finally { loading = false; }
	}

	function handleSetup() {
		if (isYolo) {
			submitForm('yolo', {});
		} else {
			submitForm('setup', { username, password });
		}
	}
</script>

<div class="min-h-screen flex items-center justify-center bg-bg-primary p-4">
	<div class="w-full max-w-md">
		<div class="bg-bg-secondary border border-border rounded-lg p-8">

			{#if error}
				<div class="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4 text-red-400 text-sm">{error}</div>
			{/if}
			{#if success}
				<div class="bg-green-500/10 border border-green-500/30 rounded-md p-3 mb-4 text-green-400 text-sm">{success}</div>
			{/if}

			{#if data.hasUser && data.isAuthenticated}
				<!-- Logged in: change password or delete account -->
				<h1 class="text-2xl font-bold text-text-primary mb-2">Zugangsschutz</h1>
				<p class="text-text-secondary text-sm mb-6">
					Eingeloggt als <span class="text-text-primary font-medium">{data.username}</span>
				</p>

				<div class="mb-6">
					<label for="newPassword" class="block text-sm font-medium text-text-secondary mb-1">Neues Passwort</label>
					<input
						id="newPassword"
						type="password"
						bind:value={newPassword}
						placeholder="••••••••"
						onkeydown={(e) => { if (e.key === 'Enter') submitForm('changePassword', { newPassword }); }}
						class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
					/>
					<button onclick={() => submitForm('changePassword', { newPassword })} disabled={loading}
						class="mt-3 w-full py-2 px-4 rounded-md font-medium bg-accent hover:bg-accent/90 text-white transition-colors cursor-pointer disabled:opacity-50">
						Passwort aendern
					</button>
				</div>

				<div class="border-t border-border pt-4">
					{#if !showDeleteConfirm}
						<button onclick={() => showDeleteConfirm = true}
							class="w-full py-2 px-4 rounded-md font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer">
							Zugangsschutz entfernen (YOLO)
						</button>
					{:else}
						<div class="bg-red-500/10 border border-red-500/30 rounded-md p-4">
							<p class="text-sm text-red-400 mb-3">Zugangsschutz wirklich entfernen?</p>
							<div class="flex gap-2">
								<button onclick={() => submitForm('deleteAccount', {})}
									class="flex-1 py-2 px-4 rounded-md font-medium bg-red-500 text-white hover:bg-red-600 cursor-pointer">Ja, entfernen</button>
								<button onclick={() => showDeleteConfirm = false}
									class="flex-1 py-2 px-4 rounded-md font-medium bg-bg-primary text-text-secondary hover:bg-bg-card cursor-pointer">Abbrechen</button>
							</div>
						</div>
					{/if}
				</div>

				<a href="/" class="block mt-4 text-center text-sm text-text-secondary hover:text-text-primary">Zurueck zur App</a>

			{:else}
				<!-- No user or YOLO mode: setup -->
				<h1 class="text-2xl font-bold text-text-primary mb-2">Zugangsschutz einrichten</h1>
				<p class="text-text-secondary text-sm mb-6">
					{#if data.isYolo}
						Die App laeuft ohne Schutz. Hier kannst du Zugangsdaten einrichten.
					{:else}
						Lege Zugangsdaten fest oder ueberspringe diesen Schritt.
					{/if}
				</p>

				<div class="space-y-4">
					<div>
						<label for="username" class="block text-sm font-medium text-text-secondary mb-1">Benutzername</label>
						<input id="username" type="text" bind:value={username} autocomplete="username" placeholder="admin"
							class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent" />
					</div>
					<div>
						<label for="password" class="block text-sm font-medium text-text-secondary mb-1">Passwort</label>
						<input id="password" type="password" bind:value={password} autocomplete="new-password" placeholder="••••••••"
							onkeydown={(e) => { if (e.key === 'Enter') handleSetup(); }}
							class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent" />
					</div>
				</div>

				<button onclick={handleSetup} disabled={loading}
					class="mt-6 w-full py-2 px-4 rounded-md font-medium transition-colors cursor-pointer disabled:opacity-50
						{isYolo ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : 'bg-accent hover:bg-accent/90 text-white'}">
					{isYolo ? 'YOLO — Ohne Schutz weiter' : 'Speichern'}
				</button>

				{#if !isYolo}
					<p class="mt-4 text-xs text-text-secondary text-center">Felder leer lassen fuer YOLO-Modus.</p>
				{/if}

				{#if data.isYolo}
					<a href="/" class="block mt-4 text-center text-sm text-text-secondary hover:text-text-primary">Zurueck zur App</a>
				{/if}
			{/if}
		</div>
	</div>
</div>

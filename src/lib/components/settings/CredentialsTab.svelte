<script lang="ts">
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import { Trash2, GripVertical, Plus, Loader2 } from 'lucide-svelte';

	let savedCreds = $state<{ id: number; name: string; username: string; passwordMasked: string; priority: number }[]>([]);
	let loading = $state(true);

	// New credential form
	let newName = $state('');
	let newUsername = $state('');
	let newPassword = $state('');
	let saving = $state(false);
	let feedback = $state<{ type: 'success' | 'error'; message: string } | null>(null);

	async function loadCredentials() {
		try {
			const res = await fetch('/api/credentials');
			if (res.ok) savedCreds = await res.json();
		} catch { /* ignore */ }
		finally { loading = false; }
	}

	$effect(() => { loadCredentials(); });

	async function handleAdd() {
		if (!newName || !newUsername || !newPassword) {
			feedback = { type: 'error', message: 'Alle Felder erforderlich.' };
			return;
		}
		saving = true;
		feedback = null;
		try {
			const res = await fetch('/api/credentials', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: newName, username: newUsername, password: newPassword })
			});
			const data = await res.json();
			if (data.success) {
				feedback = { type: 'success', message: `"${newName}" gespeichert.` };
				newName = '';
				newUsername = '';
				newPassword = '';
				await loadCredentials();
			} else {
				feedback = { type: 'error', message: data.error || 'Fehler' };
			}
		} catch {
			feedback = { type: 'error', message: 'Fehler beim Speichern.' };
		} finally {
			saving = false;
		}
	}

	async function handleDelete(id: number) {
		try {
			await fetch('/api/credentials', {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id })
			});
			await loadCredentials();
		} catch { /* ignore */ }
	}
</script>

<div class="space-y-6">
	<div class="bg-bg-primary/50 rounded-lg p-4 text-sm text-text-secondary">
		<p>Standard-Logins werden beim Hinzufügen neuer Kameras automatisch der Reihe nach durchprobiert. Die Reihenfolge bestimmt die Priorität.</p>
	</div>

	<!-- Saved credentials list -->
	{#if loading}
		<div class="flex items-center gap-2 text-text-secondary">
			<Loader2 class="w-4 h-4 animate-spin" />
			<span class="text-sm">Lade...</span>
		</div>
	{:else if savedCreds.length > 0}
		<div>
			<h3 class="text-sm font-medium text-text-secondary mb-2">Gespeicherte Logins ({savedCreds.length})</h3>
			<div class="space-y-2">
				{#each savedCreds as cred, i (cred.id)}
					<div class="flex items-center gap-3 bg-bg-input border border-border rounded-lg px-4 py-3">
						<span class="text-text-secondary/40 text-xs font-mono w-5 text-center">{i + 1}.</span>
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-3">
								<span class="text-text-primary text-sm font-medium">{cred.name}</span>
								<span class="text-text-secondary text-xs font-mono">{cred.username}</span>
								<span class="text-text-secondary/50 text-xs">{cred.passwordMasked}</span>
							</div>
						</div>
						<button
							onclick={() => handleDelete(cred.id)}
							class="text-text-secondary hover:text-red-400 transition-colors cursor-pointer shrink-0"
							title="Löschen"
						>
							<Trash2 class="w-4 h-4" />
						</button>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<p class="text-text-secondary text-sm">Noch keine Standard-Logins gespeichert.</p>
	{/if}

	<!-- Add new credential -->
	<div>
		<h3 class="text-sm font-medium text-text-secondary mb-2">Neues Login hinzufügen</h3>
		<div class="bg-bg-input border border-border rounded-lg p-4 space-y-3">
			<div class="grid grid-cols-3 gap-3">
				<div>
					<label for="cred_name" class="block text-xs text-text-secondary mb-1">Bezeichnung</label>
					<input
						id="cred_name"
						type="text"
						bind:value={newName}
						placeholder="z.B. Mobotix Standard"
						autocomplete="off"
						class="w-full bg-bg-primary border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
					/>
				</div>
				<div>
					<label for="cred_user" class="block text-xs text-text-secondary mb-1">Benutzername</label>
					<input
						id="cred_user"
						type="text"
						bind:value={newUsername}
						placeholder="admin"
						autocomplete="off"
						class="w-full bg-bg-primary border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
					/>
				</div>
				<div>
					<label for="cred_pass" class="block text-xs text-text-secondary mb-1">Passwort</label>
					<input
						id="cred_pass"
						type="password"
						bind:value={newPassword}
						placeholder="••••••••"
						autocomplete="off"
						class="w-full bg-bg-primary border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:border-accent"
					/>
				</div>
			</div>

			{#if feedback}
				<InlineAlert type={feedback.type} message={feedback.message} />
			{/if}

			<button
				type="button"
				onclick={handleAdd}
				disabled={saving}
				class="flex items-center gap-1.5 bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2 rounded-md text-sm disabled:opacity-50 transition-colors cursor-pointer"
			>
				{#if saving}
					<Loader2 class="w-4 h-4 animate-spin" />
				{:else}
					<Plus class="w-4 h-4" />
				{/if}
				Hinzufügen
			</button>
		</div>
	</div>
</div>

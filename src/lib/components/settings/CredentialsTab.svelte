<script lang="ts">
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import { Trash2 } from 'lucide-svelte';

	let {
		credentials = []
	}: { credentials: Array<{ name: string; username: string; cameraIp?: string }> } = $props();

	let name = $state('');
	let username = $state('');
	let password = $state('');
	let cameraIp = $state('');

	let saving = $state(false);
	let feedback: { type: 'success' | 'error'; message: string } | null = $state(null);
	let localCredentials = $state([...credentials]);

	async function handleAdd() {
		if (!name || !username || !password) {
			feedback = { type: 'error', message: 'Name, Benutzername und Passwort sind erforderlich.' };
			return;
		}

		saving = true;
		feedback = null;

		try {
			const body: Record<string, string> = {
				[`credential_${name}_username`]: username,
				[`credential_${name}_password`]: password
			};
			if (cameraIp) {
				body[`credential_${name}_ip`] = cameraIp;
			}

			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			const data = await res.json();

			if (data.saved) {
				localCredentials = [...localCredentials, { name, username, cameraIp: cameraIp || undefined }];
				feedback = { type: 'success', message: `Zugangsdaten "${name}" gespeichert.` };
				name = '';
				username = '';
				password = '';
				cameraIp = '';
			} else {
				feedback = { type: 'error', message: 'Fehler beim Speichern.' };
			}
		} catch (err) {
			feedback = { type: 'error', message: 'Fehler beim Speichern.' };
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-6 max-w-lg">
	{#if localCredentials.length > 0}
		<div>
			<h3 class="text-sm font-medium text-text-secondary mb-2">Gespeicherte Zugangsdaten</h3>
			<div class="space-y-2">
				{#each localCredentials as cred}
					<div
						class="flex items-center justify-between bg-bg-input border border-border rounded-md px-3 py-2"
					>
						<div>
							<span class="text-text-primary text-sm font-medium">{cred.name}</span>
							<span class="text-text-secondary text-xs ml-2">{cred.username}</span>
							{#if cred.cameraIp}
								<span class="text-text-secondary text-xs ml-2">{cred.cameraIp}</span>
							{/if}
						</div>
						<span class="text-xs text-text-secondary">********</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<div>
		<h3 class="text-sm font-medium text-text-secondary mb-2">Neue Zugangsdaten</h3>
		<form onsubmit={handleAdd} class="space-y-3">
			<div>
				<label for="cred_name" class="block text-sm font-medium text-text-secondary mb-1"
					>Name</label
				>
				<input
					id="cred_name"
					type="text"
					bind:value={name}
					placeholder="mobotix-22"
					class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
				/>
			</div>

			<div>
				<label for="cred_username" class="block text-sm font-medium text-text-secondary mb-1"
					>Benutzername</label
				>
				<input
					id="cred_username"
					type="text"
					bind:value={username}
					placeholder="admin"
					class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
				/>
			</div>

			<div>
				<label for="cred_password" class="block text-sm font-medium text-text-secondary mb-1"
					>Passwort</label
				>
				<input
					id="cred_password"
					type="password"
					bind:value={password}
					placeholder="••••••••"
					class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
				/>
			</div>

			<div>
				<label for="cred_ip" class="block text-sm font-medium text-text-secondary mb-1"
					>Kamera-IP (optional)</label
				>
				<input
					id="cred_ip"
					type="text"
					bind:value={cameraIp}
					placeholder="192.168.3.22"
					class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
				/>
			</div>

			{#if feedback}
				<InlineAlert type={feedback.type} message={feedback.message} />
			{/if}

			<button
				type="submit"
				disabled={saving}
				class="bg-accent hover:bg-accent/90 text-white font-medium px-4 py-2 rounded-md text-sm disabled:opacity-50 transition-colors"
			>
				{saving ? 'Speichern...' : 'Hinzufuegen'}
			</button>
		</form>
	</div>
</div>

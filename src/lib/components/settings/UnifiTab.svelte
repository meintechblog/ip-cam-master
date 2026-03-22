<script lang="ts">
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import type { UnifiSettings } from '$lib/types';

	let { initialValues = {} }: { initialValues: Partial<UnifiSettings> } = $props();

	let unifi_host = $state(initialValues.unifi_host ?? '');
	let unifi_username = $state(initialValues.unifi_username ?? '');
	let unifi_password = $state(initialValues.unifi_password ?? '');

	let saving = $state(false);
	let feedback: { type: 'success' | 'error'; message: string } | null = $state(null);

	async function handleSave() {
		saving = true;
		feedback = null;

		try {
			const res = await fetch('/api/settings', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					unifi_host,
					unifi_username,
					unifi_password
				})
			});

			const data = await res.json();

			if (data.saved) {
				feedback = { type: 'success', message: 'UniFi-Einstellungen gespeichert.' };
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

<form onsubmit={handleSave} class="space-y-4 max-w-lg">
	<div>
		<label for="unifi_host" class="block text-sm font-medium text-text-secondary mb-1"
			>UDM Host</label
		>
		<input
			id="unifi_host"
			type="text"
			bind:value={unifi_host}
			placeholder="192.168.3.1"
			class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
		/>
	</div>

	<div>
		<label for="unifi_username" class="block text-sm font-medium text-text-secondary mb-1"
			>Username</label
		>
		<input
			id="unifi_username"
			type="text"
			bind:value={unifi_username}
			placeholder="admin"
			class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
		/>
	</div>

	<div>
		<label for="unifi_password" class="block text-sm font-medium text-text-secondary mb-1"
			>Password</label
		>
		<input
			id="unifi_password"
			type="password"
			bind:value={unifi_password}
			placeholder="••••••••"
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
		{saving ? 'Speichern...' : 'Speichern'}
	</button>
</form>

<script lang="ts">
	import InlineAlert from '$lib/components/ui/InlineAlert.svelte';
	import type { ProxmoxSettings } from '$lib/types';

	let { initialValues = {} }: { initialValues: Partial<ProxmoxSettings> } = $props();

	let proxmox_host = $state(initialValues.proxmox_host ?? '');
	let proxmox_token_id = $state(initialValues.proxmox_token_id ?? '');
	let proxmox_token_secret = $state(initialValues.proxmox_token_secret ?? '');
	let proxmox_storage = $state(initialValues.proxmox_storage ?? 'local-lvm');
	let proxmox_bridge = $state(initialValues.proxmox_bridge ?? 'vmbr0');
	let proxmox_vmid_start = $state(initialValues.proxmox_vmid_start ?? '200');

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
					proxmox_host,
					proxmox_token_id,
					proxmox_token_secret,
					proxmox_storage,
					proxmox_bridge,
					proxmox_vmid_start
				})
			});

			const data = await res.json();

			if (data.validation?.valid) {
				feedback = {
					type: 'success',
					message: `Verbindung erfolgreich. Node: ${data.validation.nodeName}`
				};
			} else if (data.validation?.error) {
				feedback = { type: 'error', message: data.validation.error };
			} else if (data.saved) {
				feedback = { type: 'success', message: 'Einstellungen gespeichert.' };
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
		<label for="proxmox_host" class="block text-sm font-medium text-text-secondary mb-1"
			>Proxmox Host</label
		>
		<input
			id="proxmox_host"
			type="text"
			bind:value={proxmox_host}
			placeholder="192.168.3.16"
			class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
		/>
	</div>

	<div>
		<label for="proxmox_token_id" class="block text-sm font-medium text-text-secondary mb-1"
			>API Token ID</label
		>
		<input
			id="proxmox_token_id"
			type="text"
			bind:value={proxmox_token_id}
			placeholder="user@pve!tokenname"
			class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
		/>
		<p class="text-xs text-text-secondary mt-1">Format: user@realm!tokenname</p>
	</div>

	<div>
		<label for="proxmox_token_secret" class="block text-sm font-medium text-text-secondary mb-1"
			>API Token Secret</label
		>
		<input
			id="proxmox_token_secret"
			type="password"
			bind:value={proxmox_token_secret}
			placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
			class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
		/>
	</div>

	<div>
		<label for="proxmox_storage" class="block text-sm font-medium text-text-secondary mb-1"
			>Storage Target</label
		>
		<input
			id="proxmox_storage"
			type="text"
			bind:value={proxmox_storage}
			placeholder="local-lvm"
			class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
		/>
	</div>

	<div>
		<label for="proxmox_bridge" class="block text-sm font-medium text-text-secondary mb-1"
			>Network Bridge</label
		>
		<input
			id="proxmox_bridge"
			type="text"
			bind:value={proxmox_bridge}
			placeholder="vmbr0"
			class="w-full bg-bg-input border border-border text-text-primary rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
		/>
	</div>

	<div>
		<label for="proxmox_vmid_start" class="block text-sm font-medium text-text-secondary mb-1"
			>VMID Range Start</label
		>
		<input
			id="proxmox_vmid_start"
			type="number"
			bind:value={proxmox_vmid_start}
			placeholder="200"
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

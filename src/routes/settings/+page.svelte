<script lang="ts">
	import { enhance } from '$app/forms';
	import ProxmoxTab from '$lib/components/settings/ProxmoxTab.svelte';
	import UnifiTab from '$lib/components/settings/UnifiTab.svelte';
	import CredentialsTab from '$lib/components/settings/CredentialsTab.svelte';

	let { data, form } = $props();

	const tabs = ['Proxmox', 'UniFi', 'Credentials'] as const;
	let activeTab = $state<(typeof tabs)[number]>('Proxmox');

	let confirmRemove = $state(false);
</script>

<h1 class="text-2xl font-bold text-text-primary mb-6">Settings</h1>

<div class="border-b border-border mb-6">
	<div class="flex gap-0" role="tablist">
		{#each tabs as tab}
			<button
				role="tab"
				aria-selected={activeTab === tab}
				class="px-4 py-2 text-sm font-medium transition-colors border-b-2
					{activeTab === tab
					? 'border-accent text-text-primary'
					: 'border-transparent text-text-secondary hover:text-text-primary'}"
				onclick={() => (activeTab = tab)}
			>
				{tab}
			</button>
		{/each}
	</div>
</div>

<div>
	{#if activeTab === 'Proxmox'}
		<ProxmoxTab initialValues={data.proxmox} />
	{:else if activeTab === 'UniFi'}
		<UnifiTab initialValues={data.unifi} />
	{:else if activeTab === 'Credentials'}
		<CredentialsTab credentials={data.credentials} />
	{/if}
</div>

<!-- Zugangsschutz Section -->
<div class="mt-10 border-t border-border pt-6">
	<h2 class="text-lg font-semibold text-text-primary mb-4">Zugangsschutz</h2>

	{#if form?.authError}
		<div class="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4 text-red-400 text-sm">
			{form.authError}
		</div>
	{/if}

	{#if form?.authSuccess}
		<div class="bg-green-500/10 border border-green-500/30 rounded-md p-3 mb-4 text-green-400 text-sm">
			{form.authSuccess}
		</div>
	{/if}

	{#if data.authUser}
		<p class="text-sm text-text-secondary mb-4">
			Aktueller Benutzer: <span class="text-text-primary font-medium">{data.authUser.username}</span>
		</p>

		<!-- Change Username -->
		<form method="POST" action="?/changeUsername" use:enhance class="mb-4">
			<div class="flex gap-2 items-end">
				<div class="flex-1">
					<label for="newUsername" class="block text-sm text-text-secondary mb-1">Neuer Benutzername</label>
					<input
						id="newUsername"
						name="newUsername"
						type="text"
						class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary text-sm
							focus:outline-none focus:ring-2 focus:ring-accent"
					/>
				</div>
				<button type="submit" class="px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm rounded-md">
					Aendern
				</button>
			</div>
		</form>

		<!-- Change Password -->
		<form method="POST" action="?/changePassword" use:enhance class="mb-4">
			<div class="flex gap-2 items-end">
				<div class="flex-1">
					<label for="currentPassword" class="block text-sm text-text-secondary mb-1">Aktuelles Passwort</label>
					<input
						id="currentPassword"
						name="currentPassword"
						type="password"
						class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary text-sm
							focus:outline-none focus:ring-2 focus:ring-accent"
					/>
				</div>
				<div class="flex-1">
					<label for="newPassword" class="block text-sm text-text-secondary mb-1">Neues Passwort</label>
					<input
						id="newPassword"
						name="newPassword"
						type="password"
						class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary text-sm
							focus:outline-none focus:ring-2 focus:ring-accent"
					/>
				</div>
				<button type="submit" class="px-4 py-2 bg-accent hover:bg-accent/90 text-white text-sm rounded-md">
					Aendern
				</button>
			</div>
		</form>

		<!-- Remove Auth -->
		<div class="mt-6 pt-4 border-t border-border">
			{#if !confirmRemove}
				<button
					onclick={() => (confirmRemove = true)}
					class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md"
				>
					Zugang entfernen
				</button>
			{:else}
				<p class="text-sm text-red-400 mb-2">Sicher? Die App ist danach ohne Login erreichbar.</p>
				<form method="POST" action="?/removeAuth" use:enhance class="inline">
					<button type="submit" class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm rounded-md mr-2">
						Ja, entfernen
					</button>
				</form>
				<button
					onclick={() => (confirmRemove = false)}
					class="px-4 py-2 bg-bg-primary border border-border text-text-secondary text-sm rounded-md"
				>
					Abbrechen
				</button>
			{/if}
		</div>
	{:else}
		<p class="text-sm text-text-secondary">
			Kein Zugangsschutz aktiv (YOLO-Modus). Gehe zu <a href="/setup" class="text-accent hover:underline">/setup</a> um Zugangsdaten einzurichten.
		</p>
	{/if}
</div>

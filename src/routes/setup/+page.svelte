<script lang="ts">
	import { enhance } from '$app/forms';

	let { data, form } = $props();

	// For initial setup / YOLO→credentials
	let username = $state('');
	let password = $state('');
	let isYolo = $derived(!username && !password);

	// For password change
	let newPassword = $state('');

	// For delete confirm
	let showDeleteConfirm = $state(false);
</script>

<div class="min-h-screen flex items-center justify-center bg-bg-primary p-4">
	<div class="w-full max-w-md">
		<div class="bg-bg-secondary border border-border rounded-lg p-8">

			{#if data.hasUser && data.isAuthenticated}
				<!-- Logged in: change password or delete account -->
				<h1 class="text-2xl font-bold text-text-primary mb-2">Zugangsschutz</h1>
				<p class="text-text-secondary text-sm mb-6">
					Eingeloggt als <span class="text-text-primary font-medium">{data.username}</span>
				</p>

				{#if form?.error}
					<div class="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4 text-red-400 text-sm">{form.error}</div>
				{/if}
				{#if form?.success}
					<div class="bg-green-500/10 border border-green-500/30 rounded-md p-3 mb-4 text-green-400 text-sm">{form.success}</div>
				{/if}

				<!-- Change password -->
				<form method="POST" action="?/changePassword" use:enhance class="mb-6">
					<label for="newPassword" class="block text-sm font-medium text-text-secondary mb-1">Neues Passwort</label>
					<input
						id="newPassword"
						name="newPassword"
						type="password"
						bind:value={newPassword}
						placeholder="••••••••"
						class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
					/>
					<button type="submit" class="mt-3 w-full py-2 px-4 rounded-md font-medium bg-accent hover:bg-accent/90 text-white transition-colors">
						Passwort aendern
					</button>
				</form>

				<!-- Delete account -->
				<div class="border-t border-border pt-4">
					{#if !showDeleteConfirm}
						<button
							onclick={() => showDeleteConfirm = true}
							class="w-full py-2 px-4 rounded-md font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors cursor-pointer"
						>
							Zugangsschutz entfernen (YOLO)
						</button>
					{:else}
						<div class="bg-red-500/10 border border-red-500/30 rounded-md p-4">
							<p class="text-sm text-red-400 mb-3">Zugangsschutz wirklich entfernen? Die App ist dann ohne Login zugaenglich.</p>
							<div class="flex gap-2">
								<form method="POST" action="?/deleteAccount" use:enhance class="flex-1">
									<button type="submit" class="w-full py-2 px-4 rounded-md font-medium bg-red-500 text-white hover:bg-red-600 transition-colors">
										Ja, entfernen
									</button>
								</form>
								<button onclick={() => showDeleteConfirm = false} class="flex-1 py-2 px-4 rounded-md font-medium bg-bg-primary text-text-secondary hover:bg-bg-card transition-colors cursor-pointer">
									Abbrechen
								</button>
							</div>
						</div>
					{/if}
				</div>

				<a href="/" class="block mt-4 text-center text-sm text-text-secondary hover:text-text-primary">Zurueck zur App</a>

			{:else}
				<!-- No user or YOLO mode: initial setup -->
				<h1 class="text-2xl font-bold text-text-primary mb-2">Zugangsschutz einrichten</h1>
				<p class="text-text-secondary text-sm mb-6">
					{#if data.isYolo}
						Die App laeuft im YOLO-Modus (ohne Schutz). Hier kannst du Zugangsdaten einrichten.
					{:else}
						Lege einen Benutzernamen und ein Passwort fest, oder ueberspringe diesen Schritt.
					{/if}
				</p>

				{#if form?.error}
					<div class="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4 text-red-400 text-sm">{form.error}</div>
				{/if}

				<form method="POST" action={isYolo ? '?/yolo' : '?/setup'} use:enhance>
					<div class="space-y-4">
						<div>
							<label for="username" class="block text-sm font-medium text-text-secondary mb-1">Benutzername</label>
							<input
								id="username"
								name="username"
								type="text"
								autocomplete="username"
								bind:value={username}
								placeholder="admin"
								class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
							/>
						</div>
						<div>
							<label for="password" class="block text-sm font-medium text-text-secondary mb-1">Passwort</label>
							<input
								id="password"
								name="password"
								type="password"
								autocomplete="new-password"
								bind:value={password}
								placeholder="••••••••"
								class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
							/>
						</div>
					</div>

					<button
						type="submit"
						class="mt-6 w-full py-2 px-4 rounded-md font-medium transition-colors
							{isYolo ? 'bg-yellow-600 hover:bg-yellow-700 text-white' : 'bg-accent hover:bg-accent/90 text-white'}"
					>
						{isYolo ? 'YOLO — Ohne Schutz weiter' : 'Speichern'}
					</button>
				</form>

				{#if !isYolo}
					<p class="mt-4 text-xs text-text-secondary text-center">
						Lasse beide Felder leer fuer den YOLO-Button.
					</p>
				{/if}

				{#if data.isYolo}
					<a href="/" class="block mt-4 text-center text-sm text-text-secondary hover:text-text-primary">Zurueck zur App</a>
				{/if}
			{/if}
		</div>
	</div>
</div>

<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();

	let username = $state('');
	let password = $state('');

	let isYolo = $derived(!username && !password);
</script>

<div class="min-h-screen flex items-center justify-center bg-bg-primary p-4">
	<div class="w-full max-w-md">
		<div class="bg-bg-secondary border border-border rounded-lg p-8">
			<h1 class="text-2xl font-bold text-text-primary mb-2">Zugangsschutz einrichten</h1>
			<p class="text-text-secondary text-sm mb-6">
				Lege einen Benutzernamen und ein Passwort fest, um den Zugang zur App zu schuetzen.
				Oder ueberspringe diesen Schritt, wenn du im lokalen Netzwerk keinen Schutz brauchst.
			</p>

			{#if form?.error}
				<div class="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4 text-red-400 text-sm">
					{form.error}
				</div>
			{/if}

			<form method="POST" action={isYolo ? '?/yolo' : '?/setup'} use:enhance>
				<div class="space-y-4">
					<div>
						<label for="username" class="block text-sm font-medium text-text-secondary mb-1">
							Benutzername
						</label>
						<input
							id="username"
							name="username"
							type="text"
							autocomplete="username"
							bind:value={username}
							placeholder="admin"
							class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary
								placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
						/>
					</div>

					<div>
						<label for="password" class="block text-sm font-medium text-text-secondary mb-1">
							Passwort
						</label>
						<input
							id="password"
							name="password"
							type="password"
							autocomplete="new-password"
							bind:value={password}
							placeholder="••••••••"
							class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary
								placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
						/>
					</div>
				</div>

				<button
					type="submit"
					class="mt-6 w-full py-2 px-4 rounded-md font-medium transition-colors
						{isYolo
						? 'bg-yellow-600 hover:bg-yellow-700 text-white'
						: 'bg-accent hover:bg-accent/90 text-white'}"
				>
					{isYolo ? 'YOLO — Ohne Schutz weiter' : 'Speichern'}
				</button>
			</form>

			{#if !isYolo}
				<p class="mt-4 text-xs text-text-secondary text-center">
					Lasse beide Felder leer und klicke den Button, um ohne Zugangsschutz fortzufahren.
				</p>
			{/if}
		</div>
	</div>
</div>

<script lang="ts">
	import { enhance } from '$app/forms';

	let { form } = $props();
</script>

<div class="min-h-screen flex items-center justify-center bg-bg-primary p-4">
	<div class="w-full max-w-md">
		<div class="bg-bg-secondary border border-border rounded-lg p-8">
			<h1 class="text-2xl font-bold text-text-primary mb-6">Anmelden</h1>

			{#if form?.error}
				<div class="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4 text-red-400 text-sm">
					{form.error}
				</div>
			{/if}

			<form method="POST" use:enhance>
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
							required
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
							autocomplete="current-password"
							required
							class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary
								placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
						/>
					</div>
				</div>

				<button
					type="submit"
					class="mt-6 w-full py-2 px-4 bg-accent hover:bg-accent/90 text-white rounded-md font-medium transition-colors"
				>
					Anmelden
				</button>
			</form>
		</div>
	</div>
</div>

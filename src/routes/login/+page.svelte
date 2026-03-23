<script lang="ts">
	import { goto } from '$app/navigation';

	let username = $state('');
	let password = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	async function handleLogin() {
		if (!username || !password) {
			error = 'Benutzername und Passwort eingeben.';
			return;
		}
		loading = true;
		error = null;

		const formData = new FormData();
		formData.append('username', username);
		formData.append('password', password);

		try {
			const res = await fetch('/login', {
				method: 'POST',
				body: formData,
				redirect: 'follow'
			});

			if (res.redirected) {
				window.location.href = res.url;
				return;
			}

			const data = await res.json();
			if (data.type === 'failure') {
				const parsed = JSON.parse(data.data);
				error = parsed[1] || 'Anmeldung fehlgeschlagen.';
			}
		} catch {
			error = 'Anmeldung fehlgeschlagen.';
		} finally {
			loading = false;
		}
	}
</script>

<div class="min-h-screen flex items-center justify-center bg-bg-primary p-4">
	<div class="w-full max-w-md">
		<div class="bg-bg-secondary border border-border rounded-lg p-8">
			<h1 class="text-2xl font-bold text-text-primary mb-6">Anmelden</h1>

			{#if error}
				<div class="bg-red-500/10 border border-red-500/30 rounded-md p-3 mb-4 text-red-400 text-sm">
					{error}
				</div>
			{/if}

			<div class="space-y-4">
				<div>
					<label for="username" class="block text-sm font-medium text-text-secondary mb-1">Benutzername</label>
					<input
						id="username"
						type="text"
						bind:value={username}
						autocomplete="username"
						onkeydown={(e) => { if (e.key === 'Enter') handleLogin(); }}
						class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
					/>
				</div>
				<div>
					<label for="password" class="block text-sm font-medium text-text-secondary mb-1">Passwort</label>
					<input
						id="password"
						type="password"
						bind:value={password}
						autocomplete="current-password"
						onkeydown={(e) => { if (e.key === 'Enter') handleLogin(); }}
						class="w-full px-3 py-2 bg-bg-primary border border-border rounded-md text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:ring-2 focus:ring-accent"
					/>
				</div>
			</div>

			<button
				type="button"
				onclick={handleLogin}
				disabled={loading}
				class="mt-6 w-full py-2 px-4 bg-accent hover:bg-accent/90 text-white rounded-md font-medium transition-colors disabled:opacity-50 cursor-pointer"
			>
				{loading ? 'Anmelden...' : 'Anmelden'}
			</button>
		</div>
	</div>
</div>

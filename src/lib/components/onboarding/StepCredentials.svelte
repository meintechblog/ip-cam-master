<script lang="ts">
	let {
		ip = $bindable(''),
		username = $bindable('admin'),
		password = $bindable('meinsm'),
		name = $bindable(''),
		width = $bindable(1280),
		height = $bindable(720),
		fps = $bindable(20),
		bitrate = $bindable(5000),
		onSubmit
	}: {
		ip: string;
		username: string;
		password: string;
		name: string;
		width: number;
		height: number;
		fps: number;
		bitrate: number;
		onSubmit: () => void;
	} = $props();

	function handleSubmit(e: Event) {
		e.preventDefault();
		onSubmit();
	}
</script>

<form onsubmit={handleSubmit} class="space-y-6">
	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div>
			<label for="cam-name" class="block text-sm font-medium text-text-secondary mb-1">Kamera-Name</label>
			<input
				id="cam-name"
				type="text"
				bind:value={name}
				required
				placeholder="z.B. Einfahrt Mobotix"
				class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
			/>
		</div>
		<div>
			<label for="cam-ip" class="block text-sm font-medium text-text-secondary mb-1">Kamera-IP</label>
			<input
				id="cam-ip"
				type="text"
				bind:value={ip}
				required
				placeholder="192.168.3.22"
				class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary placeholder:text-text-secondary/50 focus:outline-none focus:border-accent"
			/>
		</div>
	</div>

	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div>
			<label for="cam-user" class="block text-sm font-medium text-text-secondary mb-1">Benutzername</label>
			<input
				id="cam-user"
				type="text"
				bind:value={username}
				required
				class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
			/>
		</div>
		<div>
			<label for="cam-pass" class="block text-sm font-medium text-text-secondary mb-1">Passwort</label>
			<input
				id="cam-pass"
				type="password"
				bind:value={password}
				required
				class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
			/>
		</div>
	</div>

	<div>
		<h3 class="text-sm font-medium text-text-secondary mb-3">Transcode-Parameter (optional)</h3>
		<div class="grid grid-cols-2 md:grid-cols-4 gap-4">
			<div>
				<label for="cam-width" class="block text-xs text-text-secondary mb-1">Breite</label>
				<input
					id="cam-width"
					type="number"
					bind:value={width}
					class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
				/>
			</div>
			<div>
				<label for="cam-height" class="block text-xs text-text-secondary mb-1">Hoehe</label>
				<input
					id="cam-height"
					type="number"
					bind:value={height}
					class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
				/>
			</div>
			<div>
				<label for="cam-fps" class="block text-xs text-text-secondary mb-1">FPS</label>
				<input
					id="cam-fps"
					type="number"
					bind:value={fps}
					class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
				/>
			</div>
			<div>
				<label for="cam-bitrate" class="block text-xs text-text-secondary mb-1">Bitrate kbit/s</label>
				<input
					id="cam-bitrate"
					type="number"
					bind:value={bitrate}
					class="w-full bg-bg-input border border-border rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:border-accent"
				/>
			</div>
		</div>
	</div>

	<div class="flex justify-end">
		<button
			type="submit"
			class="bg-accent text-white rounded-lg px-6 py-2 hover:bg-accent/90 transition-colors font-medium"
		>
			Weiter
		</button>
	</div>
</form>

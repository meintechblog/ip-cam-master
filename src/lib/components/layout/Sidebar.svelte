<script lang="ts">
	import { page } from '$app/stores';
	import { Camera, LayoutDashboard, Monitor, Settings, ScrollText, LogOut, Shield } from 'lucide-svelte';

	let { username = null, authenticated = false }: { username?: string | null; authenticated?: boolean } = $props();

	const links = [
		{ href: '/', label: 'Dashboard', icon: LayoutDashboard },
		{ href: '/kameras', label: 'Kameras', icon: Monitor },
		{ href: '/settings', label: 'Settings', icon: Settings },
		{ href: '/logs', label: 'Logs', icon: ScrollText }
	];

	function isActive(pathname: string, href: string): boolean {
		if (href === '/') return pathname === '/';
		return pathname.startsWith(href);
	}
</script>

<aside class="w-56 bg-bg-secondary border-r border-border flex flex-col h-full shrink-0">
	<div class="flex items-center gap-2 px-4 py-5 border-b border-border">
		<Camera class="w-6 h-6 text-accent" />
		<span class="text-lg font-bold text-text-primary">IP-Cam-Master</span>
	</div>

	<nav class="flex flex-col gap-1 p-3 flex-1">
		{#each links as link}
			{@const active = isActive($page.url.pathname, link.href)}
			<a
				href={link.href}
				class="flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors
					{active
					? 'bg-accent/10 text-accent border-l-2 border-accent'
					: 'text-text-secondary hover:text-text-primary hover:bg-bg-card'}"
			>
				<link.icon class="w-5 h-5" />
				{link.label}
			</a>
		{/each}
	</nav>

	<!-- Auth section at bottom -->
	<div class="p-3 border-t border-border">
		{#if username}
			<div class="flex items-center justify-between px-3 py-2">
				<span class="text-xs text-text-secondary truncate">{username}</span>
				<div class="flex gap-1">
					<a href="/setup" class="text-text-secondary hover:text-text-primary" title="Zugang aendern">
						<Shield class="w-4 h-4" />
					</a>
					<a href="/api/auth?action=logout" class="text-text-secondary hover:text-red-400" title="Logout" data-sveltekit-preload-data="off">
						<LogOut class="w-4 h-4" />
					</a>
				</div>
			</div>
		{:else if authenticated}
			<div class="flex items-center justify-between px-3 py-2">
				<span class="text-xs text-yellow-400">YOLO-Modus</span>
				<a href="/setup" class="text-text-secondary hover:text-text-primary text-xs" title="Zugang einrichten">
					<Shield class="w-4 h-4" />
				</a>
			</div>
		{/if}
	</div>
</aside>

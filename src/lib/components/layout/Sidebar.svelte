<script lang="ts">
	import { page } from '$app/stores';
	import { Camera, LayoutDashboard, Monitor, Settings, ScrollText } from 'lucide-svelte';

	let { onNavigate = () => {} }: { onNavigate?: () => void } = $props();

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
				onclick={onNavigate}
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

	{#if $page.data.isYolo}
		<div class="px-4 py-3 border-t border-border">
			<span class="inline-block px-2 py-0.5 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded">
				YOLO
			</span>
		</div>
	{:else if $page.data.user}
		<div class="px-4 py-3 border-t border-border flex items-center justify-between">
			<span class="text-sm text-text-secondary truncate">{$page.data.user.username}</span>
			<form method="POST" action="/api/auth/logout">
				<button
					type="submit"
					class="text-xs text-text-secondary hover:text-text-primary transition-colors"
				>
					Abmelden
				</button>
			</form>
		</div>
	{/if}
</aside>

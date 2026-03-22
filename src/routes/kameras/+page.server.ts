import { listContainers } from '$lib/server/services/proxmox';
import { getSettings } from '$lib/server/services/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const settings = await getSettings('proxmox_');
		const proxmoxConfigured = !!(settings.proxmox_host && settings.proxmox_token_id && settings.proxmox_token_secret);
		const containers = proxmoxConfigured ? await listContainers() : [];
		return { containers, error: null, proxmoxConfigured };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Container konnten nicht geladen werden';
		return { containers: [], error: message, proxmoxConfigured: false };
	}
};

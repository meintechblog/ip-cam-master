import { getSettings } from '$lib/server/services/settings';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async () => {
	const proxmox = await getSettings('proxmox_');
	const unifi = await getSettings('unifi_');
	return {
		configured: {
			proxmox: !!(proxmox.proxmox_host && proxmox.proxmox_token_id && proxmox.proxmox_token_secret),
			unifi: !!(unifi.unifi_host && unifi.unifi_username)
		}
	};
};

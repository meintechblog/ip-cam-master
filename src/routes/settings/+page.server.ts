import type { PageServerLoad } from './$types';
import { getSettings } from '$lib/server/services/settings';

export const load: PageServerLoad = async () => {
	const proxmox = await getSettings('proxmox_');
	const unifi = await getSettings('unifi_');
	return { proxmox, unifi };
};

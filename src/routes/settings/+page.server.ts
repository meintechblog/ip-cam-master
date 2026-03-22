import { getSettings } from '$lib/server/services/settings';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const proxmox = await getSettings('proxmox_');
	const unifi = await getSettings('unifi_');
	const allSettings = await getSettings('credential_');

	// Parse credential settings into structured list
	const credentialNames = new Set<string>();
	for (const key of Object.keys(allSettings)) {
		const match = key.match(/^credential_(.+?)_(username|password|ip)$/);
		if (match) credentialNames.add(match[1]);
	}
	const credentials = [...credentialNames].map((name) => ({
		name,
		username: allSettings[`credential_${name}_username`] || '',
		cameraIp: allSettings[`credential_${name}_ip`] || ''
	}));

	return { proxmox, unifi, credentials };
};

import { listContainers } from '$lib/server/services/proxmox';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	try {
		const containers = await listContainers();
		return { containers, error: null };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : 'Container konnten nicht geladen werden';
		return { containers: [], error: message };
	}
};

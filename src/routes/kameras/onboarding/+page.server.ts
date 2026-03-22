import type { PageServerLoad } from './$types';
import { getNextVmid } from '$lib/server/services/onboarding';

export const load: PageServerLoad = async () => {
	const nextVmid = await getNextVmid();
	return { nextVmid };
};

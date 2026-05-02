// v1.3 Phase 20 — Wizard data loader for bridge onboarding (Steps 1-2).
// Redirects to /settings if bridge is already running (wizard complete for P20).
import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { getSettings } from '$lib/server/services/settings';
import { getBridgeStatus } from '$lib/server/orchestration/protect-hub/bridge-lifecycle';

export const load: PageServerLoad = async () => {
	const bridge = getBridgeStatus();
	// If bridge is running, wizard is done — go back to settings
	if (bridge?.status === 'running') {
		redirect(303, '/settings');
	}

	const unifi = await getSettings('unifi_');
	const credsConfigured = !!(unifi.unifi_host && unifi.unifi_username && unifi.unifi_password);

	return {
		credsConfigured,
		bridge
	};
};

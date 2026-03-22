import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { testMobotixConnection } from '$lib/server/services/onboarding';

export const POST: RequestHandler = async ({ request }) => {
	const { ip, username, password } = await request.json();
	if (!ip || !username || !password) {
		return json({ success: false, error: 'IP, Username und Passwort erforderlich' }, { status: 400 });
	}
	try {
		const result = await testMobotixConnection(ip, username, password);
		return json(result);
	} catch (err) {
		return json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
	}
};

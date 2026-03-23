import { json, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { destroySession } from '$lib/server/services/auth';

export const POST: RequestHandler = async ({ cookies, request }) => {
	const data = await request.json().catch(() => ({}));
	const action = data.action;

	if (action === 'logout') {
		const token = cookies.get('session');
		if (token) {
			destroySession(token);
		}
		cookies.delete('session', { path: '/' });
		return json({ success: true });
	}

	return json({ error: 'Unknown action' }, { status: 400 });
};

import { startScheduler } from '$lib/server/services/scheduler';
import { validateSession, isYoloMode, getUser } from '$lib/server/services/auth';
import { isPublicPath } from '$lib/config/routes';
import type { Handle } from '@sveltejs/kit';

startScheduler();

export const handle: Handle = async ({ event, resolve }) => {
	if (isPublicPath(event.url.pathname)) {
		return resolve(event);
	}

	// YOLO mode skips all auth (per D-23)
	if (isYoloMode()) {
		return resolve(event);
	}

	// No user exists -> redirect to setup (per D-22)
	const user = getUser();
	if (!user) {
		return new Response(null, { status: 303, headers: { location: '/setup' } });
	}

	// Check session cookie
	const sessionId = event.cookies.get('session');
	if (!sessionId) {
		return new Response(null, { status: 303, headers: { location: '/login' } });
	}

	const session = validateSession(sessionId);
	if (!session) {
		event.cookies.delete('session', { path: '/' });
		return new Response(null, { status: 303, headers: { location: '/login' } });
	}

	// Attach user to locals for downstream use
	event.locals.user = session;
	return resolve(event);
};

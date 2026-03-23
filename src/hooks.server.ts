import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { validateSession, getSessionUsername, isSetupComplete, isYoloMode } from '$lib/server/services/auth';

const PUBLIC_PATHS = ['/login', '/setup', '/api/auth'];

function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

function isStaticAsset(pathname: string): boolean {
	return pathname.startsWith('/_app/') || pathname.startsWith('/favicon');
}

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	// Always allow static assets
	if (isStaticAsset(pathname)) {
		return resolve(event);
	}

	const setupComplete = isSetupComplete();
	const yolo = await isYoloMode();

	// Set locals for downstream use
	event.locals.setupComplete = setupComplete;
	event.locals.authenticated = false;
	event.locals.username = null;

	// YOLO mode: skip all auth checks
	if (yolo) {
		event.locals.authenticated = true;
		// If user navigates to setup but YOLO is on, redirect to home
		if (pathname === '/setup') {
			throw redirect(303, '/');
		}
		return resolve(event);
	}

	// No user exists yet: redirect everything to /setup
	if (!setupComplete) {
		if (pathname !== '/setup') {
			throw redirect(303, '/setup');
		}
		return resolve(event);
	}

	// User exists: check session
	const sessionToken = event.cookies.get('session');
	if (sessionToken && validateSession(sessionToken)) {
		event.locals.authenticated = true;
		event.locals.username = getSessionUsername(sessionToken);

		// Authenticated user trying to access setup/login, redirect to home
		if (pathname === '/setup' || pathname === '/login') {
			throw redirect(303, '/');
		}
		return resolve(event);
	}

	// Not authenticated: allow public paths
	if (isPublicPath(pathname)) {
		return resolve(event);
	}

	// Redirect to login
	throw redirect(303, '/login');
};

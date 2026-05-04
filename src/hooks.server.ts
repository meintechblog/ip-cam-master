import { startScheduler } from '$lib/server/services/scheduler';
import { validateSession, isYoloMode, getUser } from '$lib/server/services/auth';
import {
	ensureUpdateScriptInstalled,
	ensureUpdaterUnitInstalled
} from '$lib/server/services/update-runner';
import { reconcileRunningEntries } from '$lib/server/services/update-history';
import { initUpdateStateStore } from '$lib/server/services/update-state-store';
import { startUpdateChecker } from '$lib/server/services/update-checker';
import { isPublicPath } from '$lib/config/routes';
import type { Handle } from '@sveltejs/kit';

initUpdateStateStore();
startScheduler();
ensureUpdateScriptInstalled().catch((err) =>
	console.error('[update] script install failed', err)
);
ensureUpdaterUnitInstalled().catch((err) =>
	console.error('[update] updater unit install failed', err)
);
reconcileRunningEntries()
	.then((n) => {
		if (n > 0) console.log(`[update] reconciled ${n} orphaned running entries`);
	})
	.catch((err) => console.error('[update] reconcile failed', err));
startUpdateChecker();

// Respond to SIGTERM so systemd restarts finish in seconds, not 90s (the default
// TimeoutStopSec before SIGKILL). Without this, `systemctl restart ip-cam-master`
// triggered from Phase 09's self-update hangs during the stop phase.
const shutdown = (signal: string) => {
	console.log(`[shutdown] received ${signal}, exiting`);
	process.exit(0);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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

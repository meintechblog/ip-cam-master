import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { isSetupComplete, getUser, verifyPassword, createSession } from '$lib/server/services/auth';
import { db } from '$lib/server/db/client';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.setupComplete) {
		throw redirect(303, '/setup');
	}
	if (locals.authenticated) {
		throw redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = data.get('username')?.toString().trim();
		const password = data.get('password')?.toString();

		if (!username || !password) {
			return fail(400, { error: 'Benutzername und Passwort eingeben.' });
		}

		// Find user
		const rows = db.select().from(users).where(eq(users.username, username)).all();
		if (rows.length === 0) {
			return fail(401, { error: 'Ungueltige Anmeldedaten.' });
		}

		const user = rows[0];
		if (!verifyPassword(password, user.passwordHash)) {
			return fail(401, { error: 'Ungueltige Anmeldedaten.' });
		}

		const token = createSession(username);
		cookies.set('session', token, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 // 24 hours
		});

		throw redirect(303, '/');
	}
};

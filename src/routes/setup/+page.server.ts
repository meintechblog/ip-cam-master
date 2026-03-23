import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { isSetupComplete, createUser, setYoloMode, isYoloMode, getUser, deleteUser, verifyPassword } from '$lib/server/services/auth';

export const load: PageServerLoad = async ({ locals }) => {
	const user = getUser();
	const yolo = await isYoloMode();
	return {
		hasUser: !!user,
		username: user?.username || null,
		isYolo: yolo,
		isAuthenticated: locals.authenticated
	};
};

export const actions: Actions = {
	// Initial setup or create new user (from YOLO mode)
	setup: async ({ request }) => {
		const data = await request.formData();
		const username = data.get('username')?.toString().trim();
		const password = data.get('password')?.toString();

		if (!username || !password) {
			return fail(400, { error: 'Benutzername und Passwort sind erforderlich.' });
		}
		if (password.length < 4) {
			return fail(400, { error: 'Passwort muss mindestens 4 Zeichen lang sein.' });
		}

		createUser(username, password);
		await setYoloMode(false);
		throw redirect(303, '/login');
	},

	// YOLO mode — skip auth
	yolo: async () => {
		deleteUser();
		await setYoloMode(true);
		throw redirect(303, '/');
	},

	// Change password (authenticated user)
	changePassword: async ({ request, locals }) => {
		if (!locals.authenticated) throw redirect(303, '/login');

		const data = await request.formData();
		const newPassword = data.get('newPassword')?.toString();

		if (!newPassword || newPassword.length < 4) {
			return fail(400, { error: 'Neues Passwort muss mindestens 4 Zeichen lang sein.' });
		}

		const user = getUser();
		if (!user) return fail(400, { error: 'Kein Benutzer vorhanden.' });

		createUser(user.username, newPassword);
		return { success: 'Passwort geaendert.' };
	},

	// Delete user → back to YOLO
	deleteAccount: async ({ locals }) => {
		if (!locals.authenticated) throw redirect(303, '/login');

		deleteUser();
		await setYoloMode(true);
		throw redirect(303, '/');
	}
};

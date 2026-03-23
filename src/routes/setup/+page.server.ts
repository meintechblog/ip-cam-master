import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { isSetupComplete, createUser, setYoloMode } from '$lib/server/services/auth';

export const load: PageServerLoad = async () => {
	if (isSetupComplete()) {
		throw redirect(303, '/');
	}
	return {};
};

export const actions: Actions = {
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
		throw redirect(303, '/login');
	},

	yolo: async () => {
		await setYoloMode(true);
		throw redirect(303, '/');
	}
};

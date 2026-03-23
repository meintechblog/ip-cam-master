import type { PageServerLoad, Actions } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getSettings, saveSetting } from '$lib/server/services/settings';
import { getUser, createUser, deleteUser, verifyPassword, isYoloMode } from '$lib/server/services/auth';

export const load: PageServerLoad = async () => {
	const proxmox = await getSettings('proxmox_');
	const unifi = await getSettings('unifi_');
	const user = getUser();
	return {
		proxmox,
		unifi,
		hasUser: user !== null,
		authUsername: user?.username ?? null,
		isYolo: isYoloMode()
	};
};

export const actions: Actions = {
	changePassword: async ({ request }) => {
		const data = await request.formData();
		const currentPassword = data.get('currentPassword')?.toString() ?? '';
		const newPassword = data.get('newPassword')?.toString() ?? '';

		if (!currentPassword || !newPassword) {
			return fail(400, { authError: 'Alle Felder sind erforderlich.', authAction: 'changePassword' });
		}
		if (newPassword.length < 6) {
			return fail(400, { authError: 'Neues Passwort muss mindestens 6 Zeichen lang sein.', authAction: 'changePassword' });
		}

		const user = getUser();
		if (!user) {
			return fail(400, { authError: 'Kein Benutzer vorhanden.', authAction: 'changePassword' });
		}
		if (!verifyPassword(currentPassword, user.passwordHash)) {
			return fail(400, { authError: 'Aktuelles Passwort ist falsch.', authAction: 'changePassword' });
		}

		createUser(user.username, newPassword);
		return { authSuccess: 'Passwort wurde geaendert.', authAction: 'changePassword' };
	},

	deleteAuth: async ({ cookies }) => {
		deleteUser();
		await saveSetting('auth_yolo', 'false');
		cookies.delete('session', { path: '/' });
		redirect(303, '/setup');
	},

	toggleYolo: async () => {
		const currentYolo = isYoloMode();
		await saveSetting('auth_yolo', currentYolo ? 'false' : 'true');
		return { authSuccess: currentYolo ? 'YOLO-Modus deaktiviert.' : 'YOLO-Modus aktiviert.', authAction: 'toggleYolo' };
	}
};

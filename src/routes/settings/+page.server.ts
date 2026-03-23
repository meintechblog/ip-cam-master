import { fail } from '@sveltejs/kit';
import { getSettings } from '$lib/server/services/settings';
import { getUser, createUser, deleteUser, setYoloMode, verifyPassword, hashPassword } from '$lib/server/services/auth';
import { db } from '$lib/server/db/client';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
	const proxmox = await getSettings('proxmox_');
	const unifi = await getSettings('unifi_');
	const allSettings = await getSettings('credential_');

	// Parse credential settings into structured list
	const credentialNames = new Set<string>();
	for (const key of Object.keys(allSettings)) {
		const match = key.match(/^credential_(.+?)_(username|password|ip)$/);
		if (match) credentialNames.add(match[1]);
	}
	const credentials = [...credentialNames].map((name) => ({
		name,
		username: allSettings[`credential_${name}_username`] || '',
		cameraIp: allSettings[`credential_${name}_ip`] || ''
	}));

	const user = getUser();

	return { proxmox, unifi, credentials, authUser: user };
};

export const actions: Actions = {
	changePassword: async ({ request }) => {
		const data = await request.formData();
		const currentPassword = data.get('currentPassword')?.toString();
		const newPassword = data.get('newPassword')?.toString();

		if (!currentPassword || !newPassword) {
			return fail(400, { authError: 'Alle Felder ausfuellen.' });
		}

		if (newPassword.length < 4) {
			return fail(400, { authError: 'Neues Passwort muss mindestens 4 Zeichen lang sein.' });
		}

		const user = getUser();
		if (!user) {
			return fail(400, { authError: 'Kein Benutzer vorhanden.' });
		}

		// Verify current password
		const rows = db.select().from(users).where(eq(users.username, user.username)).all();
		if (rows.length === 0 || !verifyPassword(currentPassword, rows[0].passwordHash)) {
			return fail(401, { authError: 'Aktuelles Passwort ist falsch.' });
		}

		// Update password
		const newHash = hashPassword(newPassword);
		db.update(users)
			.set({ passwordHash: newHash, updatedAt: new Date().toISOString() })
			.where(eq(users.username, user.username))
			.run();

		return { authSuccess: 'Passwort geaendert.' };
	},

	changeUsername: async ({ request }) => {
		const data = await request.formData();
		const newUsername = data.get('newUsername')?.toString().trim();

		if (!newUsername) {
			return fail(400, { authError: 'Benutzername darf nicht leer sein.' });
		}

		const user = getUser();
		if (!user) {
			return fail(400, { authError: 'Kein Benutzer vorhanden.' });
		}

		db.update(users)
			.set({ username: newUsername, updatedAt: new Date().toISOString() })
			.where(eq(users.username, user.username))
			.run();

		return { authSuccess: 'Benutzername geaendert.' };
	},

	removeAuth: async () => {
		deleteUser();
		await setYoloMode(true);
		return { authSuccess: 'Zugangsschutz entfernt.' };
	}
};

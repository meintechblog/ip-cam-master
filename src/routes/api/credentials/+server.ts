import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { credentials } from '$lib/server/db/schema';
import { encrypt, decrypt } from '$lib/server/services/crypto';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async () => {
	const rows = db.select().from(credentials).all() as any[];
	// Return decrypted for display (masked password)
	const result = rows
		.sort((a, b) => a.priority - b.priority)
		.map((r) => {
			let decryptedPass = '';
			try { decryptedPass = decrypt(r.password); } catch { decryptedPass = '***'; }
			return {
				id: r.id,
				name: r.name,
				username: r.username,
				passwordMasked: '*'.repeat(Math.min(decryptedPass.length, 12)),
				priority: r.priority
			};
		});
	return json(result);
};

export const POST: RequestHandler = async ({ request }) => {
	const { name, username, password } = await request.json();
	if (!name || !username || !password) {
		return json({ success: false, error: 'Name, Benutzername und Passwort erforderlich' }, { status: 400 });
	}

	const encryptedPassword = encrypt(password);
	const maxPriority = (db.select().from(credentials).all() as any[]).length;

	db.insert(credentials)
		.values({ name, username, password: encryptedPassword, priority: maxPriority })
		.run();

	return json({ success: true });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const { id } = await request.json();
	if (!id) return json({ success: false, error: 'ID erforderlich' }, { status: 400 });

	db.delete(credentials).where(eq(credentials.id, id)).run();
	return json({ success: true });
};

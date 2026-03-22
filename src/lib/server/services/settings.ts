import { db } from '$lib/server/db/client';
import { settings } from '$lib/server/db/schema';
import { encrypt, decrypt } from './crypto';
import { eq, like } from 'drizzle-orm';

const SENSITIVE_KEYS = ['proxmox_token_secret', 'unifi_password', 'proxmox_ssh_password', 'credential_password'];

function isSensitive(key: string): boolean {
	return SENSITIVE_KEYS.includes(key);
}

export async function getSetting(key: string): Promise<string | null> {
	const rows = db.select().from(settings).where(eq(settings.key, key)).all();
	if (rows.length === 0) return null;
	const row = rows[0];
	if (row.encrypted) {
		return decrypt(row.value);
	}
	return row.value;
}

export async function getSettings(prefix: string): Promise<Record<string, string>> {
	const rows = db
		.select()
		.from(settings)
		.where(like(settings.key, `${prefix}%`))
		.all();

	const result: Record<string, string> = {};
	for (const row of rows) {
		result[row.key] = row.encrypted ? decrypt(row.value) : row.value;
	}
	return result;
}

export async function saveSetting(key: string, value: string): Promise<void> {
	const sensitive = isSensitive(key);
	const storedValue = sensitive ? encrypt(value) : value;

	db.insert(settings)
		.values({
			key,
			value: storedValue,
			encrypted: sensitive,
			updatedAt: new Date().toISOString()
		})
		.onConflictDoUpdate({
			target: settings.key,
			set: {
				value: storedValue,
				encrypted: sensitive,
				updatedAt: new Date().toISOString()
			}
		})
		.run();
}

export async function saveSettings(data: Record<string, string>): Promise<void> {
	for (const [key, value] of Object.entries(data)) {
		await saveSetting(key, value);
	}
}

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { db } from '$lib/server/db/client';
import { users } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSetting, saveSetting } from './settings';

const SCRYPT_KEYLEN = 64;
const SALT_LENGTH = 16;
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory session store (sessions lost on restart = acceptable for homelab)
const sessions = new Map<string, { username: string; expiresAt: number }>();

export function hashPassword(password: string): string {
	const salt = randomBytes(SALT_LENGTH);
	const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
	return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const [saltHex, hashHex] = stored.split(':');
	if (!saltHex || !hashHex) return false;
	const salt = Buffer.from(saltHex, 'hex');
	const storedHash = Buffer.from(hashHex, 'hex');
	const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
	if (derived.length !== storedHash.length) return false;
	return timingSafeEqual(derived, storedHash);
}

export function createSession(username: string): string {
	const token = randomBytes(32).toString('hex');
	sessions.set(token, {
		username,
		expiresAt: Date.now() + SESSION_TTL_MS
	});
	return token;
}

export function validateSession(token: string): boolean {
	const session = sessions.get(token);
	if (!session) return false;
	if (Date.now() > session.expiresAt) {
		sessions.delete(token);
		return false;
	}
	return true;
}

export function getSessionUsername(token: string): string | null {
	const session = sessions.get(token);
	if (!session) return null;
	if (Date.now() > session.expiresAt) {
		sessions.delete(token);
		return null;
	}
	return session.username;
}

export function destroySession(token: string): void {
	sessions.delete(token);
}

export function isSetupComplete(): boolean {
	const rows = db.select().from(users).all();
	return rows.length > 0;
}

export function getUser(): { username: string } | null {
	const rows = db.select().from(users).all();
	if (rows.length === 0) return null;
	return { username: rows[0].username };
}

export function createUser(username: string, password: string): void {
	const passwordHash = hashPassword(password);
	const now = new Date().toISOString();
	// Upsert: delete existing and insert new (single user per D-27)
	db.delete(users).run();
	db.insert(users)
		.values({ username, passwordHash, createdAt: now, updatedAt: now })
		.run();
}

export function deleteUser(): void {
	db.delete(users).run();
}

export async function isYoloMode(): Promise<boolean> {
	const val = await getSetting('auth_yolo');
	return val === 'true';
}

export async function setYoloMode(enabled: boolean): Promise<void> {
	await saveSetting('auth_yolo', enabled ? 'true' : 'false');
}

// Test helper - only used in tests
export function _resetSessionsForTest(): void {
	sessions.clear();
}

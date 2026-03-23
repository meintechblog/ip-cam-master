import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock better-sqlite3 and drizzle before any imports
const mockAll = vi.fn().mockReturnValue([]);
const mockRun = vi.fn();
const mockFrom = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ all: mockAll }) });
const mockValues = vi.fn().mockReturnValue({
	onConflictDoUpdate: vi.fn().mockReturnValue({ run: mockRun })
});

vi.mock('$lib/server/db/client', () => ({
	db: {
		select: vi.fn().mockReturnValue({ from: mockFrom }),
		insert: vi.fn().mockReturnValue({ values: mockValues }),
		delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ run: mockRun }) })
	}
}));

vi.mock('$lib/server/db/schema', () => ({
	users: { id: 'id', username: 'username', passwordHash: 'passwordHash' },
	settings: { key: 'key' }
}));

vi.mock('drizzle-orm', () => ({
	eq: vi.fn((col, val) => ({ col, val }))
}));

vi.mock('$lib/server/services/settings', () => ({
	getSetting: vi.fn(),
	saveSetting: vi.fn()
}));

import {
	hashPassword,
	verifyPassword,
	createSession,
	validateSession,
	destroySession,
	isSetupComplete,
	_resetSessionsForTest
} from './auth';

describe('auth service', () => {
	beforeEach(() => {
		_resetSessionsForTest();
		vi.clearAllMocks();
	});

	describe('hashPassword', () => {
		it('returns a scrypt hash string (not plaintext)', () => {
			const hash = hashPassword('test123');
			expect(hash).not.toBe('test123');
			expect(hash).toContain(':');
			// Format: salt:hash in hex
			const parts = hash.split(':');
			expect(parts).toHaveLength(2);
			expect(parts[0]).toMatch(/^[0-9a-f]+$/);
			expect(parts[1]).toMatch(/^[0-9a-f]+$/);
		});

		it('produces different hashes for the same password (random salt)', () => {
			const hash1 = hashPassword('test123');
			const hash2 = hashPassword('test123');
			expect(hash1).not.toBe(hash2);
		});
	});

	describe('verifyPassword', () => {
		it('returns true for correct password', () => {
			const hash = hashPassword('test123');
			expect(verifyPassword('test123', hash)).toBe(true);
		});

		it('returns false for wrong password', () => {
			const hash = hashPassword('test123');
			expect(verifyPassword('wrong', hash)).toBe(false);
		});
	});

	describe('createSession', () => {
		it('returns a random 64-char hex token', () => {
			const token = createSession('admin');
			expect(token).toMatch(/^[0-9a-f]{64}$/);
		});

		it('returns different tokens each time', () => {
			const token1 = createSession('admin');
			const token2 = createSession('admin');
			expect(token1).not.toBe(token2);
		});
	});

	describe('session lifecycle', () => {
		it('validateSession returns true for valid session', () => {
			const token = createSession('admin');
			expect(validateSession(token)).toBe(true);
		});

		it('validateSession returns false for unknown token', () => {
			expect(validateSession('nonexistent')).toBe(false);
		});

		it('destroySession removes the session', () => {
			const token = createSession('admin');
			expect(validateSession(token)).toBe(true);
			destroySession(token);
			expect(validateSession(token)).toBe(false);
		});
	});

	describe('isSetupComplete', () => {
		it('returns false when no user exists in DB', () => {
			mockAll.mockReturnValueOnce([]);
			expect(isSetupComplete()).toBe(false);
		});

		it('returns true when a user exists in DB', () => {
			mockAll.mockReturnValueOnce([{ id: 1, username: 'admin', passwordHash: 'hash' }]);
			expect(isSetupComplete()).toBe(true);
		});
	});
});

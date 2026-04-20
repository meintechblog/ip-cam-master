import { describe, it, expect, vi } from 'vitest';
import {
	runBambuPreflight,
	PREFLIGHT_HINTS_DE,
	type PreflightDeps
} from './bambu-preflight';

function makeDeps(overrides: Partial<PreflightDeps> = {}): PreflightDeps {
	return {
		checkTcp: vi.fn(async () => ({ ok: true as const })),
		checkRtsps: vi.fn(async () => ({ ok: true as const })),
		checkMqtt: vi.fn(async () => ({ ok: true as const })),
		...overrides
	};
}

const INPUT = { ip: '192.168.3.109', serialNumber: '01P00A3B0700123', accessCode: '12345678' };

describe('runBambuPreflight orchestrator', () => {
	it('returns { ok: true } when all three checks pass', async () => {
		const deps = makeDeps();
		const result = await runBambuPreflight(INPUT, deps);
		expect(result).toEqual({ ok: true });
		expect(deps.checkTcp).toHaveBeenCalledTimes(1);
		expect(deps.checkRtsps).toHaveBeenCalledTimes(1);
		expect(deps.checkMqtt).toHaveBeenCalledTimes(1);
	});

	it('returns PRINTER_UNREACHABLE and short-circuits when TCP times out', async () => {
		const deps = makeDeps({ checkTcp: vi.fn(async () => ({ ok: false as const, reason: 'TIMEOUT' as const })) });
		const result = await runBambuPreflight(INPUT, deps);
		expect(result).toEqual({
			ok: false,
			error: 'PRINTER_UNREACHABLE',
			hint: PREFLIGHT_HINTS_DE.PRINTER_UNREACHABLE
		});
		expect(deps.checkRtsps).not.toHaveBeenCalled();
		expect(deps.checkMqtt).not.toHaveBeenCalled();
	});

	it('returns LAN_MODE_OFF when TCP is refused (printer alive, port closed)', async () => {
		const deps = makeDeps({ checkTcp: vi.fn(async () => ({ ok: false as const, reason: 'REFUSED' as const })) });
		const result = await runBambuPreflight(INPUT, deps);
		expect(result).toEqual({
			ok: false,
			error: 'LAN_MODE_OFF',
			hint: PREFLIGHT_HINTS_DE.LAN_MODE_OFF
		});
		expect(deps.checkRtsps).not.toHaveBeenCalled();
		expect(deps.checkMqtt).not.toHaveBeenCalled();
	});

	it('maps RTSPS AUTH → WRONG_ACCESS_CODE and skips MQTT', async () => {
		const deps = makeDeps({
			checkRtsps: vi.fn(async () => ({ ok: false as const, reason: 'AUTH' as const }))
		});
		const result = await runBambuPreflight(INPUT, deps);
		expect(result).toMatchObject({ ok: false, error: 'WRONG_ACCESS_CODE' });
		expect(deps.checkMqtt).not.toHaveBeenCalled();
	});

	it('maps RTSPS REFUSED → LAN_MODE_OFF', async () => {
		const deps = makeDeps({
			checkRtsps: vi.fn(async () => ({ ok: false as const, reason: 'REFUSED' as const }))
		});
		const result = await runBambuPreflight(INPUT, deps);
		expect(result).toMatchObject({ ok: false, error: 'LAN_MODE_OFF' });
	});

	it('maps RTSPS TIMEOUT → RTSPS_HANDSHAKE_HUNG with Live555 hint', async () => {
		const deps = makeDeps({
			checkRtsps: vi.fn(async () => ({ ok: false as const, reason: 'TIMEOUT' as const }))
		});
		const result = await runBambuPreflight(INPUT, deps);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error).toBe('RTSPS_HANDSHAKE_HUNG');
		expect(result.hint.toLowerCase()).toMatch(/live555|aus- und wieder einschalten/);
	});

	it('maps MQTT TIMEOUT → LAN_MODE_OFF', async () => {
		const deps = makeDeps({
			checkMqtt: vi.fn(async () => ({ ok: false as const, reason: 'TIMEOUT' as const }))
		});
		const result = await runBambuPreflight(INPUT, deps);
		expect(result).toMatchObject({ ok: false, error: 'LAN_MODE_OFF' });
	});

	it('maps MQTT AUTH → WRONG_ACCESS_CODE', async () => {
		const deps = makeDeps({
			checkMqtt: vi.fn(async () => ({ ok: false as const, reason: 'AUTH' as const }))
		});
		const result = await runBambuPreflight(INPUT, deps);
		expect(result).toMatchObject({ ok: false, error: 'WRONG_ACCESS_CODE' });
	});

	it('PREFLIGHT_HINTS_DE has German copy for all four error codes', () => {
		expect(Object.keys(PREFLIGHT_HINTS_DE).sort()).toEqual([
			'LAN_MODE_OFF',
			'PRINTER_UNREACHABLE',
			'RTSPS_HANDSHAKE_HUNG',
			'WRONG_ACCESS_CODE'
		]);
		for (const hint of Object.values(PREFLIGHT_HINTS_DE)) {
			expect(hint.length).toBeGreaterThan(10);
		}
	});
});

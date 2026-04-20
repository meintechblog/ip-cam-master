import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runBambuPreflight, realDeps } from '$lib/server/services/bambu-preflight';
import { BAMBU_MODEL_ALLOWLIST } from '$lib/server/services/bambu-discovery';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}) as Record<string, unknown>);
	const ip = typeof body?.ip === 'string' ? body.ip.trim() : '';
	const serialNumber = typeof body?.serialNumber === 'string' ? body.serialNumber.trim() : '';
	const accessCode = typeof body?.accessCode === 'string' ? body.accessCode.trim() : '';

	// Phase 18 / BAMBU-A1-04: optional model param. Validated against the
	// allowlist so an attacker cannot pass an arbitrary string through to
	// `PRINTER_CAPABILITIES[model]`. Unknown / absent → fall back to 'H2C'
	// (preflight also falls back internally; defence in depth).
	const rawModel = typeof body?.model === 'string' ? body.model.trim() : '';
	const model = (BAMBU_MODEL_ALLOWLIST as readonly string[]).includes(rawModel) ? rawModel : 'H2C';

	if (!ip || !serialNumber || !accessCode) {
		return json(
			{
				ok: false,
				error: 'INVALID_INPUT',
				hint: 'IP, Seriennummer und Access Code sind erforderlich.'
			},
			{ status: 400 }
		);
	}

	try {
		const result = await runBambuPreflight(
			{ ip, serialNumber, accessCode },
			realDeps,
			model
		);
		return json(result);
	} catch (err) {
		return json(
			{
				ok: false,
				error: 'PRINTER_UNREACHABLE',
				hint: err instanceof Error ? err.message : 'Unbekannter Fehler'
			},
			{ status: 500 }
		);
	}
};

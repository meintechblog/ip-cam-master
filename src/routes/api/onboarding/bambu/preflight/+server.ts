import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runBambuPreflight, realDeps } from '$lib/server/services/bambu-preflight';

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => ({}) as Record<string, unknown>);
	const ip = typeof body?.ip === 'string' ? body.ip.trim() : '';
	const serialNumber = typeof body?.serialNumber === 'string' ? body.serialNumber.trim() : '';
	const accessCode = typeof body?.accessCode === 'string' ? body.accessCode.trim() : '';

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
		const result = await runBambuPreflight({ ip, serialNumber, accessCode }, realDeps);
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

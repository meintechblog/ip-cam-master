import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const { ip, username, password } = await request.json();

	if (!ip || !username || !password) {
		return new Response(JSON.stringify({ error: 'IP, username and password required' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const url = `http://${ip}/record/current.jpg`;
		const auth = Buffer.from(`${username}:${password}`).toString('base64');

		const res = await fetch(url, {
			headers: { Authorization: `Basic ${auth}` },
			signal: AbortSignal.timeout(5000)
		});

		if (!res.ok) {
			return new Response(JSON.stringify({ error: `Camera returned ${res.status}` }), {
				status: 502,
				headers: { 'Content-Type': 'application/json' }
			});
		}

		const imageBuffer = await res.arrayBuffer();
		return new Response(imageBuffer, {
			headers: {
				'Content-Type': 'image/jpeg',
				'Cache-Control': 'no-cache'
			}
		});
	} catch (err) {
		return new Response(
			JSON.stringify({ error: err instanceof Error ? err.message : 'Snapshot failed' }),
			{ status: 500, headers: { 'Content-Type': 'application/json' } }
		);
	}
};

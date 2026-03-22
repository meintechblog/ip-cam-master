import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface DiscoveredCamera {
	ip: string;
	type: 'mobotix' | 'loxone' | 'unknown';
	alreadyOnboarded: boolean;
}

export const GET: RequestHandler = async ({ url }) => {
	const subnet = url.searchParams.get('subnet') || '192.168.3';
	const rangeStart = parseInt(url.searchParams.get('start') || '1');
	const rangeEnd = parseInt(url.searchParams.get('end') || '254');

	try {
		// Get already onboarded IPs
		const onboarded = new Set(
			(db.select().from(cameras).all() as any[]).map((c) => c.ip)
		);

		// Scan subnet: curl each IP with 1s timeout, check for Mobotix/Loxone
		// Run in parallel batches for speed
		// Parallel scan: background all curls, wait for all
		// Loxone: only detect Intercoms (have /mjpg/video.mjpg endpoint), not other Loxone devices
		const scanScript = `
			for ip in $(seq ${rangeStart} ${rangeEnd}); do
				(
					FULL="${subnet}.$ip"
					RESP=$(curl -s --max-time 1 -L "http://$FULL/" 2>/dev/null | head -c 2000)
					if echo "$RESP" | grep -qi 'mobotix'; then
						echo "mobotix:$FULL"
					elif echo "$RESP" | grep -qi 'loxone'; then
						# Only Loxone Intercoms have a video endpoint
						VIDEO=$(curl -s --max-time 1 -o /dev/null -w '%{http_code}' "http://$FULL/mjpg/video.mjpg" 2>/dev/null)
						if [ "$VIDEO" = "401" ] || [ "$VIDEO" = "200" ]; then
							echo "loxone:$FULL"
						fi
					fi
				) &
			done
			wait
		`;

		const { stdout } = await execAsync(`bash -c '${scanScript}'`, {
			timeout: 60000,
			encoding: 'utf-8'
		});

		const discovered: DiscoveredCamera[] = stdout
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const [type, ip] = line.split(':') as ['mobotix' | 'loxone', string];
				return {
					ip,
					type,
					alreadyOnboarded: onboarded.has(ip)
				};
			})
			.sort((a, b) => {
				const aNum = parseInt(a.ip.split('.').pop() || '0');
				const bNum = parseInt(b.ip.split('.').pop() || '0');
				return aNum - bNum;
			});

		return json({ cameras: discovered });
	} catch (err) {
		return json({ cameras: [], error: err instanceof Error ? err.message : 'Scan failed' });
	}
};

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras } from '$lib/server/db/schema';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
		const onboarded = new Set(
			(db.select().from(cameras).all() as any[]).map((c) => c.ip)
		);

		// Write scan script to temp file to avoid shell quoting issues
		const scriptPath = join(tmpdir(), `ipcam-scan-${Date.now()}.sh`);
		writeFileSync(scriptPath, `#!/bin/bash
for ip in $(seq ${rangeStart} ${rangeEnd}); do
  (
    FULL="${subnet}.$ip"
    RESP=$(curl -s --max-time 1 "http://$FULL/" 2>/dev/null | head -c 2000)
    # Loxone Intercom: @VERSION 1.0.x in HTML (Audioserver is 2.x)
    if echo "$RESP" | grep -q "@VERSION 1[.]0"; then
      echo "loxone:$FULL"
    else
      # Mobotix: follow redirect, check for 'mobotix' in page
      RESP_L=$(curl -s --max-time 1 -L "http://$FULL/" 2>/dev/null | head -c 2000)
      if echo "$RESP_L" | grep -qi "mobotix"; then
        echo "mobotix:$FULL"
      fi
    fi
  ) &
done
wait
`, { mode: 0o755 });

		const { stdout } = await execAsync(`bash ${scriptPath}`, {
			timeout: 60000,
			encoding: 'utf-8'
		});

		// Clean up
		try { unlinkSync(scriptPath); } catch { /* ignore */ }

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

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/client';
import { cameras, credentials } from '$lib/server/db/schema';
import { decrypt } from '$lib/server/services/crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execAsync = promisify(exec);

export interface DiscoveredCamera {
	ip: string;
	type: 'mobotix' | 'mobotix-onvif' | 'loxone' | 'unknown';
	alreadyOnboarded: boolean;
	name: string | null;
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
        # Check native ONVIF support (405 = endpoint exists, needs POST)
        ONVIF_CODE=$(curl -s --max-time 1 -o /dev/null -w "%{http_code}" "http://$FULL/onvif/device_service" 2>/dev/null)
        if [ "$ONVIF_CODE" = "405" ] || [ "$ONVIF_CODE" = "200" ]; then
          echo "mobotix-onvif:$FULL"
        else
          echo "mobotix:$FULL"
        fi
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

		// Get saved credentials for name lookup
		const savedCreds = (db.select().from(credentials).all() as any[])
			.sort((a, b) => a.priority - b.priority)
			.map((c) => { try { return { u: c.username, p: decrypt(c.password) }; } catch { return null; } })
			.filter(Boolean) as { u: string; p: string }[];

		const discovered: DiscoveredCamera[] = stdout
			.trim()
			.split('\n')
			.filter(Boolean)
			.map((line) => {
				const colonIdx = line.indexOf(':');
				const type = line.substring(0, colonIdx) as DiscoveredCamera['type'];
				const ip = line.substring(colonIdx + 1);
				return {
					ip,
					type,
					alreadyOnboarded: onboarded.has(ip),
					name: null as string | null
				};
			})
			.sort((a, b) => {
				const aNum = parseInt(a.ip.split('.').pop() || '0');
				const bNum = parseInt(b.ip.split('.').pop() || '0');
				return aNum - bNum;
			});

		// Try to grab camera names using saved credentials
		if (savedCreds.length > 0) {
			await Promise.allSettled(
				discovered.filter((c) => !c.alreadyOnboarded).map(async (cam) => {
					for (const cred of savedCreds) {
						try {
							const { stdout: html } = await execAsync(
								`curl -s --basic -u "${cred.u}:${cred.p}" -L "http://${cam.ip}/" --max-time 2`,
								{ timeout: 3000, encoding: 'utf-8' }
							);
							const titleMatch = html.match(/<title>([^<]+)<\/title>/);
							if (titleMatch) {
								let name = titleMatch[1].replace(/ Live$/, '').replace(/Error.*/, '').trim();
								if (name && !name.includes('Error') && !name.includes('Unauthorized')) {
									cam.name = name;
									break;
								}
							}
						} catch { /* try next cred */ }
					}
				})
			);
		}

		return json({ cameras: discovered });
	} catch (err) {
		return json({ cameras: [], error: err instanceof Error ? err.message : 'Scan failed' });
	}
};

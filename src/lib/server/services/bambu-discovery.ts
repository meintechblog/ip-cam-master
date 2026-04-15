/**
 * Bambu SSDP discovery service.
 *
 * Ground truth: .planning/research/H2C-FIELD-NOTES.md §SSDP (validated
 * 2026-04-15 against a real H2C "Bob the Builder", fw 01.01.05.00).
 *
 * Key facts encoded here:
 *   - UDP broadcast traffic flows on port **2021** (src + dst). The HTTP
 *     `Host:` header inside the payload advertises `239.255.255.250:1990`
 *     but NO traffic was observed on 1990 — do NOT bind 1990.
 *   - Service URN is `urn:bambulab-com:device:3dprinter:1` (shared across
 *     H2C / A1 / X1C / P1S per field notes §SSDP + Bonus capture).
 *   - USN header carries the serial number directly (no `uuid:` prefix).
 *   - H2C reports its internal model code as `O1C2`, NOT "H2C". Display
 *     label maps O1C2 → "Bambu Lab H2C".
 *   - Re-broadcast cadence is ~3–5s, so a 6s listen window reliably
 *     captures ≥1 packet per device.
 */
export interface BambuDevice {
	ip: string;
	serialNumber: string;
	model: string; // raw DevModel.bambu.com value (e.g. 'O1C2')
	modelLabel: string; // human label (e.g. 'Bambu Lab H2C')
	name: string | null; // DevName.bambu.com (e.g. 'Bob the Builder')
}

export const BAMBU_MODEL_ALLOWLIST = ['O1C2', 'H2C', 'H2D', 'X1C', 'P1S', 'A1'] as const;

// Map DevModel wire code → display label. O1C2 is the H2C's internal code
// (H2C-FIELD-NOTES.md §Known Issues). Unknown-but-allowlisted codes fall
// back to "Bambu Lab <code>" so forward-compat devices still show sensibly.
const MODEL_LABELS: Record<string, string> = {
	O1C2: 'Bambu Lab H2C',
	H2C: 'Bambu Lab H2C',
	H2D: 'Bambu Lab H2D',
	X1C: 'Bambu Lab X1C',
	P1S: 'Bambu Lab P1S',
	A1: 'Bambu Lab A1'
};

const BAMBU_URN = 'urn:bambulab-com:device:3dprinter:1';

/**
 * Pure parser — no sockets, no timers. Accepts a raw SSDP NOTIFY payload
 * (UTF-8 string) and the source IP of the UDP packet; returns a structured
 * BambuDevice or null if the packet is not an allow-listed Bambu broadcast.
 */
export function parseNotifyPayload(raw: string, sourceIp: string): BambuDevice | null {
	const headers: Record<string, string> = {};
	for (const line of raw.split(/\r?\n/)) {
		const idx = line.indexOf(':');
		if (idx <= 0) continue;
		const key = line.slice(0, idx).trim().toLowerCase();
		const value = line.slice(idx + 1).trim();
		if (!(key in headers)) headers[key] = value; // first occurrence wins
	}

	if (headers['nt'] !== BAMBU_URN) return null;

	const model = headers['devmodel.bambu.com'];
	if (!model || !(BAMBU_MODEL_ALLOWLIST as readonly string[]).includes(model)) return null;

	const serialNumber = headers['usn'];
	if (!serialNumber) return null;

	return {
		ip: sourceIp,
		serialNumber,
		model,
		modelLabel: MODEL_LABELS[model] ?? `Bambu Lab ${model}`,
		name: headers['devname.bambu.com'] ?? null
	};
}

import dgram from 'node:dgram';

export interface DiscoverOptions {
	listenMs?: number; // default 6000
	port?: number; // default 2021
}

/**
 * Opens a UDP socket on port 2021 (per H2C-FIELD-NOTES.md §SSDP — NOT 1990,
 * the Host: header is misleading) and collects Bambu NOTIFY broadcasts for
 * the listen window. De-duplicates by IP (later packets overwrite earlier).
 *
 * Always resolves; never rejects — socket errors (e.g. EADDRINUSE on the
 * App-VM if something else already bound 2021) produce an empty list. The
 * SSDP gap is recoverable via the Manual Add path (Plan 11-04), so we must
 * not let a listener failure break the existing HTTP discovery scan.
 */
export async function discoverBambuDevices(opts: DiscoverOptions = {}): Promise<BambuDevice[]> {
	const listenMs = opts.listenMs ?? 6000;
	const port = opts.port ?? 2021;
	const byIp = new Map<string, BambuDevice>();

	return new Promise((resolve) => {
		const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
		let settled = false;
		const done = (): void => {
			if (settled) return;
			settled = true;
			try {
				sock.close();
			} catch {
				/* already closed */
			}
			resolve([...byIp.values()]);
		};
		sock.on('error', () => done());
		sock.on('message', (msg, rinfo) => {
			const parsed = parseNotifyPayload(msg.toString('utf8'), rinfo.address);
			if (parsed) byIp.set(parsed.ip, parsed);
		});
		try {
			sock.bind(port, () => {
				try {
					sock.setBroadcast(true);
				} catch {
					/* non-fatal */
				}
			});
		} catch {
			done();
			return;
		}
		setTimeout(done, listenMs).unref();
	});
}

import net from 'node:net';
import { spawn } from 'node:child_process';
import mqtt from 'mqtt';
import { BAMBU_USERNAME } from './bambu-credentials';

/**
 * Bambu pre-flight handler — runs three sequential connectivity checks
 * against a Bambu printer and returns a structured verdict.
 *
 * Ground truth: .planning/research/H2C-FIELD-NOTES.md (RTSPS + MQTT sections).
 * Never run checks in parallel — H2C has a single-connection limit
 * (PITFALLS.md §1). Every external call has a hard timeout.
 */

export type PreflightError =
	| 'PRINTER_UNREACHABLE'
	| 'LAN_MODE_OFF'
	| 'WRONG_ACCESS_CODE'
	| 'RTSPS_HANDSHAKE_HUNG';

export type PreflightResult =
	| { ok: true }
	| { ok: false; error: PreflightError; hint: string };

export const PREFLIGHT_HINTS_DE: Record<PreflightError, string> = {
	PRINTER_UNREACHABLE:
		'Drucker nicht erreichbar. IP-Adresse und Netzwerkverbindung prüfen.',
	LAN_MODE_OFF:
		'LAN Mode scheint deaktiviert. Am Drucker: Einstellungen → Netzwerk → LAN Mode aktivieren.',
	WRONG_ACCESS_CODE:
		'Access Code abgelehnt. Am Drucker-Display aktuellen Code ablesen (Einstellungen → Netzwerk → Access Code).',
	RTSPS_HANDSHAKE_HUNG:
		'RTSPS-Server antwortet nicht (Live555 hängt). Drucker bitte kurz aus- und wieder einschalten.'
};

export interface PreflightInput {
	ip: string;
	serialNumber: string;
	accessCode: string;
}

export type CheckOk = { ok: true };
export type TcpFail = { ok: false; reason: 'REFUSED' | 'TIMEOUT' | 'UNREACHABLE' };
export type RtspsFail = { ok: false; reason: 'AUTH' | 'TIMEOUT' | 'REFUSED' };
export type MqttFail = { ok: false; reason: 'AUTH' | 'TIMEOUT' };

export interface PreflightDeps {
	checkTcp(ip: string, port: number, timeoutMs: number): Promise<CheckOk | TcpFail>;
	checkRtsps(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | RtspsFail>;
	checkMqtt(ip: string, accessCode: string, timeoutMs: number): Promise<CheckOk | MqttFail>;
}

function fail(error: PreflightError): PreflightResult {
	return { ok: false, error, hint: PREFLIGHT_HINTS_DE[error] };
}

export async function runBambuPreflight(
	input: PreflightInput,
	deps: PreflightDeps
): Promise<PreflightResult> {
	const tcp = await deps.checkTcp(input.ip, 322, 3000);
	if (!tcp.ok) {
		// ECONNREFUSED = printer is on the network but port 322 is closed =
		// LAN Mode disabled. TIMEOUT/UNREACHABLE = no such host or blocked
		// by firewall = genuine unreachability.
		if (tcp.reason === 'REFUSED') return fail('LAN_MODE_OFF');
		return fail('PRINTER_UNREACHABLE');
	}

	const rtsps = await deps.checkRtsps(input.ip, input.accessCode, 12000);
	if (!rtsps.ok) {
		if (rtsps.reason === 'AUTH') return fail('WRONG_ACCESS_CODE');
		if (rtsps.reason === 'REFUSED') return fail('LAN_MODE_OFF');
		return fail('RTSPS_HANDSHAKE_HUNG');
	}

	const mqttResult = await deps.checkMqtt(input.ip, input.accessCode, 5000);
	if (!mqttResult.ok) {
		if (mqttResult.reason === 'AUTH') return fail('WRONG_ACCESS_CODE');
		return fail('LAN_MODE_OFF');
	}

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Real check implementations — wired into realDeps below.
// Tests use dep-injected mocks, so these are NOT exercised in CI.
// ---------------------------------------------------------------------------

async function checkTcpReal(
	ip: string,
	port: number,
	timeoutMs: number
): Promise<CheckOk | TcpFail> {
	return new Promise((resolve) => {
		const sock = net.connect({ host: ip, port });
		let settled = false;
		const finish = (result: CheckOk | TcpFail): void => {
			if (settled) return;
			settled = true;
			try {
				sock.destroy();
			} catch {
				/* noop */
			}
			resolve(result);
		};
		const timer = setTimeout(() => finish({ ok: false, reason: 'TIMEOUT' }), timeoutMs);
		timer.unref();
		sock.once('connect', () => {
			clearTimeout(timer);
			finish({ ok: true });
		});
		sock.once('error', (err: NodeJS.ErrnoException) => {
			clearTimeout(timer);
			// Printer alive on the network but the port has no listener =
			// LAN Mode disabled. Distinguishing this from a genuinely
			// unreachable host makes the preflight hint actionable.
			if (err && err.code === 'ECONNREFUSED') return finish({ ok: false, reason: 'REFUSED' });
			finish({ ok: false, reason: 'UNREACHABLE' });
		});
	});
}

async function checkRtspsReal(
	ip: string,
	accessCode: string,
	timeoutMs: number
): Promise<CheckOk | RtspsFail> {
	// URL template confirmed working — H2C-FIELD-NOTES.md §Recommendations #2.
	// Flags per same section. External SIGKILL wrapper because ffmpeg's
	// own -timeout/-rw_timeout are version-dependent.
	const url = `rtsps://${BAMBU_USERNAME}:${encodeURIComponent(accessCode)}@${ip}:322/streaming/live/1`;
	return new Promise((resolve) => {
		const proc = spawn('ffprobe', [
			'-hide_banner',
			'-loglevel',
			'error',
			'-rtsp_transport',
			'tcp',
			'-tls_verify',
			'0',
			'-i',
			url
		]);
		let stderr = '';
		let settled = false;
		const finish = (r: CheckOk | RtspsFail): void => {
			if (settled) return;
			settled = true;
			resolve(r);
		};
		proc.stderr.on('data', (b) => {
			stderr += b.toString('utf8');
		});
		const timer = setTimeout(() => {
			try {
				proc.kill('SIGKILL');
			} catch {
				/* noop */
			}
			finish({ ok: false, reason: 'TIMEOUT' });
		}, timeoutMs);
		timer.unref();
		proc.on('close', (code) => {
			clearTimeout(timer);
			if (code === 0) return finish({ ok: true });
			const lower = stderr.toLowerCase();
			if (lower.includes('401') || lower.includes('unauthorized')) {
				return finish({ ok: false, reason: 'AUTH' });
			}
			if (lower.includes('connection refused') || lower.includes('econnrefused')) {
				return finish({ ok: false, reason: 'REFUSED' });
			}
			// Unknown non-zero exit → treat as hang class (safer than AUTH).
			finish({ ok: false, reason: 'TIMEOUT' });
		});
		proc.on('error', () => {
			clearTimeout(timer);
			finish({ ok: false, reason: 'TIMEOUT' });
		});
	});
}

async function checkMqttReal(
	ip: string,
	accessCode: string,
	timeoutMs: number
): Promise<CheckOk | MqttFail> {
	// Use Node mqtt pkg per H2C-FIELD-NOTES §Recommendations #5 —
	// mosquitto_sub 2.0.21 on Debian 13 cannot negotiate the H2C self-signed
	// cert. rejectUnauthorized:false is mandatory. reconnectPeriod:0 keeps
	// this a one-shot probe (PITFALLS §7).
	try {
		const client = await mqtt.connectAsync(`mqtts://${ip}:8883`, {
			username: BAMBU_USERNAME,
			password: accessCode,
			rejectUnauthorized: false,
			connectTimeout: timeoutMs,
			reconnectPeriod: 0
		});
		await client.endAsync(true);
		return { ok: true };
	} catch (err) {
		const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
		if (
			msg.includes('not authorized') ||
			msg.includes('bad user name') ||
			msg.includes('bad username') ||
			msg.includes('connack')
		) {
			return { ok: false, reason: 'AUTH' };
		}
		return { ok: false, reason: 'TIMEOUT' };
	}
}

export const realDeps: PreflightDeps = {
	checkTcp: checkTcpReal,
	checkRtsps: checkRtspsReal,
	checkMqtt: checkMqttReal
};

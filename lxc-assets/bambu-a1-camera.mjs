#!/usr/bin/env node
// Bambu Lab A1 JPEG-over-TLS ingestion script.
//
// Deployed to /opt/ipcm/bambu-a1-camera.mjs inside a per-camera LXC (see
// onboarding.ts configureGo2rtc A1 branch). Spawned by go2rtc's exec: pipe
// transport — emits raw concatenated JPEGs on stdout; go2rtc's magic.Open()
// auto-detects MJPEG from the FF D8 SOI bytes and re-exposes it as RTSP :8554.
//
// Phase 18 / Plan 18-03 / BAMBU-A1-09.
//
// Invocation (from generated go2rtc.yaml):
//   exec:env A1_ACCESS_CODE=<code> node /opt/ipcm/bambu-a1-camera.mjs --ip=<ip>#killsignal=15#killtimeout=5
//
// Security:
//   - Access code comes from A1_ACCESS_CODE env var, NEVER a CLI arg, because
//     `ps ax` on the LXC would otherwise leak it (RESEARCH §Anti-Pattern 4).
//   - rejectUnauthorized: false matches the H2C branch trust model on LAN
//     (self-signed printer CA; future CN-pinning is deferred per CONTEXT.md).
//
// Lifecycle:
//   - SIGTERM / SIGINT → socket.end() + 500ms exit delay so the TLS session
//     closes cleanly before go2rtc SIGKILLs us (RESEARCH §Gap 4 / Pitfall 2).
//   - socket error / close → process.exit(1); go2rtc will respawn per its
//     exec: producer restart policy.

import tls from 'node:tls';
import process from 'node:process';

const ip = process.argv.find((a) => a.startsWith('--ip='))?.slice(5);
const code = process.env.A1_ACCESS_CODE;
if (!ip || !code) {
	process.stderr.write('[a1-cam] Missing --ip or A1_ACCESS_CODE\n');
	process.exit(2);
}

// Byte layout per ha-bambulab pybambu/bambu_client.py ChamberImageThread.run()
// + validated byte-for-byte against real A1 hardware in spike 004. This inline
// copy mirrors src/lib/server/services/bambu-a1-auth.ts byte-for-byte; the
// u32 LE 0x3000 (NOT 0x30) pitfall is the silent-fail mode documented in
// spike 004 §2 / RESEARCH §Pitfall 1 / CONTEXT.md D-08.
//
// Cannot `import` from bambu-a1-auth.ts here — this file runs inside the LXC
// as a standalone .mjs with no TS toolchain and no pnpm bundle.
function buildAuth(username, accessCode) {
	const buf = Buffer.alloc(80, 0);
	buf.writeUInt32LE(0x40, 0);
	buf.writeUInt32LE(0x3000, 4); // NOT 0x30 — u32 LE 0x3000 gives bytes 00 30 00 00
	// bytes 8..15 stay zero (reserved)
	buf.write(username, 16, 32, 'ascii');
	buf.write(accessCode, 48, 32, 'ascii');
	return buf;
}

let socket = null;
let shuttingDown = false;

function shutdown() {
	if (shuttingDown) return;
	shuttingDown = true;
	try {
		socket?.end();
	} catch {
		/* socket already closed */
	}
	setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

socket = tls.connect({
	host: ip,
	port: 6000,
	rejectUnauthorized: false,
	timeout: 10_000
});

let buf = Buffer.alloc(0);

socket.on('secureConnect', () => {
	socket.write(buildAuth('bblp', code));
});

// Phase 18 / WR-05: Hard cap on the in-memory frame buffer. The per-frame
// guard at `size > 5_000_000` blocks absurd sizes but does not defend against
// a stream of mid-size headers (e.g. 4 MB each) that never commit a valid
// JPEG. Without this cap a hostile printer on the LAN can pin hundreds of MB
// of Node heap across reconnects. 10 MB is well above the single-frame ceiling
// so it only trips on accumulated-without-commit pathologies.
const BUF_RUNAWAY_CAP = 10_000_000;

socket.on('data', (chunk) => {
	buf = Buffer.concat([buf, chunk]);
	// Frame parser kernel — kept verbatim from spike 004 probe.mjs:103-113.
	// Each frame: 16-byte header (u32 LE size at offset 0) + N-byte JPEG.
	// JPEGs are emitted to stdout RAW — no wrapper headers, no delimiters;
	// go2rtc's magic.Open() binds to the pipe by reading the FF D8 SOI
	// (RESEARCH §Gap 1). Wrapping would break go2rtc's MJPEG detection.
	while (buf.length >= 16) {
		// Phase 18 / WR-05: abort on sustained buffer growth without a valid
		// frame commit. Checked before size-parse so no partial header can
		// keep extending `buf` past the cap.
		if (buf.length > BUF_RUNAWAY_CAP) {
			process.stderr.write(`[a1-cam] buffer runaway (${buf.length} bytes); abort\n`);
			socket.destroy();
			return;
		}
		const size = buf.readUInt32LE(0);
		if (size === 0 || size > 5_000_000) {
			process.stderr.write(`[a1-cam] suspicious size=${size}; abort\n`);
			socket.destroy();
			return;
		}
		if (buf.length < 16 + size) return; // wait for full frame
		const jpeg = buf.subarray(16, 16 + size);
		buf = buf.subarray(16 + size);
		// Sanity: must start FF D8. Skip frame if not (don't crash).
		if (jpeg[0] === 0xff && jpeg[1] === 0xd8) {
			// Phase 18 / IN-04: Respect stdout back-pressure. If go2rtc's
			// consumer side stalls (rare during magic.Open() re-detection),
			// pause TLS reads until the pipe drains so the Node heap does
			// not silently buffer JPEGs at ~100-500 KB/s sustained.
			if (!process.stdout.write(jpeg)) {
				socket.pause();
				process.stdout.once('drain', () => socket.resume());
			}
		}
	}
});

socket.on('error', (err) => {
	// Never reference A1_ACCESS_CODE in error paths (Threat T-18-12).
	process.stderr.write(`[a1-cam] socket error: ${err.message}\n`);
	process.exit(1); // go2rtc will respawn
});

socket.on('close', () => {
	process.exit(1);
});

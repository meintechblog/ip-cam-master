#!/usr/bin/env node
// Spike 004: Bambu A1 proprietary JPEG-over-TLS camera protocol on port 6000.
//
// Community-documented format (P1/A1 family):
//   Auth: TLS connect (self-signed, accept any cert) → send 80-byte auth:
//         16 bytes header (magic + padding)
//         32 bytes username "bblp" null-padded
//         32 bytes access code null-padded
//   Stream: printer returns frames as:
//         16 bytes frame header (first u32 LE = payload size)
//         N bytes JPEG payload (starts 0xFF 0xD8, ends 0xFF 0xD9)
//
// Success = we pull one valid JPEG, save it to frame-001.jpg, and read its
// dimensions from the SOFn marker.
//
// Usage:
//   set -a; source .env.a1; set +a
//   node .planning/spikes/004-a1-stream-fallback/probe.mjs

import tls from 'node:tls';
import fs from 'node:fs';

const ip = process.env.A1_IP;
const code = process.env.A1_ACCESS_CODE;
if (!ip || !code) {
	console.error('Missing A1_IP / A1_ACCESS_CODE — source .env.a1 first');
	process.exit(2);
}

// Byte layout per ha-bambulab pybambu/bambu_client.py ChamberImageThread.run():
//   struct.pack("<I", 0x40)    → 40 00 00 00
//   struct.pack("<I", 0x3000)  → 00 30 00 00   (little-endian!)
//   struct.pack("<I", 0)       → 00 00 00 00
//   struct.pack("<I", 0)       → 00 00 00 00
//   username   ascii, null-padded to 32 bytes
//   accessCode ascii, null-padded to 32 bytes
// Total 80 bytes.
function buildAuth(username, accessCode) {
	const buf = Buffer.alloc(80, 0);
	buf.writeUInt32LE(0x40, 0);
	buf.writeUInt32LE(0x3000, 4);
	// bytes 8..15 stay zero
	buf.write(username, 16, 32, 'ascii');
	buf.write(accessCode, 48, 32, 'ascii');
	return buf;
}

// Extract width/height from JPEG SOF0/SOF2 marker (0xFFC0 or 0xFFC2).
function readJpegDimensions(jpeg) {
	let i = 2; // skip SOI
	while (i < jpeg.length - 9) {
		if (jpeg[i] !== 0xff) { i++; continue; }
		const marker = jpeg[i + 1];
		if (marker === 0xc0 || marker === 0xc2) {
			const height = jpeg.readUInt16BE(i + 5);
			const width = jpeg.readUInt16BE(i + 7);
			return { width, height };
		}
		const segLen = jpeg.readUInt16BE(i + 2);
		i += 2 + segLen;
	}
	return null;
}

const outDir = '.planning/spikes/004-a1-stream-fallback';
const log = [];
const tlog = (s) => { console.log(s); log.push(s); };

tlog(`[probe] TLS-connecting ${ip}:6000 ...`);
const socket = tls.connect({
	host: ip,
	port: 6000,
	rejectUnauthorized: false,
	timeout: 10_000
});

let buf = Buffer.alloc(0);
let framesDone = 0;
const MAX_FRAMES = Number(process.env.FRAMES ?? 1);
const frameTimestamps = [];
let authSent = false;
let peerCertLogged = false;

socket.on('secureConnect', () => {
	tlog(`[probe] TLS up (authorized=${socket.authorized}, protocol=${socket.getProtocol()})`);
	if (!peerCertLogged) {
		const cert = socket.getPeerCertificate();
		if (cert && cert.subject) {
			tlog(`[probe] peer cert subject: ${JSON.stringify(cert.subject)}`);
			tlog(`[probe] peer cert issuer:  ${JSON.stringify(cert.issuer)}`);
			tlog(`[probe] peer cert valid:   ${cert.valid_from} → ${cert.valid_to}`);
		}
		peerCertLogged = true;
	}
	const auth = buildAuth('bblp', code);
	tlog(`[probe] sending ${auth.length}-byte auth (bblp + access_code)`);
	socket.write(auth);
	authSent = true;
});

socket.on('data', (chunk) => {
	buf = Buffer.concat([buf, chunk]);
	while (buf.length >= 16 && framesDone < MAX_FRAMES) {
		// Parse 16-byte frame header
		const size = buf.readUInt32LE(0);
		if (size === 0 || size > 5_000_000) {
			tlog(`[probe] suspicious frame size=${size}; first 32 bytes hex: ${buf.slice(0, 32).toString('hex')}`);
			socket.destroy();
			return;
		}
		if (buf.length < 16 + size) return; // wait for full frame
		const payload = buf.subarray(16, 16 + size);
		buf = buf.subarray(16 + size);

		// Validate JPEG magic
		const isJpeg = payload[0] === 0xff && payload[1] === 0xd8;
		if (!isJpeg) {
			tlog(`[probe] NOT a JPEG — first 16 bytes: ${payload.slice(0, 16).toString('hex')}`);
			socket.destroy();
			return;
		}
		const eoi = payload[payload.length - 2] === 0xff && payload[payload.length - 1] === 0xd9;
		const dims = readJpegDimensions(payload);
		framesDone++;
		frameTimestamps.push(Date.now());
		// Save only first + last to keep the spike dir tidy
		if (framesDone === 1 || framesDone === MAX_FRAMES) {
			const outPath = `${outDir}/frame-${String(framesDone).padStart(3, '0')}.jpg`;
			fs.writeFileSync(outPath, payload);
			tlog(`[probe] frame ${framesDone}: size=${size} bytes, JPEG_ok=${isJpeg}, EOI_ok=${eoi}, dims=${dims ? `${dims.width}x${dims.height}` : 'unknown'} → saved ${outPath}`);
		} else {
			tlog(`[probe] frame ${framesDone}: size=${size} bytes, dims=${dims ? `${dims.width}x${dims.height}` : 'unknown'}`);
		}
		if (framesDone >= MAX_FRAMES) {
			const elapsed = (frameTimestamps.at(-1) - frameTimestamps[0]) / 1000;
			const fps = framesDone > 1 ? ((framesDone - 1) / elapsed).toFixed(2) : 'n/a';
			tlog(`[probe] captured ${framesDone} frames in ${elapsed.toFixed(2)}s → ~${fps} fps`);
			socket.end();
		}
	}
});

socket.on('error', (err) => {
	tlog(`[probe] ERROR: ${err.message}`);
});

socket.on('close', () => {
	tlog(`[probe] connection closed. auth_sent=${authSent} frames_received=${framesDone}`);
	fs.writeFileSync(`${outDir}/probe-log.txt`, log.join('\n') + '\n');
	process.exit(framesDone > 0 ? 0 : 1);
});

setTimeout(() => {
	if (framesDone === 0) {
		tlog(`[probe] TIMEOUT after 12s — no frame received`);
		socket.destroy();
	}
}, 12_000).unref();

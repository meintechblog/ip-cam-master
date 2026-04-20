#!/usr/bin/env node
// Spike 003: MQTT LAN probe against A1.
// Mirrors production client (src/lib/server/services/bambu-mqtt.ts:155-177).
// Subscribes to device/<SN>/report for 15s, also publishes pushall to force
// a full-state dump. Prints every received payload (access code redacted).
//
// Usage:
//   set -a; source .env.a1; set +a
//   node .planning/spikes/003-a1-mqtt-lan/probe.mjs
import mqtt from 'mqtt';
import fs from 'node:fs';

const ip = process.env.A1_IP;
const sn = process.env.A1_SN;
const code = process.env.A1_ACCESS_CODE;
if (!ip || !sn || !code) {
	console.error('Missing A1_IP / A1_SN / A1_ACCESS_CODE in env. Run: set -a; source .env.a1; set +a');
	process.exit(2);
}

const CAPTURE_MS = 15_000;
const reportTopic = `device/${sn}/report`;
const requestTopic = `device/${sn}/request`;
const seenTopLevelKeys = new Set();
const sampleByKey = new Map();
let messages = 0;

const redact = (s) => String(s).replaceAll(code, '<ACCESS_CODE>');

console.log(`[probe] connecting mqtts://${ip}:8883 as bblp ...`);
const client = mqtt.connect(`mqtts://${ip}:8883`, {
	username: 'bblp',
	password: code,
	rejectUnauthorized: false,
	connectTimeout: 10_000,
	reconnectPeriod: 0,
	clean: true,
	clientId: `ipcm-spike-${Math.random().toString(16).slice(2, 8)}`
});

client.on('connect', () => {
	console.log('[probe] CONNACK ok — subscribing to', reportTopic);
	client.subscribe(reportTopic, (err) => {
		if (err) {
			console.error('[probe] subscribe error:', err.message);
			client.end(true);
			process.exit(1);
		}
		const req = JSON.stringify({
			pushing: { sequence_id: '1', command: 'pushall', version: 1, push_target: 1 }
		});
		console.log('[probe] publishing pushall →', requestTopic);
		client.publish(requestTopic, req, { qos: 0 });
	});
});

client.on('message', (_topic, payload) => {
	messages++;
	const raw = payload.toString();
	let msg;
	try { msg = JSON.parse(raw); } catch { console.log(`[msg ${messages}] <non-json>`, redact(raw.slice(0, 200))); return; }
	const keys = Object.keys(msg);
	for (const k of keys) {
		seenTopLevelKeys.add(k);
		if (!sampleByKey.has(k)) sampleByKey.set(k, msg[k]);
	}
	const tag = keys.join('+');
	const preview = redact(JSON.stringify(msg)).slice(0, 800);
	console.log(`[msg ${messages}] keys=${tag} — ${preview}${preview.length >= 800 ? '…' : ''}`);
	if (messages === 1) {
		fs.writeFileSync(
			'.planning/spikes/003-a1-mqtt-lan/pushall-full.json',
			redact(JSON.stringify(msg, null, 2))
		);
		console.log('[probe] wrote full pushall to pushall-full.json');
	}
});

client.on('error', (err) => {
	console.error('[probe] ERROR:', redact(err.message));
});

setTimeout(() => {
	console.log('\n=== SUMMARY ===');
	console.log(`messages: ${messages}`);
	console.log(`top-level keys observed: ${[...seenTopLevelKeys].join(', ') || '(none)'}`);
	for (const [k, sample] of sampleByKey) {
		const sub = sample && typeof sample === 'object' ? Object.keys(sample).slice(0, 30) : [];
		console.log(`  .${k} → subkeys: ${sub.join(', ')}`);
	}
	client.end(true);
	process.exit(0);
}, CAPTURE_MS);

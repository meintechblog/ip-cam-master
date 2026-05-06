/**
 * yaml-builder.ts — pure function emitting the multi-cam go2rtc YAML for the
 * Protect Hub bridge LXC.
 *
 * Wire-format spec:
 *   - D-PIPE-02 (Loxone-MJPEG ffmpeg form, verbatim)
 *   - D-PIPE-04 (Frigate-RTSP ffmpeg form, verbatim)
 *   - D-PIPE-05 (reconnect flags on every output)
 *   - D-PIPE-06 (slug pattern: `<mac-slug>-<low|high>`)
 *   - D-RCN-01  (canonical hash: strip stamp + sortMapEntries + sha256)
 *   - L-8       (idempotency stamp comment as first line)
 *   - L-9       (api/listen + ui_editor:false; D-API-BIND-01 from P20)
 *
 * Pure: no I/O, no DB, no SSH. Caller (reconcile.ts in Plan 03) is responsible
 * for normalising MAC addresses (via `normalizeMac()` from protect-bridge.ts)
 * before passing OutputRow values in.
 *
 * See: .planning/phases/21-multi-cam-yaml-reconciliation-loop/21-CONTEXT.md
 *      .planning/phases/21-multi-cam-yaml-reconciliation-loop/21-RESEARCH.md
 *      §"Code Examples Example 1" + §"Pattern 2" (canonical hashing).
 */

import { stringify, parse } from 'yaml';
import { createHash } from 'node:crypto';

/** Output type discriminator. Future types (P22+) extend this union. */
export type OutputType = 'loxone-mjpeg' | 'frigate-rtsp';

/**
 * One bridge stream output. The caller pre-normalises `mac` (lowercase hex,
 * no separators) and pre-rewrites `rtspUrl` to `rtsps://...?enableSrtp` form
 * (CR-2 in 21-RESEARCH.md: `protectStreamUrl()` already returns rtsps://).
 */
export interface OutputRow {
	cameraId: number;
	mac: string;
	outputType: OutputType;
	rtspUrl: string;
}

/**
 * Matches the dynamic stamp comment line emitted by `buildBridgeYaml`. Used
 * by `canonicalHash` to strip the per-render stamp BEFORE hashing — without
 * this, every render produces a fresh sha256 and the dedupe is useless.
 *
 * Stamp shape: `# managed by ip-cam-master, reconcile-id <uuid>, ts <iso>\n`
 *
 * The `WARNING` line below the stamp is INTENTIONALLY NOT stripped — it is
 * static across renders so it does not destabilise the hash, and keeping it
 * inside the canonical form adds defense-in-depth against accidental edits.
 */
export const STAMP_REGEX = /^# managed by ip-cam-master, reconcile-id [^\n]+\n/;

const WARNING_LINE = '# WARNING: do not edit by hand — managed by ip-cam-master reconcile loop';

const RECONNECT_SUFFIX = '#raw=-reconnect 1#raw=-reconnect_streamed 1#raw=-reconnect_delay_max 2';

/**
 * D-PIPE-02 verbatim: Loxone-MJPEG ffmpeg source. 640x360 @ 10fps, no audio,
 * VAAPI hardware accel. tls_verify=0 because Protect's RTSPS uses a self-
 * signed cert from the UDM.
 */
function buildLoxoneMjpegSource(rtspUrl: string): string {
	return (
		`ffmpeg:${rtspUrl}` +
		'#input=tls_verify=0' +
		'#video=mjpeg' +
		'#width=640' +
		'#height=360' +
		'#raw=-r 10' +
		'#raw=-an' +
		'#hardware=vaapi' +
		`${RECONNECT_SUFFIX}`
	);
}

/**
 * D-PIPE-04 verbatim: Frigate-RTSP ffmpeg source. Pure passthrough, zero
 * VAAPI cost. `-an` per L-27 (no audio in the Hub pipeline). D-PIPE-05
 * reconnect flags applied per "every output, regardless of type".
 */
function buildFrigateRtspSource(rtspUrl: string): string {
	return (
		`ffmpeg:${rtspUrl}` +
		'#input=tls_verify=0' +
		'#video=copy' +
		'#raw=-an' +
		`${RECONNECT_SUFFIX}`
	);
}

/**
 * D-PIPE-06 slug derivation. MAC is assumed already-normalised by the caller
 * (single-source-of-truth for normalisation lives in
 * `src/lib/server/services/protect-bridge.ts:normalizeMac()`).
 *
 * Suffix wording: `low` for loxone-mjpeg, `high` for frigate-rtsp. Matches
 * the existing `generateGo2rtcConfigLoxone` / `generateGo2rtcConfigBambu`
 * naming convention in `src/lib/server/services/go2rtc.ts`.
 */
function deriveSlug(row: OutputRow): string {
	const suffix = row.outputType === 'loxone-mjpeg' ? 'low' : 'high';
	return `${row.mac}-${suffix}`;
}

function buildFfmpegSource(row: OutputRow): string {
	switch (row.outputType) {
		case 'loxone-mjpeg':
			return buildLoxoneMjpegSource(row.rtspUrl);
		case 'frigate-rtsp':
			return buildFrigateRtspSource(row.rtspUrl);
		default: {
			// Defensive: future output types (P22+) must extend the union AND
			// add a branch here. TS exhaustiveness check + runtime guard.
			const unknownType: string = (row as { outputType: string }).outputType;
			throw new Error(`yaml-builder: unsupported outputType: ${unknownType}`);
		}
	}
}

/**
 * Build the full go2rtc YAML config for the bridge LXC.
 *
 * @param outputs One row per (camera × outputType). Empty array = empty
 *   `streams: {}` block (NOT a thrown error — bridge can run dry).
 * @param reconcileId Reconcile-pass UUID; embedded in the stamp comment.
 * @returns YAML text starting with the L-8 stamp, then a static WARNING
 *   comment, then `yaml.stringify(config, { sortMapEntries: true })`.
 */
export function buildBridgeYaml(outputs: OutputRow[], reconcileId: string): string {
	const stamp = `# managed by ip-cam-master, reconcile-id ${reconcileId}, ts ${new Date().toISOString()}`;

	const streams: Record<string, string[]> = {};
	for (const row of outputs) {
		const slug = deriveSlug(row);
		streams[slug] = [buildFfmpegSource(row)];
	}

	// L-9 + D-API-BIND-01: api binds 0.0.0.0:1984, ui_editor false.
	// rtsp.listen :8554 — the bridge serves Frigate-RTSP outputs from this
	// port (per D-PIPE-04 consumer URL `rtsp://<bridge>:8554/<slug>-high`).
	const config = {
		api: { listen: '0.0.0.0:1984', ui_editor: false },
		rtsp: { listen: ':8554' },
		streams,
		ffmpeg: { bin: 'ffmpeg' },
		log: { level: 'info' }
	};

	// sortMapEntries:true is a Schema option — applies recursively to every
	// nested map in the document tree (verified empirically — Assumption A1
	// in 21-RESEARCH.md). This is what makes canonicalHash stable across
	// caller-side key-insertion-order differences.
	const body = stringify(config, { sortMapEntries: true });
	return `${stamp}\n${WARNING_LINE}\n${body}`;
}

/**
 * Canonical sha256 of a bridge YAML, suitable for the no-op reconcile
 * dedupe path (D-RCN-01 + Pattern 2 in 21-RESEARCH.md).
 *
 * Steps:
 *   1. Strip the per-render stamp comment (first line) — it varies per call
 *      so leaving it in defeats the dedupe.
 *   2. `yaml.parse` then `yaml.stringify({sortMapEntries:true})` to canonicalise
 *      whitespace + key order. Round-trip handles cosmetic differences from
 *      foreign editors that might re-order keys or re-flow whitespace.
 *   3. sha256 of the canonical form.
 *
 * Idempotent w.r.t. the stamp: if the input has no stamp (e.g. raw user-
 * edited file), `replace` returns the original string and parsing still
 * works — hash remains deterministic.
 */
export function canonicalHash(yamlText: string): string {
	const stripped = yamlText.replace(STAMP_REGEX, '');
	const parsed = parse(stripped) ?? {};
	const canonical = stringify(parsed, { sortMapEntries: true });
	return createHash('sha256').update(canonical).digest('hex');
}

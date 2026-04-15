import { describe, it, expect } from 'vitest';
import { parseNotifyPayload, BAMBU_MODEL_ALLOWLIST } from './bambu-discovery';

// Canonical H2C NOTIFY payload, verbatim from
// .planning/research/H2C-FIELD-NOTES.md §SSDP (validated 2026-04-15).
const H2C_PAYLOAD = [
	'NOTIFY * HTTP/1.1',
	'Host: 239.255.255.250:1990',
	'Server: UPnP/1.0',
	'Location: 192.168.3.109',
	'NT: urn:bambulab-com:device:3dprinter:1',
	'NTS: ssdp:alive',
	'USN: 31B8BP611201453',
	'Cache-Control: max-age=1800',
	'DevModel.bambu.com: O1C2',
	'DevName.bambu.com: Bob the Builder',
	'DevConnect.bambu.com: cloud',
	'DevBind.bambu.com: occupied',
	'Devseclink.bambu.com: secure',
	'DevInf.bambu.com: wlan0',
	'DevVersion.bambu.com: 01.01.05.00',
	'DevCap.bambu.com: 1'
].join('\r\n');

// Synthetic A1 payload — same shape, different DevModel + USN + name.
// The A1 at 192.168.3.195 was observed in the field notes' Bonus capture.
const A1_PAYLOAD = [
	'NOTIFY * HTTP/1.1',
	'Host: 239.255.255.250:1900',
	'Server: UPnP/1.0',
	'Location: 192.168.3.195',
	'NT: urn:bambulab-com:device:3dprinter:1',
	'NTS: ssdp:alive',
	'USN: AAAAAAA0000001',
	'Cache-Control: max-age=1800',
	'DevModel.bambu.com: A1',
	'DevName.bambu.com: TestA1'
].join('\r\n');

const GENERIC_UPNP_PAYLOAD = [
	'NOTIFY * HTTP/1.1',
	'Host: 239.255.255.250:1900',
	'Server: UPnP/1.0',
	'Location: http://192.168.3.50:8200/rootDesc.xml',
	'NT: urn:schemas-upnp-org:device:MediaServer:1',
	'NTS: ssdp:alive',
	'USN: uuid:aaaabbbb-cccc-dddd-eeee-ffff00001111::urn:schemas-upnp-org:device:MediaServer:1',
	'Cache-Control: max-age=1800'
].join('\r\n');

const UNKNOWN_MODEL_PAYLOAD = [
	'NOTIFY * HTTP/1.1',
	'Host: 239.255.255.250:1990',
	'Server: UPnP/1.0',
	'Location: 192.168.3.210',
	'NT: urn:bambulab-com:device:3dprinter:1',
	'NTS: ssdp:alive',
	'USN: ZZZZZZZ9999999',
	'DevModel.bambu.com: Z9Z9',
	'DevName.bambu.com: FutureModel'
].join('\r\n');

describe('parseNotifyPayload', () => {
	it('parses the canonical H2C NOTIFY payload from H2C-FIELD-NOTES §SSDP', () => {
		const result = parseNotifyPayload(H2C_PAYLOAD, '192.168.3.109');
		expect(result).toEqual({
			ip: '192.168.3.109',
			serialNumber: '31B8BP611201453',
			model: 'O1C2',
			modelLabel: 'Bambu Lab H2C',
			name: 'Bob the Builder'
		});
	});

	it('parses a synthetic A1 payload (forward-compat allowlist entry)', () => {
		const result = parseNotifyPayload(A1_PAYLOAD, '192.168.3.195');
		expect(result).toEqual({
			ip: '192.168.3.195',
			serialNumber: 'AAAAAAA0000001',
			model: 'A1',
			modelLabel: 'Bambu Lab A1',
			name: 'TestA1'
		});
	});

	it('returns null for a non-Bambu UPnP NOTIFY (wrong NT URN)', () => {
		expect(parseNotifyPayload(GENERIC_UPNP_PAYLOAD, '192.168.3.50')).toBeNull();
	});

	it('returns null for a Bambu-URN NOTIFY with an unknown DevModel', () => {
		expect(parseNotifyPayload(UNKNOWN_MODEL_PAYLOAD, '192.168.3.210')).toBeNull();
	});

	it('allowlist contains the documented model codes', () => {
		expect([...BAMBU_MODEL_ALLOWLIST].sort()).toEqual(
			['A1', 'H2C', 'H2D', 'O1C2', 'P1S', 'X1C'].sort()
		);
	});
});

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, getSettings } from '$lib/server/services/settings';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { NodeSSH } from 'node-ssh';

/** POST — generate SSH key pair (ed25519) at the configured path */
export const POST: RequestHandler = async () => {
	try {
		const keyPath =
			(await getSetting('udm_ssh_key_path')) || '/opt/ip-cam-master/data/udm_key';

		// Ensure parent directory exists
		mkdirSync(dirname(keyPath), { recursive: true });

		// Generate ed25519 key pair (overwrite if exists)
		execSync(`ssh-keygen -t ed25519 -f ${keyPath} -N "" -q <<< y`, {
			shell: '/bin/bash'
		});

		const publicKey = readFileSync(`${keyPath}.pub`, 'utf-8').trim();

		return json({ success: true, publicKey });
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ success: false, error: message }, { status: 500 });
	}
};

/** PUT — test SSH connection to UDM */
export const PUT: RequestHandler = async () => {
	try {
		const settings = await getSettings('unifi_');
		const host = settings.unifi_host;
		if (!host) {
			return json({ success: false, error: 'UniFi Host nicht konfiguriert.' }, { status: 400 });
		}

		const sshHost = host.replace(/:.*$/, '');
		const keyPath =
			(await getSetting('udm_ssh_key_path')) || '/opt/ip-cam-master/data/udm_key';

		if (!existsSync(keyPath)) {
			return json(
				{ success: false, error: 'SSH-Key nicht gefunden. Bitte zuerst generieren.' },
				{ status: 400 }
			);
		}

		const ssh = new NodeSSH();
		await ssh.connect({
			host: sshHost,
			username: 'root',
			privateKeyPath: keyPath,
			readyTimeout: 10000
		});

		// Quick connectivity check
		const result = await ssh.execCommand('echo ok');
		ssh.dispose();

		if (result.stdout.trim() === 'ok') {
			return json({ success: true });
		} else {
			return json({ success: false, error: 'Unerwartete Antwort vom UDM.' }, { status: 500 });
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Unknown error';
		return json({ success: false, error: message }, { status: 500 });
	}
};

import proxmoxApi from 'proxmox-api';
import { getSettings } from './settings';

// Allow self-signed certificates for Proxmox
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

export async function validateProxmoxConnection(): Promise<{
	valid: boolean;
	error?: string;
	nodeName?: string;
}> {
	try {
		const settings = await getSettings('proxmox_');
		if (
			!settings.proxmox_host ||
			!settings.proxmox_token_id ||
			!settings.proxmox_token_secret
		) {
			return { valid: false, error: 'Proxmox not configured. Fill in all fields.' };
		}

		const proxmox = proxmoxApi({
			host: settings.proxmox_host,
			tokenID: settings.proxmox_token_id,
			tokenSecret: settings.proxmox_token_secret
		});

		const nodes = await proxmox.nodes.$get();
		if (!nodes || nodes.length === 0) {
			return { valid: false, error: 'No nodes found. Check API token permissions.' };
		}

		const nodeName = nodes[0].node;
		// Verify LXC access by listing containers
		await proxmox.nodes.$(nodeName).lxc.$get();

		return { valid: true, nodeName };
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('401')) {
			return {
				valid: false,
				error: 'Authentication failed. Verify token ID (format: user@realm!tokenname) and secret.'
			};
		}
		if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
			return { valid: false, error: 'Cannot reach Proxmox host. Check IP/hostname.' };
		}
		return { valid: false, error: `Connection failed: ${message}` };
	}
}

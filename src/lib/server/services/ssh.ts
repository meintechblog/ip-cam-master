import { NodeSSH } from 'node-ssh';
import { getSettings } from './settings';

/**
 * Connects to the Proxmox host via SSH using stored settings.
 * Caller is responsible for calling ssh.dispose() when done.
 */
export async function connectToProxmox(): Promise<NodeSSH> {
	const settings = await getSettings('proxmox_');
	let host = settings.proxmox_host;
	const username = settings.proxmox_ssh_username || 'root';
	const password = settings.proxmox_ssh_password;
	const privateKeyPath = settings.proxmox_ssh_key_path || '/root/.ssh/id_ed25519';

	if (!host) {
		throw new Error('Proxmox host not configured. Set proxmox_host in Settings.');
	}

	// Strip port if present (API uses host:8006, SSH uses port 22)
	host = host.replace(/:.*$/, '');

	const ssh = new NodeSSH();
	if (password) {
		await ssh.connect({ host, username, password });
	} else {
		await ssh.connect({ host, username, privateKeyPath });
	}
	return ssh;
}

/**
 * Executes a command inside an LXC container via pct exec on the Proxmox host.
 */
export async function executeOnContainer(
	ssh: NodeSSH,
	vmid: number,
	command: string
): Promise<{ stdout: string; stderr: string; code: number }> {
	const escapedCommand = command.replace(/'/g, "'\\''");
	const result = await ssh.execCommand(`pct exec ${vmid} -- bash -c '${escapedCommand}'`);
	const code = result.code ?? 0;

	if (code !== 0) {
		throw new Error(result.stderr || `Command failed with exit code ${code}`);
	}

	return { stdout: result.stdout, stderr: result.stderr, code };
}

/**
 * Pushes file content to a path inside an LXC container via pct push.
 */
export async function pushFileToContainer(
	ssh: NodeSSH,
	vmid: number,
	content: string,
	remotePath: string
): Promise<void> {
	const tmpPath = `/tmp/ipcam-${Date.now()}`;

	// Write content to temp file on Proxmox host
	await ssh.execCommand(`cat > ${tmpPath} << 'IPCAMEOF'\n${content}\nIPCAMEOF`);

	// Push to container
	await ssh.execCommand(`pct push ${vmid} ${tmpPath} ${remotePath}`);

	// Clean up temp file
	await ssh.execCommand(`rm ${tmpPath}`);
}

/**
 * Waits for a container to become ready by polling pct exec.
 */
export async function waitForContainerReady(
	ssh: NodeSSH,
	vmid: number,
	timeoutMs: number = 30000
): Promise<boolean> {
	const start = Date.now();
	const interval = 2000;

	while (Date.now() - start < timeoutMs) {
		try {
			const result = await ssh.execCommand(`pct exec ${vmid} -- echo ready`);
			if (result.stdout && result.stdout.includes('ready')) {
				return true;
			}
		} catch {
			// Container not ready yet, continue polling
		}

		await new Promise((resolve) => setTimeout(resolve, interval));
	}

	throw new Error('Container not ready within timeout');
}

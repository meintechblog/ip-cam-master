import proxmoxApi from 'proxmox-api';
import { getSettings } from './settings';
import { db } from '$lib/server/db/client';
import { containers } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { ContainerInfo, ContainerStatus, CameraType } from '$lib/types';

// Allow self-signed certificates for Proxmox
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Cache node name to avoid repeated API calls
let cachedNodeName: string | null = null;

/**
 * Returns a configured proxmox-api client instance.
 */
export async function getProxmoxClient() {
	const settings = await getSettings('proxmox_');
	if (
		!settings.proxmox_host ||
		!settings.proxmox_token_id ||
		!settings.proxmox_token_secret
	) {
		throw new Error('Proxmox not configured. Fill in all fields.');
	}

	// Strip port from host — proxmox-api adds :8006 automatically
	const host = settings.proxmox_host.replace(/:.*$/, '');

	return proxmoxApi({
		host,
		port: 8006,
		tokenID: settings.proxmox_token_id,
		tokenSecret: settings.proxmox_token_secret
	});
}

/**
 * Gets the first node name from the Proxmox cluster. Cached after first call.
 */
export async function getNodeName(proxmox?: ReturnType<typeof proxmoxApi>): Promise<string> {
	if (cachedNodeName) return cachedNodeName;

	const client = proxmox || (await getProxmoxClient());
	const nodes = await client.nodes.$get();
	if (!nodes || nodes.length === 0) {
		throw new Error('No Proxmox nodes found. Check API token permissions.');
	}

	cachedNodeName = nodes[0].node;
	return cachedNodeName;
}

/**
 * Resets the cached node name (useful for testing).
 */
export function resetNodeCache(): void {
	cachedNodeName = null;
}

/**
 * Creates an LXC container on Proxmox with idempotency check (LXC-07).
 * If VMID already exists, updates config instead of creating a duplicate.
 * Automatically configures VAAPI passthrough after creation.
 */
export async function createContainer(params: {
	vmid: number;
	hostname: string;
	ostemplate: string;
	memory?: number;
	cores?: number;
	cameraName?: string;
	cameraIp?: string;
	cameraType?: string;
}): Promise<{ status: 'created' | 'updated'; vmid: number }> {
	const proxmox = await getProxmoxClient();
	const node = await getNodeName(proxmox);
	const settings = await getSettings('proxmox_');
	const bridge = settings.proxmox_bridge || 'vmbr0';
	const storage = settings.proxmox_storage || 'local-lvm';

	// Idempotency check: see if container with this VMID already exists
	const existing = await proxmox.nodes.$(node).lxc.$get();
	const alreadyExists = existing.find((c: { vmid: number }) => c.vmid === params.vmid);

	if (alreadyExists) {
		// Update config instead of creating a duplicate
		const updateParams: Record<string, unknown> = {};
		if (params.memory) updateParams.memory = params.memory;
		if (params.cores) updateParams.cores = params.cores;

		await proxmox.nodes.$(node).lxc.$(params.vmid).config.$put(updateParams as any);

		// Upsert DB record
		db.insert(containers)
			.values({
				vmid: params.vmid,
				hostname: params.hostname,
				cameraName: params.cameraName || null,
				cameraIp: params.cameraIp || null,
				cameraType: params.cameraType || null,
				status: 'stopped',
				updatedAt: new Date().toISOString()
			})
			.onConflictDoUpdate({
				target: containers.vmid,
				set: {
					hostname: params.hostname,
					cameraName: params.cameraName || null,
					cameraIp: params.cameraIp || null,
					cameraType: params.cameraType || null,
					updatedAt: new Date().toISOString()
				}
			})
			.run();

		return { status: 'updated', vmid: params.vmid };
	}

	// Create new container
	await proxmox.nodes.$(node).lxc.$post({
		vmid: params.vmid,
		hostname: params.hostname,
		ostemplate: params.ostemplate,
		rootfs: `${storage}:8`,
		memory: params.memory || 256,
		cores: params.cores || 1,
		net0: `name=eth0,bridge=${bridge},ip=dhcp`,
		start: false
	} as any);

	// Configure VAAPI passthrough (LXC-02)
	await configureVaapi(node, params.vmid);

	// Insert/upsert container record in local DB
	db.insert(containers)
		.values({
			vmid: params.vmid,
			hostname: params.hostname,
			cameraName: params.cameraName || null,
			cameraIp: params.cameraIp || null,
			cameraType: params.cameraType || null,
			status: 'stopped',
			updatedAt: new Date().toISOString()
		})
		.onConflictDoUpdate({
			target: containers.vmid,
			set: {
				hostname: params.hostname,
				cameraName: params.cameraName || null,
				cameraIp: params.cameraIp || null,
				cameraType: params.cameraType || null,
				updatedAt: new Date().toISOString()
			}
		})
		.run();

	return { status: 'created', vmid: params.vmid };
}

/**
 * Configures VAAPI device passthrough on an LXC container (LXC-02).
 * Uses dev0 parameter for /dev/dri/renderD128 (PVE 8.1+).
 * Falls back to direct API call if proxmox-api types don't support dev0.
 */
export async function configureVaapi(node: string, vmid: number): Promise<void> {
	// Device passthrough requires root@pam — API tokens can't do it.
	// Use SSH to the Proxmox host and modify the LXC config directly.
	const { connectToProxmox: connectSSH } = await import('./ssh');
	const ssh = await connectSSH();

	try {
		// Check if dev0 already configured
		const { stdout } = await ssh.execCommand(`pct config ${vmid} | grep 'dev0'`);
		if (stdout && stdout.includes('renderD128')) {
			return; // Already configured
		}

		// Add device passthrough via pct set
		const result = await ssh.execCommand(
			`pct set ${vmid} -dev0 /dev/dri/renderD128,mode=0666`
		);
		if (result.code && result.code !== 0) {
			throw new Error(result.stderr || 'Failed to configure VAAPI passthrough');
		}
	} finally {
		ssh.dispose();
	}
}

/**
 * Starts an LXC container.
 */
export async function startContainer(vmid: number): Promise<void> {
	const proxmox = await getProxmoxClient();
	const node = await getNodeName(proxmox);

	await proxmox.nodes.$(node).lxc.$(vmid).status.start.$post();

	// Update local DB status
	db.update(containers)
		.set({ status: 'running', updatedAt: new Date().toISOString() })
		.where(eq(containers.vmid, vmid))
		.run();
}

/**
 * Stops an LXC container.
 */
export async function stopContainer(vmid: number): Promise<void> {
	const proxmox = await getProxmoxClient();
	const node = await getNodeName(proxmox);

	await proxmox.nodes.$(node).lxc.$(vmid).status.stop.$post();

	// Update local DB status
	db.update(containers)
		.set({ status: 'stopped', updatedAt: new Date().toISOString() })
		.where(eq(containers.vmid, vmid))
		.run();
}

/**
 * Restarts an LXC container.
 */
export async function restartContainer(vmid: number): Promise<void> {
	const proxmox = await getProxmoxClient();
	const node = await getNodeName(proxmox);

	await proxmox.nodes.$(node).lxc.$(vmid).status.reboot.$post();

	// Update local DB status
	db.update(containers)
		.set({ status: 'running', updatedAt: new Date().toISOString() })
		.where(eq(containers.vmid, vmid))
		.run();
}

/**
 * Deletes an LXC container. Stops it first if running.
 */
export async function deleteContainer(vmid: number): Promise<void> {
	const proxmox = await getProxmoxClient();
	const node = await getNodeName(proxmox);

	// Check if container is running, stop first if so
	try {
		const status = await proxmox.nodes.$(node).lxc.$(vmid).status.current.$get();
		if (status && (status as any).status === 'running') {
			await proxmox.nodes.$(node).lxc.$(vmid).status.stop.$post();
		}
	} catch {
		// Container may already be stopped or not exist
	}

	await proxmox.nodes.$(node).lxc.$(vmid).$delete();

	// Remove from local DB
	db.delete(containers)
		.where(eq(containers.vmid, vmid))
		.run();
}

/**
 * Lists all containers, merging Proxmox API data with local DB records.
 */
export async function listContainers(): Promise<ContainerInfo[]> {
	const proxmox = await getProxmoxClient();
	const node = await getNodeName(proxmox);

	// Get containers from Proxmox API
	const apiContainers = await proxmox.nodes.$(node).lxc.$get();

	// Get local DB records for camera metadata
	const dbRecords = db.select().from(containers).all();
	const dbMap = new Map(dbRecords.map((r: any) => [r.vmid, r]));

	const result = apiContainers.map((c: any) => {
		const dbRecord = dbMap.get(c.vmid);
		return {
			vmid: c.vmid,
			hostname: c.name || dbRecord?.hostname || `ct-${c.vmid}`,
			cameraName: dbRecord?.cameraName || undefined,
			cameraIp: dbRecord?.cameraIp || undefined,
			cameraType: dbRecord?.cameraType as CameraType | undefined,
			status: (c.status as ContainerStatus) || 'unknown',
			cpu: c.cpu,
			memory: c.maxmem
				? { used: c.mem || 0, total: c.maxmem }
				: undefined
		} satisfies ContainerInfo;
	});

	result.sort((a, b) => a.vmid - b.vmid);
	return result;
}

/**
 * Gets the status of a single container.
 */
export async function getContainerStatus(vmid: number): Promise<ContainerInfo> {
	const proxmox = await getProxmoxClient();
	const node = await getNodeName(proxmox);

	const status = await proxmox.nodes.$(node).lxc.$(vmid).status.current.$get() as any;

	// Get local DB record for camera metadata
	const dbRecords = db.select().from(containers).where(eq(containers.vmid, vmid)).all();
	const dbRecord = dbRecords[0] as any;

	return {
		vmid: status.vmid || vmid,
		hostname: status.name || dbRecord?.hostname || `ct-${vmid}`,
		cameraName: dbRecord?.cameraName || undefined,
		cameraIp: dbRecord?.cameraIp || undefined,
		cameraType: dbRecord?.cameraType as CameraType | undefined,
		status: (status.status as ContainerStatus) || 'unknown',
		cpu: status.cpu,
		memory: status.maxmem
			? { used: status.mem || 0, total: status.maxmem }
			: undefined
	};
}

/**
 * Validates the Proxmox connection. (From Plan 01)
 */
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

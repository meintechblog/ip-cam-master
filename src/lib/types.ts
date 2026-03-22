export type ContainerStatus = 'running' | 'stopped' | 'error' | 'unknown';
export type CameraType = 'mobotix' | 'loxone' | 'onvif' | 'other';

export interface ProxmoxSettings {
	proxmox_host: string;
	proxmox_token_id: string;
	proxmox_token_secret: string;
	proxmox_storage: string;
	proxmox_bridge: string;
	proxmox_vmid_start: string;
}

export interface UnifiSettings {
	unifi_host: string;
	unifi_username: string;
	unifi_password: string;
}

export interface ContainerInfo {
	vmid: number;
	hostname: string;
	cameraName?: string;
	cameraIp?: string;
	cameraType?: CameraType;
	status: ContainerStatus;
	cpu?: number;
	memory?: { used: number; total: number };
}

export interface ValidationResult {
	valid: boolean;
	error?: string;
	nodeName?: string;
}

export interface SettingRecord {
	key: string;
	value: string;
	encrypted: boolean;
}

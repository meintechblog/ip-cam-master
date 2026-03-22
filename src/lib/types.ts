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

export type CameraStatus = 'pending' | 'container_created' | 'configured' | 'verified';

export interface TranscodeParams {
	width: number;
	height: number;
	fps: number;
	bitrate: number;
}

export interface Camera {
	id: number;
	vmid: number;
	name: string;
	ip: string;
	username: string;
	password: string;
	cameraType: CameraType;
	streamPath: string;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	streamName: string;
	rtspUrl: string | null;
	containerIp: string | null;
	status: CameraStatus;
	createdAt: string;
	updatedAt: string;
}

export interface OnboardingState {
	currentStep: number;
	cameraId: number | null;
	status: CameraStatus;
	error: string | null;
}

export interface StreamInfo {
	active: boolean;
	codec: string | null;
	producers: number;
	resolution: string | null;
	unifiConnected?: boolean;
	unifiStreams?: number;
}

export interface CameraCardData {
	// Camera DB info
	id: number;
	vmid: number;
	name: string;
	cameraIp: string;
	cameraType: CameraType;
	containerIp: string | null;
	streamName: string;
	rtspUrl: string | null;
	status: CameraStatus;
	width: number;
	height: number;
	fps: number;
	bitrate: number;
	// Live status
	containerStatus: ContainerStatus;
	go2rtcRunning: boolean;
	onvifRunning: boolean;
	streamInfo: StreamInfo | null;
	connectedClients: number;
	snapshotUrl: string | null;
	go2rtcWebUrl: string | null;
}

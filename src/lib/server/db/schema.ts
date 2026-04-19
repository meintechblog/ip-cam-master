import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export type CameraType = 'mobotix' | 'mobotix-onvif' | 'loxone' | 'bambu';

export const settings = sqliteTable('settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	key: text('key').notNull().unique(),
	value: text('value').notNull(),
	encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const containers = sqliteTable('containers', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	vmid: integer('vmid').notNull().unique(),
	hostname: text('hostname').notNull(),
	cameraName: text('camera_name'),
	cameraIp: text('camera_ip'),
	cameraType: text('camera_type'),
	status: text('status').notNull().default('unknown'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const cameras = sqliteTable('cameras', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	vmid: integer('vmid').notNull(),
	name: text('name').notNull(),
	ip: text('ip').notNull(),
	username: text('username').notNull(),
	password: text('password').notNull(),
	cameraType: text('camera_type').notNull().default('mobotix'),
	streamPath: text('stream_path').notNull().default('/stream0/mobotix.mjpeg'),
	width: integer('width').notNull().default(1280),
	height: integer('height').notNull().default(720),
	fps: integer('fps').notNull().default(20),
	bitrate: integer('bitrate').notNull().default(2000),
	streamName: text('stream_name').notNull(),
	rtspUrl: text('rtsp_url'),
	containerIp: text('container_ip'),
	status: text('status').notNull().default('pending'),
	accessCode: text('access_code'),
	serialNumber: text('serial_number'),
	printState: text('print_state'),
	streamMode: text('stream_mode').default('adaptive'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString()),
	updatedAt: text('updated_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const credentials = sqliteTable('credentials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	username: text('username').notNull(),
	password: text('password').notNull(),
	priority: integer('priority').notNull().default(0),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull(),
	passwordHash: text('password_hash').notNull(),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

export const events = sqliteTable('events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	cameraId: integer('camera_id'),
	cameraName: text('camera_name'),
	eventType: text('event_type').notNull(),
	severity: text('severity').notNull().default('info'),
	message: text('message').notNull(),
	source: text('source').notNull(),
	timestamp: text('timestamp')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

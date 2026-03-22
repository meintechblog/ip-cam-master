import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

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

export const credentials = sqliteTable('credentials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	name: text('name').notNull(),
	username: text('username').notNull(),
	password: text('password').notNull(),
	cameraIp: text('camera_ip'),
	createdAt: text('created_at')
		.notNull()
		.$defaultFn(() => new Date().toISOString())
});

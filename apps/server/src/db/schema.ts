import { sql } from 'drizzle-orm';
import { blob, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
};

/** Sucursal / sitio. */
export const sites = sqliteTable('sites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Zona horaria IANA, ej. "America/Argentina/Buenos_Aires". */
  timezone: text('timezone').notNull().default('America/Argentina/Buenos_Aires'),
  ...timestamps,
});

/** Equipo físico (lector, terminal, portero). La marca define qué driver se usa. */
export const devices = sqliteTable('devices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  siteId: integer('site_id').notNull().references(() => sites.id),
  name: text('name').notNull(),
  brand: text('brand').notNull(),
  host: text('host').notNull(),
  username: text('username').notNull(),
  /** Contraseña cifrada con CAREADOR_SECRET (ver lib/crypto.ts). */
  passwordEnc: text('password_enc').notNull(),
  https: integer('https', { mode: 'boolean' }).notNull().default(false),
  utcOffset: text('utc_offset').notNull().default('-03:00'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  /** No enviar cambios al equipo (sólo leer personas y marcaciones). */
  readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(false),
  /** Datos informados por el equipo. */
  model: text('model'),
  serialNumber: text('serial_number'),
  firmware: text('firmware'),
  /** Hasta dónde se leyeron marcaciones. */
  eventsSyncedUntil: integer('events_synced_until', { mode: 'timestamp' }),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
  lastError: text('last_error'),
  ...timestamps,
});

/** Empleado / persona. `code` es el identificador que se carga en los equipos. */
export const employees = sqliteTable(
  'employees',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    code: text('code').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    documentNumber: text('document_number'),
    /** Sucursal principal (para reportes y horario por defecto). */
    siteId: integer('site_id').references(() => sites.id),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('employees_code_uq').on(t.code)],
);

/** Foto facial vigente del empleado (JPEG ya adaptado para los equipos). */
export const employeeFaces = sqliteTable('employee_faces', {
  employeeId: integer('employee_id')
    .primaryKey()
    .references(() => employees.id, { onDelete: 'cascade' }),
  jpeg: blob('jpeg', { mode: 'buffer' }).notNull(),
  ...timestamps,
});

/** Estado de sincronización de cada empleado en cada equipo. */
export const enrollments = sqliteTable(
  'enrollments',
  {
    deviceId: integer('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'synced', 'error', 'pending_delete'] })
      .notNull()
      .default('pending'),
    faceSynced: integer('face_synced', { mode: 'boolean' }).notNull().default(false),
    lastError: text('last_error'),
    syncedAt: integer('synced_at', { mode: 'timestamp' }),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.employeeId] })],
);

/** Marcaciones y eventos leídos de los equipos. */
export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    deviceId: integer('device_id')
      .notNull()
      .references(() => devices.id),
    deviceEventId: text('device_event_id').notNull(),
    time: integer('time', { mode: 'timestamp' }).notNull(),
    kind: text('kind').notNull(),
    verifyMode: text('verify_mode').notNull(),
    /** Código de persona tal como lo informó el equipo. */
    personCode: text('person_code'),
    employeeId: integer('employee_id').references(() => employees.id),
    doorNo: integer('door_no'),
    raw: text('raw', { mode: 'json' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('events_device_event_uq').on(t.deviceId, t.deviceEventId),
    index('events_employee_time_idx').on(t.employeeId, t.time),
    index('events_time_idx').on(t.time),
  ],
);

/** Usuarios de la app (dueños / encargados). */
export const appUsers = sqliteTable(
  'app_users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role', { enum: ['admin', 'manager'] }).notNull().default('manager'),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('app_users_email_uq').on(t.email)],
);

/** Sesiones de login. Se guarda el hash del token, nunca el token. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(), // sha256(token) en hex
    userId: integer('user_id')
      .notNull()
      .references(() => appUsers.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

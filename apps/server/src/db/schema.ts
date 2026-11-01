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
  /** Horario que tiene el personal de la sucursal si no tiene uno propio. */
  scheduleId: integer('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
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
    /** null en las marcaciones importadas de un Excel (historial de HikCentral). */
    deviceId: integer('device_id').references(() => devices.id),
    /** 'device' = leída de un equipo; 'import' = importada de un Excel; 'manual' = corregida a mano (raw: motivo y quién). */
    source: text('source', { enum: ['device', 'import', 'manual'] }).notNull().default('device'),
    deviceEventId: text('device_event_id').notNull(),
    time: integer('time', { mode: 'timestamp' }).notNull(),
    kind: text('kind').notNull(),
    verifyMode: text('verify_mode').notNull(),
    /** Código de persona tal como lo informó el equipo. */
    personCode: text('person_code'),
    employeeId: integer('employee_id').references(() => employees.id),
    /** Nombre tal como venía en el Excel importado (para vincularlo con el empleado cuando exista). */
    personName: text('person_name'),
    doorNo: integer('door_no'),
    raw: text('raw', { mode: 'json' }),
    /** Marca anulada a mano (no cuenta para entrada/salida, pero no se borra). */
    voidedAt: integer('voided_at', { mode: 'timestamp' }),
    voidedBy: text('voided_by'),
    voidReason: text('void_reason'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('events_device_event_uq').on(t.deviceId, t.deviceEventId),
    uniqueIndex('events_import_uq').on(t.deviceEventId).where(sql`source = 'import'`),
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
    /** Contraseña provisoria (la puso un admin): hasta cambiarla no puede usar la app. */
    mustChangePassword: integer('must_change_password', { mode: 'boolean' }).notNull().default(false),
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

/** Horario de un día: entrada y salida en hora local "HH:MM". */
export interface DaySchedule {
  start: string;
  end: string;
}

/** Horario semanal (ej. "Lun-Vie Arsa 1 + sábados"). */
export const schedules = sqliteTable('schedules', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** 7 posiciones, 0 = domingo (como Date.getDay()); null = no trabaja ese día. */
  days: text('days', { mode: 'json' }).$type<(DaySchedule | null)[]>().notNull(),
  /** Minutos de gracia: llegar hasta N min tarde o salir N min antes no cuenta. */
  lateToleranceMin: integer('late_tolerance_min').notNull().default(15),
  earlyToleranceMin: integer('early_tolerance_min').notNull().default(15),
  ...timestamps,
});

/** Horario propio de un empleado, con vigencia (fechas "AAAA-MM-DD", hasta inclusive; null = sin fin). */
export const scheduleAssignments = sqliteTable(
  'schedule_assignments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    scheduleId: integer('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    validFrom: text('valid_from').notNull(),
    validTo: text('valid_to'),
  },
  (t) => [index('schedule_assignments_employee_idx').on(t.employeeId)],
);

export const ABSENCE_KINDS = [
  'vacaciones',
  'franco',
  'licencia',
  'enfermedad',
  'feriado',
  'permiso_tarde',
  'permiso_salida',
  'horario_especial',
  'otro',
] as const;
export type AbsenceKind = (typeof ABSENCE_KINDS)[number];

/**
 * Novedad: vacaciones, franco, licencia, feriado, permiso… entre dos fechas (inclusive, "AAAA-MM-DD").
 * Sin empleado = para todos (feriados).
 */
export const absences = sqliteTable(
  'absences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    employeeId: integer('employee_id').references(() => employees.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ABSENCE_KINDS }).notNull(),
    dateFrom: text('date_from').notNull(),
    dateTo: text('date_to').notNull(),
    /** Sólo «horario_especial»: entrada y salida "HH:MM" que reemplazan al horario esos días. */
    startTime: text('start_time'),
    endTime: text('end_time'),
    note: text('note'),
    createdBy: integer('created_by').references(() => appUsers.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [index('absences_dates_idx').on(t.dateFrom, t.dateTo)],
);

/** Certificados y otros comprobantes adjuntos a una novedad. */
export const absenceFiles = sqliteTable('absence_files', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  absenceId: integer('absence_id')
    .notNull()
    .references(() => absences.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mime: text('mime').notNull(),
  data: blob('data', { mode: 'buffer' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
});

/**
 * Historial de cambios hechos en la app: quién, cuándo, qué y por qué. Nunca se edita ni se borra.
 * `employeeId` y `date` permiten ver el historial de una persona o de un día.
 */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
    userId: integer('user_id'),
    userName: text('user_name').notNull(),
    /** Ej.: "marca.agregar", "marca.anular", "novedad.crear", "horario.editar". */
    action: text('action').notNull(),
    /** Texto para leer: "Agregó salida 18:00 (se olvidó de marcar)". */
    summary: text('summary').notNull(),
    employeeId: integer('employee_id'),
    date: text('date'),
    /** Datos antes/después para auditoría. */
    detail: text('detail', { mode: 'json' }),
  },
  (t) => [index('audit_employee_idx').on(t.employeeId, t.date), index('audit_at_idx').on(t.at)],
);

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContext } from '../app';
import { auditLog } from '../db/schema';

export interface AuditEntry {
  /** Ej.: "marca.agregar", "PUT /api/schedules/:id". */
  action: string;
  /** Texto para leer en el historial. */
  summary: string;
  employeeId?: number | null;
  /** Día afectado "AAAA-MM-DD" (marcas). */
  date?: string | null;
  detail?: unknown;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Cómo estaba lo que se borra o cambia, para guardarlo en el historial. */
    auditBefore?: unknown;
  }
}

/** Deja asentado un cambio hecho en la app, con el usuario que lo hizo. */
export function audit(ctx: AppContext, req: FastifyRequest | null, e: AuditEntry) {
  ctx.db
    .insert(auditLog)
    .values({
      userId: req?.user?.id ?? null,
      userName: req?.user?.name ?? 'Sistema',
      action: e.action,
      summary: e.summary,
      employeeId: e.employeeId ?? null,
      date: e.date ?? null,
      detail: e.detail ?? null,
    })
    .run();
}

type Body = Record<string, unknown>;
const KIND: Record<string, string> = {
  vacaciones: 'vacaciones',
  franco: 'franco',
  licencia: 'licencia',
  enfermedad: 'enfermedad',
  feriado: 'feriado',
  permiso_tarde: 'permiso de llegada tarde',
  permiso_salida: 'permiso de salida anticipada',
  horario_especial: 'horario especial',
  otro: 'novedad',
};
const range = (b: Body) => (b.dateFrom === b.dateTo ? `el ${b.dateFrom}` : `del ${b.dateFrom} al ${b.dateTo}`);

/** Texto del historial para cada cambio que se hace desde la app (las marcas se registran solas, con más detalle). */
const LABELS: Record<string, (b: Body) => string> = {
  'POST /api/employees': (b) => `Dio de alta a ${b.lastName}, ${b.firstName}`,
  'PATCH /api/employees/:id': (b) =>
    b.active === false ? 'Dio de baja al empleado' : b.active === true ? 'Volvió a dar de alta al empleado' : 'Editó los datos del empleado',
  'PUT /api/employees/:id/face': () => 'Cambió la foto',
  'PUT /api/employees/:id/schedule': (b) =>
    b.scheduleId ? `Le asignó un horario propio desde ${b.from ?? 'hoy'}` : `Volvió al horario de su sucursal desde ${b.from ?? 'hoy'}`,
  'POST /api/devices/:id/import-persons': () => 'Importó las personas de un equipo',
  'POST /api/schedules': (b) => `Creó el horario «${b.name}»`,
  'PUT /api/schedules/:id': (b) => `Editó el horario «${b.name}»`,
  'DELETE /api/schedules/:id': () => 'Borró un horario',
  'PUT /api/sites/:id/schedule': () => 'Cambió el horario por defecto de una sucursal',
  'POST /api/absences': (b) => `Cargó ${KIND[b.kind as string] ?? 'novedad'} ${range(b)}${b.note ? `: ${b.note}` : ''}`,
  'PUT /api/absences/:id': (b) => `Editó ${KIND[b.kind as string] ?? 'novedad'} ${range(b)}${b.note ? `: ${b.note}` : ''}`,
  'DELETE /api/absences/:id': () => 'Borró una novedad',
  'POST /api/absences/:id/files': () => 'Adjuntó un comprobante',
  'DELETE /api/absence-files/:id': () => 'Borró un comprobante',
  'POST /api/sites': (b) => `Creó la sucursal «${b.name}»`,
  'POST /api/devices': (b) => `Agregó el equipo «${b.name}» (${b.host})`,
  'DELETE /api/devices/:id': () => 'Borró un equipo',
  'PATCH /api/devices/:id': (b) =>
    b.readOnly === false
      ? 'Habilitó la escritura en un equipo'
      : b.readOnly === true
        ? 'Pasó un equipo a sólo lectura'
        : b.enabled === false
          ? 'Desactivó un equipo'
          : `Editó un equipo${b.password ? ' y cambió la contraseña' : ''}`,
  'POST /api/history/hikcentral': () => 'Importó el historial de HikCentral',
};

/** Lo que se guarda del cuerpo: nunca contraseñas ni archivos. */
function safe(body: unknown) {
  if (Buffer.isBuffer(body)) return { archivo: `${Math.round(body.length / 1024)} KB` };
  if (!body || typeof body !== 'object') return null;
  return Object.fromEntries(Object.entries(body as Body).filter(([k]) => !/password|clave/i.test(k)));
}

/** Registra en el historial todo cambio exitoso de la tabla LABELS. */
export function auditChanges(app: FastifyInstance, ctx: AppContext) {
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || reply.statusCode >= 400) return;
    const key = `${req.method} ${req.routeOptions.url}`;
    const label = LABELS[key];
    if (!label) return;
    const body = (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body) ? req.body : {}) as Body;
    const params = req.params as { id?: string };
    const employeeId = req.routeOptions.url?.startsWith('/api/employees/:id')
      ? Number(params.id)
      : typeof body.employeeId === 'number'
        ? body.employeeId
        : null;
    audit(ctx, req, {
      action: key,
      summary: label(body),
      employeeId,
      detail: { id: params.id ?? null, body: safe(req.body), before: req.auditBefore ?? null },
    });
  });
}

import { and, asc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import {
  ABSENCE_KINDS,
  absenceFiles,
  absences,
  employees,
  scheduleAssignments,
  schedules,
  sites,
} from '../db/schema';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const day = z
  .object({ start: hhmm, end: hhmm })
  .refine((d) => d.start < d.end, 'La salida tiene que ser después de la entrada')
  .nullable();

const scheduleInput = z.object({
  name: z.string().trim().min(1).max(60),
  days: z.array(day).length(7),
  lateToleranceMin: z.number().int().min(0).max(240).default(15),
  earlyToleranceMin: z.number().int().min(0).max(240).default(15),
});

const absenceInput = z
  .object({
    employeeId: z.number().int().positive().nullable(),
    kind: z.enum(ABSENCE_KINDS),
    dateFrom: date,
    dateTo: date,
    startTime: hhmm.nullish(),
    endTime: hhmm.nullish(),
    note: z.string().trim().max(500).nullish(),
  })
  .refine((a) => a.dateFrom <= a.dateTo, 'La fecha hasta tiene que ser igual o posterior a la desde')
  .refine(
    (a) => a.kind !== 'horario_especial' || (a.startTime && a.endTime && a.startTime < a.endTime),
    'El horario especial necesita entrada y salida, con la salida después de la entrada',
  )
  .transform((a) => (a.kind === 'horario_especial' ? a : { ...a, startTime: null, endTime: null }))
  .refine((a) => a.employeeId !== null || a.kind === 'feriado', 'Sólo los feriados pueden ser para todos');

/** Comprobantes: fotos (la web las achica) o PDF. */
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const notFound = (what: string) => Object.assign(new Error(`${what} inexistente`), { statusCode: 404 });

/** "AAAA-MM-DD" del día anterior. */
function dayBefore(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y!, m! - 1, d! - 1).toLocaleDateString('sv');
}

/**
 * Horario de cada empleado en una fecha: el propio vigente o, si no tiene, el de la sucursal indicada
 * (Asistencia pasa la sucursal donde marcó la entrada, porque el personal rota).
 */
export function schedulesOn(ctx: AppContext, ymd: string) {
  const { db } = ctx;
  const all = new Map(db.select().from(schedules).all().map((s) => [s.id, s]));
  const siteDefault = new Map(db.select().from(sites).all().map((s) => [s.id, s.scheduleId]));
  const own = new Map(
    db
      .select()
      .from(scheduleAssignments)
      .where(and(lte(scheduleAssignments.validFrom, ymd), or(isNull(scheduleAssignments.validTo), gte(scheduleAssignments.validTo, ymd))))
      .all()
      .map((a) => [a.employeeId, a.scheduleId]),
  );
  return (employeeId: number, siteId: number | null) => {
    const id = own.get(employeeId) ?? (siteId ? siteDefault.get(siteId) : null);
    return (id && all.get(id)) || null;
  };
}

/** Novedades que tocan una fecha, por empleado (las de todos van en la clave null). */
export function absencesOn(ctx: AppContext, ymd: string) {
  const rows = ctx.db
    .select({
      id: absences.id,
      employeeId: absences.employeeId,
      kind: absences.kind,
      note: absences.note,
      startTime: absences.startTime,
      endTime: absences.endTime,
    })
    .from(absences)
    .where(and(lte(absences.dateFrom, ymd), gte(absences.dateTo, ymd)))
    .all();
  return (employeeId: number) => rows.filter((a) => a.employeeId === employeeId || a.employeeId === null);
}

export async function scheduleRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // ---------------------------------------------------------------- Horarios

  app.get('/api/schedules', async () => db.select().from(schedules).orderBy(asc(schedules.name)).all());

  app.post('/api/schedules', async (req, reply) => {
    const [row] = db.insert(schedules).values(scheduleInput.parse(req.body)).returning().all();
    return reply.code(201).send(row);
  });

  app.put<{ Params: { id: string } }>('/api/schedules/:id', async (req) => {
    req.auditBefore = db.select().from(schedules).where(eq(schedules.id, Number(req.params.id))).get();
    const [row] = db
      .update(schedules)
      .set({ ...scheduleInput.parse(req.body), updatedAt: new Date() })
      .where(eq(schedules.id, Number(req.params.id)))
      .returning()
      .all();
    if (!row) throw notFound('Horario');
    return row;
  });

  app.delete<{ Params: { id: string } }>('/api/schedules/:id', async (req) => {
    const id = Number(req.params.id);
    req.auditBefore = db.select().from(schedules).where(eq(schedules.id, id)).get();
    // Las sucursales que lo usaban quedan sin horario por defecto; las asignaciones propias se borran (cascade).
    db.update(sites).set({ scheduleId: null }).where(eq(sites.scheduleId, id)).run();
    if (!db.delete(schedules).where(eq(schedules.id, id)).run().changes) throw notFound('Horario');
    return { ok: true };
  });

  /** Horario por defecto de la sucursal. */
  app.put<{ Params: { id: string } }>('/api/sites/:id/schedule', async (req) => {
    const { scheduleId } = z.object({ scheduleId: z.number().int().positive().nullable() }).parse(req.body);
    const [row] = db.update(sites).set({ scheduleId }).where(eq(sites.id, Number(req.params.id))).returning().all();
    if (!row) throw notFound('Sucursal');
    return row;
  });

  /** Asignaciones propias de cada empleado (para mostrar el horario actual y el historial). */
  app.get('/api/schedule-assignments', async () =>
    db.select().from(scheduleAssignments).orderBy(asc(scheduleAssignments.validFrom)).all(),
  );

  /**
   * Cambia el horario de un empleado desde una fecha (por defecto hoy). Lo anterior queda como historial.
   * scheduleId null = vuelve al de su sucursal.
   */
  app.put<{ Params: { id: string } }>('/api/employees/:id/schedule', async (req) => {
    const employeeId = Number(req.params.id);
    const body = z
      .object({ scheduleId: z.number().int().positive().nullable(), from: date.optional() })
      .parse(req.body);
    const from = body.from ?? new Date().toLocaleDateString('sv');
    if (!db.select().from(employees).where(eq(employees.id, employeeId)).get()) throw notFound('Empleado');
    if (body.scheduleId && !db.select().from(schedules).where(eq(schedules.id, body.scheduleId)).get()) {
      throw notFound('Horario');
    }
    db.transaction((tx) => {
      const mine = eq(scheduleAssignments.employeeId, employeeId);
      tx.delete(scheduleAssignments).where(and(mine, gte(scheduleAssignments.validFrom, from))).run();
      tx.update(scheduleAssignments)
        .set({ validTo: dayBefore(from) })
        .where(and(mine, or(isNull(scheduleAssignments.validTo), gte(scheduleAssignments.validTo, from))))
        .run();
      if (body.scheduleId) {
        tx.insert(scheduleAssignments).values({ employeeId, scheduleId: body.scheduleId, validFrom: from }).run();
      }
    });
    return { ok: true };
  });

  // --------------------------------------------------------------- Novedades

  function withFiles<T extends { id: number }>(rows: T[]) {
    const files = db
      .select({ id: absenceFiles.id, absenceId: absenceFiles.absenceId, fileName: absenceFiles.fileName, mime: absenceFiles.mime })
      .from(absenceFiles)
      .all();
    return rows.map((r) => ({ ...r, files: files.filter((f) => f.absenceId === r.id) }));
  }

  /** Novedades que tocan el rango [desde, hasta] (por defecto, de hace 30 días en adelante). */
  app.get('/api/absences', async (req) => {
    const q = z.object({ from: date.optional(), to: date.optional(), employeeId: z.coerce.number().int().optional() }).parse(req.query);
    const from = q.from ?? new Date(Date.now() - 30 * 86_400_000).toLocaleDateString('sv');
    const rows = db
      .select()
      .from(absences)
      .where(
        and(
          gte(absences.dateTo, from),
          q.to ? lte(absences.dateFrom, q.to) : undefined,
          q.employeeId ? or(eq(absences.employeeId, q.employeeId), isNull(absences.employeeId)) : undefined,
        ),
      )
      .orderBy(asc(absences.dateFrom))
      .all();
    return withFiles(rows);
  });

  app.post('/api/absences', async (req, reply) => {
    const input = absenceInput.parse(req.body);
    if (input.employeeId && !db.select().from(employees).where(eq(employees.id, input.employeeId)).get()) {
      throw notFound('Empleado');
    }
    const [row] = db
      .insert(absences)
      .values({ ...input, createdBy: req.user?.id ?? null })
      .returning()
      .all();
    return reply.code(201).send(withFiles([row!])[0]);
  });

  app.put<{ Params: { id: string } }>('/api/absences/:id', async (req) => {
    req.auditBefore = db.select().from(absences).where(eq(absences.id, Number(req.params.id))).get();
    const [row] = db
      .update(absences)
      .set({ ...absenceInput.parse(req.body), updatedAt: new Date() })
      .where(eq(absences.id, Number(req.params.id)))
      .returning()
      .all();
    if (!row) throw notFound('Novedad');
    return withFiles([row])[0];
  });

  app.delete<{ Params: { id: string } }>('/api/absences/:id', async (req) => {
    req.auditBefore = db.select().from(absences).where(eq(absences.id, Number(req.params.id))).get();
    if (!db.delete(absences).where(eq(absences.id, Number(req.params.id))).run().changes) throw notFound('Novedad');
    return { ok: true };
  });

  /** Adjunta un comprobante (body: el archivo crudo; ?name=certificado.pdf). */
  app.post<{ Params: { id: string }; Querystring: { name?: string } }>('/api/absences/:id/files', async (req, reply) => {
    const absenceId = Number(req.params.id);
    if (!db.select().from(absences).where(eq(absences.id, absenceId)).get()) throw notFound('Novedad');
    const mime = (req.headers['content-type'] ?? '').split(';')[0]!.trim();
    const data = req.body;
    if (!FILE_TYPES.includes(mime) || !Buffer.isBuffer(data)) {
      return reply.code(400).send({ error: 'Sólo fotos o PDF' });
    }
    if (data.length > MAX_FILE_BYTES) return reply.code(400).send({ error: 'El archivo pesa más de 4 MB' });
    const fileName = (req.query.name ?? 'comprobante').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 100) || 'comprobante';
    const [row] = db
      .insert(absenceFiles)
      .values({ absenceId, fileName, mime, data })
      .returning({ id: absenceFiles.id, absenceId: absenceFiles.absenceId, fileName: absenceFiles.fileName, mime: absenceFiles.mime })
      .all();
    return reply.code(201).send(row);
  });

  app.get<{ Params: { id: string } }>('/api/absence-files/:id', async (req, reply) => {
    const f = db.select().from(absenceFiles).where(eq(absenceFiles.id, Number(req.params.id))).get();
    if (!f) throw notFound('Archivo');
    return reply
      .header('Cache-Control', 'private, max-age=86400')
      .header('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.fileName)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .type(f.mime)
      .send(f.data);
  });

  app.delete<{ Params: { id: string } }>('/api/absence-files/:id', async (req) => {
    // El archivo en sí se borra; en el historial queda de qué novedad era y cómo se llamaba.
    req.auditBefore = db
      .select({ absenceId: absenceFiles.absenceId, fileName: absenceFiles.fileName, mime: absenceFiles.mime })
      .from(absenceFiles)
      .where(eq(absenceFiles.id, Number(req.params.id)))
      .get();
    if (!db.delete(absenceFiles).where(eq(absenceFiles.id, Number(req.params.id))).run().changes) throw notFound('Archivo');
    return { ok: true };
  });
}

import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../app';
import { auditLog, employees, events } from '../db/schema';
import { audit } from '../lib/audit';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora HH:MM');
const reason = z.string().trim().min(3, 'Poné el motivo').max(300);

const pad = (n: number) => String(n).padStart(2, '0');
const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const notFound = (what: string) => Object.assign(new Error(`${what} inexistente`), { statusCode: 404 });

/**
 * Correcciones de marcas, siempre con motivo y sin perder nada:
 * - agregar una marca que faltó (origen «manual»);
 * - cambiar la hora: las manuales se editan; las de los equipos se anulan y se agrega una manual;
 * - anular / restaurar cualquier marca (la anulada no cuenta, pero queda).
 * Todo queda en el historial de cambios (audit_log).
 */
export async function markRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  function addManual(req: FastifyRequest, emp: { id: number; code: string }, at: Date, note: string) {
    const [row] = db
      .insert(events)
      .values({
        deviceId: null,
        source: 'manual',
        deviceEventId: `manual:${randomUUID()}`,
        time: at,
        kind: 'access_granted',
        verifyMode: 'unknown',
        personCode: emp.code,
        employeeId: emp.id,
        raw: { note, by: req.user?.name ?? '?', userId: req.user?.id ?? null, at: new Date().toISOString() },
      })
      .returning()
      .all();
    return row!;
  }

  function getMark(id: number) {
    const mark = db.select().from(events).where(eq(events.id, id)).get();
    if (!mark?.employeeId) throw notFound('Marca');
    return mark as typeof mark & { employeeId: number };
  }

  app.post('/api/marks', async (req, reply) => {
    const m = z.object({ employeeId: z.number().int().positive(), date, time: hhmm, note: reason }).parse(req.body);
    const emp = db.select().from(employees).where(eq(employees.id, m.employeeId)).get();
    if (!emp) throw notFound('Empleado');
    const [y, mo, d] = m.date.split('-').map(Number);
    const [h, mi] = m.time.split(':').map(Number);
    const row = addManual(req, emp, new Date(y!, mo! - 1, d!, h!, mi!), m.note);
    audit(ctx, req, {
      action: 'marca.agregar',
      summary: `Agregó una marca a las ${m.time}: ${m.note}`,
      employeeId: emp.id,
      date: m.date,
      detail: { markId: row.id },
    });
    return reply.code(201).send({ id: row.id });
  });

  /** Cambia la hora de una marca. */
  app.put<{ Params: { id: string } }>('/api/marks/:id', async (req) => {
    const body = z.object({ time: hhmm, reason }).parse(req.body);
    const mark = getMark(Number(req.params.id));
    if (mark.voidedAt) throw Object.assign(new Error('La marca está anulada: restaurala primero'), { statusCode: 400 });
    const day = mark.time.toLocaleDateString('sv');
    const [h, mi] = body.time.split(':').map(Number);
    const at = new Date(mark.time);
    at.setHours(h!, mi!, 0, 0);
    const before = timeOf(mark.time);
    let id = mark.id;
    if (mark.source === 'manual') {
      const raw = (mark.raw ?? {}) as Record<string, unknown>;
      db.update(events)
        .set({ time: at, raw: { ...raw, note: `${raw.note ?? ''} · cambiada: ${body.reason}`.replace(/^ · /, '') } })
        .where(eq(events.id, mark.id))
        .run();
    } else {
      // Lo que leyó el equipo no se toca: se anula y se agrega la corregida.
      db.update(events)
        .set({ voidedAt: new Date(), voidedBy: req.user?.name ?? '?', voidReason: `Cambiada a ${body.time}: ${body.reason}` })
        .where(eq(events.id, mark.id))
        .run();
      const emp = db.select().from(employees).where(eq(employees.id, mark.employeeId)).get()!;
      id = addManual(req, emp, at, body.reason).id;
    }
    audit(ctx, req, {
      action: 'marca.cambiar',
      summary: `Cambió la marca de las ${before} a las ${body.time}: ${body.reason}`,
      employeeId: mark.employeeId,
      date: day,
      detail: { markId: mark.id, newMarkId: id, before, after: body.time, source: mark.source },
    });
    return { id };
  });

  /** Anula una marca: deja de contar para entrada/salida, pero queda guardada. */
  app.post<{ Params: { id: string } }>('/api/marks/:id/void', async (req) => {
    const body = z.object({ reason }).parse(req.body);
    const mark = getMark(Number(req.params.id));
    db.update(events)
      .set({ voidedAt: new Date(), voidedBy: req.user?.name ?? '?', voidReason: body.reason })
      .where(eq(events.id, mark.id))
      .run();
    audit(ctx, req, {
      action: 'marca.anular',
      summary: `Anuló la marca de las ${timeOf(mark.time)}: ${body.reason}`,
      employeeId: mark.employeeId,
      date: mark.time.toLocaleDateString('sv'),
      detail: { markId: mark.id, source: mark.source },
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/marks/:id/restore', async (req) => {
    const mark = getMark(Number(req.params.id));
    db.update(events).set({ voidedAt: null, voidedBy: null, voidReason: null }).where(eq(events.id, mark.id)).run();
    audit(ctx, req, {
      action: 'marca.restaurar',
      summary: `Restauró la marca de las ${timeOf(mark.time)}, anulada por: ${mark.voidReason ?? 'sin motivo'}`,
      employeeId: mark.employeeId,
      date: mark.time.toLocaleDateString('sv'),
      detail: { markId: mark.id },
    });
    return { ok: true };
  });

  /** Historial de cambios (de una persona y/o un día, o los últimos de todo). */
  app.get('/api/audit', async (req) => {
    const q = z
      .object({ employeeId: z.coerce.number().int().optional(), date: date.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) })
      .parse(req.query);
    const rows = db
      .select({ log: auditLog, first: employees.firstName, last: employees.lastName })
      .from(auditLog)
      .leftJoin(employees, eq(employees.id, auditLog.employeeId))
      .where(
        and(
          q.employeeId ? eq(auditLog.employeeId, q.employeeId) : undefined,
          q.date ? eq(auditLog.date, q.date) : undefined,
        ),
      )
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(q.limit)
      .all();
    return rows.map(({ log, first, last }) => ({ ...log, employee: last ? `${last}, ${first}` : null }));
  });
}

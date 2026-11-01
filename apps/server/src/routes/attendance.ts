import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AppContext } from '../app';
import { devices, employees, events } from '../db/schema';
import { dayAttendance } from '../lib/attendance';
import { importRecords, parseHikcentralRecords } from '../lib/history';
import { buildReport, reportQuery, reportXlsx } from '../lib/report';

const dayQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export async function attendanceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, events: eventSync } = ctx;

  /** Trae ya las marcaciones de los equipos (y espera). */
  app.post('/api/events/sync', async () => eventSync.run());

  /** Importa el Excel «Registros de entradas y salidas» de HikCentral (body: el .xlsx crudo). */
  app.post('/api/history/hikcentral', async (req, reply) => {
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: 'Mandá el archivo .xlsx' });
    return importRecords(ctx, await parseHikcentralRecords(req.body));
  });

  /** Asistencia de un día (ver lib/attendance.ts). */
  app.get('/api/attendance', async (req) => {
    const ymd = dayQuery.parse(req.query).date ?? new Date().toLocaleDateString('sv');
    const day = dayAttendance(ctx, ymd);
    const lastSync = db.select({ t: devices.eventsSyncedUntil }).from(devices).all().map((d) => d.t?.getTime() ?? 0);
    return {
      ...day,
      syncedUntil: !lastSync.length || lastSync.includes(0) ? null : new Date(Math.min(...lastSync)),
    };
  });

  /**
   * Corrección a mano: una marca que el empleado se olvidó de hacer (o el equipo no registró).
   * Se guarda como marcación con origen «manual», el motivo y quién la cargó.
   */
  app.post('/api/marks', async (req, reply) => {
    const m = z
      .object({
        employeeId: z.number().int().positive(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        note: z.string().trim().min(3, 'Poné el motivo de la corrección').max(300),
      })
      .parse(req.body);
    const emp = db.select().from(employees).where(eq(employees.id, m.employeeId)).get();
    if (!emp) return reply.code(404).send({ error: 'Empleado inexistente' });
    const [y, mo, d] = m.date.split('-').map(Number);
    const [h, mi] = m.time.split(':').map(Number);
    const [row] = db
      .insert(events)
      .values({
        deviceId: null,
        source: 'manual',
        deviceEventId: `manual:${randomUUID()}`,
        time: new Date(y!, mo! - 1, d!, h!, mi!),
        kind: 'access_granted',
        verifyMode: 'unknown',
        personCode: emp.code,
        employeeId: emp.id,
        raw: { note: m.note, by: req.user?.name ?? '?', userId: req.user?.id ?? null, at: new Date().toISOString() },
      })
      .returning({ id: events.id })
      .all();
    return reply.code(201).send(row);
  });

  /** Borra una corrección a mano (las marcas de los equipos no se pueden borrar). */
  app.delete<{ Params: { id: string } }>('/api/marks/:id', async (req, reply) => {
    const res = db.delete(events).where(and(eq(events.id, Number(req.params.id)), eq(events.source, 'manual'))).run();
    return res.changes ? { ok: true } : reply.code(404).send({ error: 'Corrección inexistente' });
  });

  /** Reporte de un período: detalle día por día y resumen por empleado. */
  app.get('/api/reports', async (req) => buildReport(ctx, reportQuery.parse(req.query)));

  /** El mismo reporte en Excel (hoja «Registros» como la de HikCentral + hoja «Resumen»). */
  app.get('/api/reports.xlsx', async (req, reply) => {
    const q = reportQuery.parse(req.query);
    const file = await reportXlsx(ctx, buildReport(ctx, q));
    return reply
      .header('Content-Disposition', `attachment; filename="asistencia_${q.from}_${q.to}.xlsx"`)
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .send(file);
  });
}

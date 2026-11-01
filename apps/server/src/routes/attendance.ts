import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { devices } from '../db/schema';
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

import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { devices, employees, events } from '../db/schema';

const dayQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** Día calendario en la hora local del servidor (el contenedor corre en hora de Argentina). */
function dayRange(date?: string) {
  const [y, m, d] = (date ?? new Date().toLocaleDateString('sv')).split('-').map(Number);
  return { from: new Date(y!, m! - 1, d!), to: new Date(y!, m! - 1, d! + 1) };
}

export async function attendanceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, events: eventSync } = ctx;

  /** Trae ya las marcaciones de los equipos (y espera). */
  app.post('/api/events/sync', async () => eventSync.run());

  /**
   * Asistencia de un día: por empleado activo, entrada = primera marcación y salida = última
   * (mismo criterio que el reporte de HikCentral). Incluye a los que no marcaron.
   */
  app.get('/api/attendance', async (req) => {
    const { from, to } = dayRange(dayQuery.parse(req.query).date);
    const rows = db
      .select({ employeeId: events.employeeId, personCode: events.personCode, time: events.time, deviceId: events.deviceId })
      .from(events)
      .where(and(eq(events.kind, 'access_granted'), gte(events.time, from), lt(events.time, to)))
      .orderBy(asc(events.time))
      .all();
    const deviceNames = new Map(db.select({ id: devices.id, name: devices.name }).from(devices).all().map((d) => [d.id, d.name]));

    const people = db.select().from(employees).where(eq(employees.active, true)).orderBy(employees.lastName).all();
    const result = people.map((e) => {
      const mine = rows.filter((r) => r.employeeId === e.id);
      const first = mine[0];
      const last = mine.length > 1 ? mine[mine.length - 1] : undefined;
      return {
        employeeId: e.id,
        code: e.code,
        name: `${e.lastName}, ${e.firstName}`,
        siteId: e.siteId,
        marks: mine.length,
        in: first ? { time: first.time, device: deviceNames.get(first.deviceId) } : null,
        out: last ? { time: last.time, device: deviceNames.get(last.deviceId) } : null,
      };
    });
    // Marcaciones de legajos que no están en la app (p. ej. cargados sólo en el equipo).
    const unknown = [...new Set(rows.filter((r) => !r.employeeId && r.personCode).map((r) => r.personCode!))];
    const lastSync = db.select({ t: devices.eventsSyncedUntil }).from(devices).all().map((d) => d.t?.getTime() ?? 0);
    return {
      from,
      to,
      employees: result,
      unknownCodes: unknown,
      syncedUntil: !lastSync.length || lastSync.includes(0) ? null : new Date(Math.min(...lastSync)),
    };
  });
}

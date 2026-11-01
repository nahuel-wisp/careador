import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { AppContext } from '../app';
import { devices, employees, events } from '../db/schema';
import { absencesOn, schedulesOn } from '../routes/schedules';
import { evaluateDay, splitSingleMark } from './schedule';

/** Día calendario en la hora local del servidor (el contenedor corre en hora de Argentina). */
export function dayRange(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  return { from: new Date(y!, m! - 1, d!), to: new Date(y!, m! - 1, d! + 1) };
}

/**
 * Asistencia de un día por empleado: entrada = primera marcación y salida = última (mismo criterio que
 * HikCentral), y contra el horario y las novedades del día si llegó tarde, se fue antes, faltó o estaba
 * justificado. Incluye a los activos aunque no hayan marcado y a los dados de baja sólo si marcaron.
 */
export function dayAttendance(ctx: AppContext, ymd: string, now = new Date()) {
  const { db } = ctx;
  const { from, to } = dayRange(ymd);
  const scheduleOf = schedulesOn(ctx, ymd);
  const absencesOf = absencesOn(ctx, ymd);
  const rows = db
    .select({ employeeId: events.employeeId, personCode: events.personCode, time: events.time, deviceId: events.deviceId })
    .from(events)
    .where(and(eq(events.kind, 'access_granted'), gte(events.time, from), lt(events.time, to)))
    .orderBy(asc(events.time))
    .all();
  const deviceRows = db.select({ id: devices.id, name: devices.name, siteId: devices.siteId }).from(devices).all();
  const deviceNames = new Map<number | null, string>(deviceRows.map((d) => [d.id, d.name]));
  deviceNames.set(null, 'HikCentral (historial)');
  const deviceSite = new Map<number | null, number>(deviceRows.map((d) => [d.id, d.siteId]));

  const people = db.select().from(employees).orderBy(employees.lastName, employees.firstName).all();
  const result = people.flatMap((e) => {
    const mine = rows.filter((r) => r.employeeId === e.id);
    if (!e.active && !mine.length) return [];
    // El personal rota entre sucursales: el día se mide con el horario de donde marcó (la primera vez).
    const workedSiteId = (mine[0] && deviceSite.get(mine[0].deviceId)) ?? e.siteId;
    const schedule = scheduleOf(e.id, workedSiteId);
    const expected = schedule?.days[from.getDay()] ?? null;
    const { in: first, out: last } =
      mine.length > 1
        ? { in: mine[0]!, out: mine[mine.length - 1]! }
        : mine.length === 1
          ? splitSingleMark(mine[0]!, expected, from)
          : { in: null, out: null };
    const novedades = absencesOf(e.id);
    const evaluation = evaluateDay({
      expected,
      lateToleranceMin: schedule?.lateToleranceMin ?? 0,
      earlyToleranceMin: schedule?.earlyToleranceMin ?? 0,
      in: first?.time ?? null,
      out: last?.time ?? null,
      absences: novedades.map((a) => a.kind),
      day: from,
      now,
    });
    return [
      {
        employeeId: e.id,
        code: e.code,
        name: `${e.lastName}, ${e.firstName}`,
        firstName: e.firstName,
        lastName: e.lastName,
        siteId: e.siteId,
        workedSiteId,
        marks: mine.length,
        in: first ? { time: first.time, device: deviceNames.get(first.deviceId) } : null,
        out: last ? { time: last.time, device: deviceNames.get(last.deviceId) } : null,
        schedule: schedule ? { id: schedule.id, name: schedule.name } : null,
        expected,
        absences: novedades,
        ...evaluation,
      },
    ];
  });
  // Marcaciones de legajos que no están en la app (p. ej. cargados sólo en el equipo).
  const unknownCodes = [...new Set(rows.filter((r) => !r.employeeId && r.personCode).map((r) => r.personCode!))];
  return { from, to, employees: result, unknownCodes };
}

export type DayRow = ReturnType<typeof dayAttendance>['employees'][number];

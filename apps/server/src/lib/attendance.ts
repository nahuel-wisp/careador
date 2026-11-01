import { and, asc, eq, gte, lt } from 'drizzle-orm';
import type { AppContext } from '../app';
import { devices, employees, events } from '../db/schema';
import { absencesOn, schedulesOn } from '../routes/schedules';
import { evaluateDay, pickInOut } from './schedule';

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
    .select({
      id: events.id,
      employeeId: events.employeeId,
      personCode: events.personCode,
      time: events.time,
      deviceId: events.deviceId,
      source: events.source,
      raw: events.raw,
      voidedAt: events.voidedAt,
      voidedBy: events.voidedBy,
      voidReason: events.voidReason,
    })
    .from(events)
    .where(and(eq(events.kind, 'access_granted'), gte(events.time, from), lt(events.time, to)))
    .orderBy(asc(events.time))
    .all();
  const deviceRows = db.select({ id: devices.id, name: devices.name, siteId: devices.siteId }).from(devices).all();
  const deviceNames = new Map<number | null, string>(deviceRows.map((d) => [d.id, d.name]));
  deviceNames.set(null, 'HikCentral');
  const deviceSite = new Map<number | null, number>(deviceRows.map((d) => [d.id, d.siteId]));
  type Row = (typeof rows)[number];
  const markSource = (m: Row) => (m.source === 'manual' ? 'Carga manual' : deviceNames.get(m.deviceId));
  /** Lo que la pantalla necesita de cada marca para mostrarla y corregirla. */
  const view = (m: Row) => ({
    id: m.id,
    time: m.time,
    device: markSource(m),
    manual: m.source === 'manual',
    note: m.source === 'manual' ? ((m.raw as { note?: string; by?: string } | null)?.note ?? null) : null,
    by: m.source === 'manual' ? ((m.raw as { by?: string } | null)?.by ?? null) : null,
  });

  const people = db.select().from(employees).orderBy(employees.lastName, employees.firstName).all();
  const result = people.flatMap((e) => {
    const all = rows.filter((r) => r.employeeId === e.id);
    if (!e.active && !all.length) return [];
    // Las anuladas a mano no cuentan para nada, pero se muestran.
    const mine = all.filter((r) => !r.voidedAt);
    // El personal rota entre sucursales: el día se mide con el horario de donde marcó (la primera vez).
    const workedSiteId = (mine[0] && deviceSite.get(mine[0].deviceId)) ?? e.siteId;
    // Sin sucursal (los dueños) no se controla horario, marque donde marque; salvo que tenga uno propio.
    const schedule = scheduleOf(e.id, e.siteId === null ? null : workedSiteId);
    const novedades = absencesOf(e.id);
    // Un horario especial (cambio puntual) reemplaza al de todos los días.
    const special = novedades.find((a) => a.kind === 'horario_especial' && a.startTime && a.endTime);
    const expected = special ? { start: special.startTime!, end: special.endTime! } : (schedule?.days[from.getDay()] ?? null);
    const { in: first, out: last, others } = pickInOut(mine, expected, from);
    const evaluation = evaluateDay({
      expected,
      lateToleranceMin: schedule?.lateToleranceMin ?? (special ? 15 : 0),
      earlyToleranceMin: schedule?.earlyToleranceMin ?? (special ? 15 : 0),
      in: first?.time ?? null,
      out: last?.time ?? null,
      absences: novedades.map((a) => a.kind),
      day: from,
      now,
    });
    // Almuerzo: el propio de la persona o el del horario, si el día lo abarca. Se descuenta si el horario lo dice.
    const lunchWindow = e.lunch ?? schedule?.lunch ?? null;
    const lunch = lunchWindow && expected && expected.start < lunchWindow.start && lunchWindow.end < expected.end ? lunchWindow : null;
    const lunchMin =
      lunch && schedule?.lunchDeducted && first && last ? overlapMin(first.time, last.time, at(from, lunch.start), at(from, lunch.end)) : 0;
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
        in: first ? view(first) : null,
        out: last ? view(last) : null,
        /** Marcas que no son ni la entrada ni la salida (pasó por el lector): se muestran, no cuentan. */
        otherMarks: others.map(view),
        /** Marcas cargadas a mano ese día (vigentes). */
        manualMarks: mine.filter((m) => m.source === 'manual').map(view),
        /** Marcas anuladas a mano, con motivo y quién. */
        voidedMarks: all.filter((m) => m.voidedAt).map((m) => ({ ...view(m), voidedBy: m.voidedBy, voidReason: m.voidReason })),
        schedule: schedule ? { id: schedule.id, name: schedule.name } : null,
        expected,
        absences: novedades,
        ...evaluation,
        lunch,
        workedMin: evaluation.workedMin - lunchMin,
      },
    ];
  });
  // Marcaciones de legajos que no están en la app (p. ej. cargados sólo en el equipo).
  const unknownCodes = [...new Set(rows.filter((r) => !r.employeeId && r.personCode).map((r) => r.personCode!))];
  return { from, to, employees: result, unknownCodes };
}

/** "HH:MM" de un día como fecha. */
function at(day: Date, hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h!, m!);
}

/** Minutos en que se pisan dos intervalos. */
function overlapMin(a1: Date, a2: Date, b1: Date, b2: Date) {
  return Math.max(0, Math.round((Math.min(a2.getTime(), b2.getTime()) - Math.max(a1.getTime(), b1.getTime())) / 60_000));
}

export type DayRow = ReturnType<typeof dayAttendance>['employees'][number];

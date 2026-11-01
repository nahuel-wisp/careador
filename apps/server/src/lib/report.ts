import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { AppContext } from '../app';
import { sites, type AbsenceKind } from '../db/schema';
import { dayAttendance } from './attendance';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD');
const MAX_DAYS = 400;

export const reportQuery = z
  .object({
    from: date,
    to: date,
    siteId: z.coerce.number().int().positive().optional(),
    employeeId: z.coerce.number().int().positive().optional(),
  })
  .refine((q) => q.from <= q.to, 'La fecha hasta tiene que ser igual o posterior a la desde')
  .refine((q) => days(q.from, q.to).length <= MAX_DAYS, `Máximo ${MAX_DAYS} días por reporte`);
export type ReportQuery = z.infer<typeof reportQuery>;

const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/** Días "AAAA-MM-DD" entre dos fechas, inclusive. */
function days(from: string, to: string) {
  const out: string[] = [];
  const [y, m, d] = from.split('-').map(Number);
  for (let i = 0; out.length <= MAX_DAYS; i++) {
    const ymd = new Date(y!, m! - 1, d! + i).toLocaleDateString('sv');
    if (ymd > to) break;
    out.push(ymd);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (t: Date) => `${pad(t.getHours())}:${pad(t.getMinutes())}`;

export interface ReportRecord {
  date: string;
  weekday: string;
  employeeId: number;
  code: string;
  firstName: string;
  lastName: string;
  site: string;
  in: string | null;
  out: string | null;
  workedMin: number;
  expected: string | null;
  status: 'presente' | 'ausente' | 'novedad' | 'libre';
  lateMin: number;
  earlyMin: number;
  missingOut: boolean;
  missingIn: boolean;
  /** Una sola marca: entrada o salida es una sugerencia, queda a revisar. */
  review: boolean;
  /** Alguna marca del día se cargó a mano (motivos en `manualNotes`). */
  manualNotes: string[];
  /** Marcas del medio ("HH:MM"), que no cuentan. */
  otherMarks: string[];
  absences: AbsenceKind[];
}

export interface ReportSummary {
  employeeId: number;
  code: string;
  name: string;
  site: string;
  expectedDays: number;
  workedDays: number;
  absentDays: number;
  justifiedDays: number;
  byKind: Partial<Record<AbsenceKind, number>>;
  lateCount: number;
  lateMin: number;
  earlyCount: number;
  earlyMin: number;
  /** Días a revisar (una sola marca, sin permiso). */
  review: number;
  /** Días con alguna marca corregida a mano. */
  manualDays: number;
  workedMin: number;
}

/**
 * Reporte de un período: un registro por empleado y día (con marcas, ausencia o novedad; los días que no
 * le tocaba y no vino no aparecen) y un resumen por empleado. Se filtra por sucursal donde trabajó ese día
 * (o la suya si no vino) y/o por empleado.
 */
export function buildReport(ctx: AppContext, q: ReportQuery) {
  const siteNames = new Map(ctx.db.select({ id: sites.id, name: sites.name }).from(sites).all().map((s) => [s.id, s.name]));
  const now = new Date();
  const records: ReportRecord[] = [];
  const summary = new Map<number, ReportSummary>();

  for (const ymd of days(q.from, q.to)) {
    const day = dayAttendance(ctx, ymd, now);
    for (const e of day.employees) {
      if (q.employeeId && e.employeeId !== q.employeeId) continue;
      if (q.siteId && e.workedSiteId !== q.siteId) continue;
      if (e.status === 'pendiente' || (e.status === 'libre' && !e.marks)) continue;
      const status = e.status;
      records.push({
        date: ymd,
        weekday: WEEKDAYS[day.from.getDay()]!,
        employeeId: e.employeeId,
        code: e.code,
        firstName: e.firstName,
        lastName: e.lastName,
        site: (e.workedSiteId && siteNames.get(e.workedSiteId)) || '',
        in: e.in ? hhmm(e.in.time) : null,
        out: e.out ? hhmm(e.out.time) : null,
        workedMin: e.workedMin,
        expected: e.expected ? `${e.expected.start}–${e.expected.end}` : null,
        status,
        lateMin: e.lateMin,
        earlyMin: e.earlyMin,
        missingOut: e.missingOut,
        missingIn: e.missingIn,
        review: e.review,
        manualNotes: e.manualMarks.map((m) => `${hhmm(m.time)} ${m.note} (${m.by})`),
        otherMarks: e.otherMarks.map((m) => hhmm(m.time)),
        absences: e.absences.map((a) => a.kind),
      });

      const s =
        summary.get(e.employeeId) ??
        summary
          .set(e.employeeId, {
            employeeId: e.employeeId,
            code: e.code,
            name: e.name,
            site: (e.siteId && siteNames.get(e.siteId)) || '',
            expectedDays: 0,
            workedDays: 0,
            absentDays: 0,
            justifiedDays: 0,
            byKind: {},
            lateCount: 0,
            lateMin: 0,
            earlyCount: 0,
            earlyMin: 0,
            review: 0,
            manualDays: 0,
            workedMin: 0,
          })
          .get(e.employeeId)!;
      if (e.expected) s.expectedDays++;
      if (e.in || e.out) s.workedDays++;
      if (status === 'ausente') s.absentDays++;
      if (status === 'novedad') s.justifiedDays++;
      for (const a of e.absences) s.byKind[a.kind] = (s.byKind[a.kind] ?? 0) + 1;
      if (e.lateMin) (s.lateCount++, (s.lateMin += e.lateMin));
      if (e.earlyMin) (s.earlyCount++, (s.earlyMin += e.earlyMin));
      if (e.review) s.review++;
      if (e.manualMarks.length) s.manualDays++;
      s.workedMin += e.workedMin;
    }
  }
  return {
    from: q.from,
    to: q.to,
    site: q.siteId ? siteNames.get(q.siteId) ?? null : null,
    records,
    summary: [...summary.values()].sort((a, b) => a.name.localeCompare(b.name, 'es')),
  };
}

export type Report = ReturnType<typeof buildReport>;

const dur = (min: number) => `${pad(Math.floor(min / 60))} : ${pad(min % 60)}`; // como HikCentral: "10 : 18"
const KIND: Record<AbsenceKind, string> = {
  vacaciones: 'Vacaciones',
  franco: 'Franco',
  licencia: 'Licencia',
  enfermedad: 'Enfermedad',
  feriado: 'Feriado',
  permiso_tarde: 'Permiso llegada',
  permiso_salida: 'Permiso salida',
  horario_especial: 'Horario especial',
  otro: 'Otro',
};

/** Texto de observaciones de un registro: "Tarde 12 min · Sin salida · Vacaciones". */
export function remarks(r: ReportRecord) {
  return [
    r.status === 'ausente' ? 'Ausente' : null,
    r.lateMin ? `Tarde ${r.lateMin} min` : null,
    r.earlyMin ? `Salió ${r.earlyMin} min antes` : null,
    r.review ? `A revisar: ${r.in ? 'sin salida' : 'sin entrada'}` : r.missingOut ? 'Sin salida' : r.missingIn ? 'Sin entrada' : null,
    r.manualNotes.length ? `Corregido a mano: ${r.manualNotes.join('; ')}` : null,
    ...r.absences.map((k) => KIND[k]),
    r.otherMarks.length ? `Otras marcas: ${r.otherMarks.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Excel: hoja «Registros» con las columnas de HikCentral (+ observaciones) y hoja «Resumen». */
export async function reportXlsx(ctx: AppContext, report: Report) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Control Horario';
  const empresa = ctx.config.CAREADOR_EMPRESA;
  const title = (ws: ExcelJS.Worksheet, name: string, cols: number) => {
    ws.addRow([`${name}${empresa ? ` — ${empresa}` : ''}`]).font = { bold: true, size: 14 };
    ws.addRow([`Período: ${report.from} - ${report.to}${report.site ? ` · Sucursal: ${report.site}` : ''}`]);
    ws.addRow([`Exportado: ${new Date().toLocaleString('es-AR', { hour12: false })}`]);
    ws.addRow([]);
    ws.mergeCells(1, 1, 1, cols);
  };

  const reg = wb.addWorksheet('Registros');
  const regHead = ['Nombre', 'Apellido', 'Departamento', 'Fecha', 'Semana', 'Hora de registro de entrada', 'Salida a', 'Duración', 'Horario', 'Observaciones'];
  title(reg, 'Registros de entradas y salidas', regHead.length);
  reg.addRow(regHead).font = { bold: true };
  // Como HikCentral: por empleado y fecha descendente.
  const sorted = [...report.records].sort((a, b) => a.lastName.localeCompare(b.lastName, 'es') || a.firstName.localeCompare(b.firstName, 'es') || b.date.localeCompare(a.date));
  for (const r of sorted) {
    const row = reg.addRow([r.firstName, r.lastName, r.site, r.date, r.weekday, r.in ?? '-', r.out ?? '-', dur(r.workedMin), r.expected ?? '', remarks(r)]);
    // Rojo: ausencia, tardanza o salida antes. Ámbar: a revisar o corregido a mano.
    if (r.status === 'ausente' || r.lateMin || r.earlyMin) row.getCell(10).font = { color: { argb: 'FFDC2626' } };
    else if (r.review || r.manualNotes.length) row.getCell(10).font = { color: { argb: 'FFB45309' } };
  }
  reg.columns.forEach((c, i) => (c.width = [14, 16, 14, 12, 11, 12, 10, 10, 13, 34][i]));

  const res = wb.addWorksheet('Resumen');
  const resHead = ['Legajo', 'Empleado', 'Sucursal', 'Días esperados', 'Días trabajados', 'Horas trabajadas', 'Ausencias', 'Justificadas', 'Llegadas tarde', 'Min. tarde', 'Salidas antes', 'Min. antes', 'A revisar', 'Corregidos a mano', 'Novedades'];
  title(res, 'Resumen de asistencia', resHead.length);
  res.addRow(resHead).font = { bold: true };
  for (const s of report.summary) {
    res.addRow([
      s.code,
      s.name,
      s.site,
      s.expectedDays,
      s.workedDays,
      dur(s.workedMin),
      s.absentDays,
      s.justifiedDays,
      s.lateCount,
      s.lateMin,
      s.earlyCount,
      s.earlyMin,
      s.review,
      s.manualDays,
      Object.entries(s.byKind)
        .map(([k, n]) => `${KIND[k as AbsenceKind]} ${n}`)
        .join(' · '),
    ]);
  }
  res.columns.forEach((c, i) => (c.width = [12, 26, 12, 9, 9, 10, 9, 9, 9, 9, 9, 9, 9, 10, 28][i]));

  return Buffer.from(await wb.xlsx.writeBuffer());
}

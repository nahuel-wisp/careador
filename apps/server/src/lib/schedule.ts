import type { AbsenceKind, DaySchedule } from '../db/schema';

/** Novedades que cubren el día entero (si no marcó, no es ausencia). Los permisos sólo perdonan tarde/salida. */
const FULL_DAY: readonly AbsenceKind[] = ['vacaciones', 'franco', 'licencia', 'enfermedad', 'feriado', 'otro'];

export type DayStatus =
  | 'libre' // no le toca trabajar
  | 'novedad' // no vino, justificado (vacaciones, licencia, feriado…)
  | 'ausente'
  | 'pendiente' // hoy, todavía dentro de la tolerancia de entrada
  | 'presente';

export interface DayInput {
  /** Horario de ese día (null = no trabaja). */
  expected: DaySchedule | null;
  lateToleranceMin: number;
  earlyToleranceMin: number;
  /** Primera y última marca del día (out = null si marcó una sola vez). */
  in: Date | null;
  out: Date | null;
  absences: AbsenceKind[];
  /** Inicio del día evaluado (00:00 local) y ahora, para no juzgar lo que todavía no pasó. */
  day: Date;
  now: Date;
}

export interface DayResult {
  status: DayStatus;
  /** Minutos tarde (0 si dentro de la tolerancia o con permiso). */
  lateMin: number;
  /** Minutos que se fue antes (0 si dentro de la tolerancia o con permiso). */
  earlyMin: number;
  /** Marcó entrada pero no salida, y el horario ya terminó. */
  missingOut: boolean;
  /** Minutos entre primera y última marca. */
  workedMin: number;
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h! * 60 + m!;
};
const at = (day: Date, min: number) => new Date(day.getTime() + min * 60_000);

export function evaluateDay(d: DayInput): DayResult {
  const workedMin = d.in && d.out ? Math.round((d.out.getTime() - d.in.getTime()) / 60_000) : 0;
  const base = { lateMin: 0, earlyMin: 0, missingOut: false, workedMin };
  const justified = d.absences.some((k) => FULL_DAY.includes(k));

  if (!d.in) {
    if (justified) return { ...base, status: 'novedad' };
    if (!d.expected) return { ...base, status: 'libre' };
    const deadline = at(d.day, toMin(d.expected.start) + d.lateToleranceMin);
    return { ...base, status: d.now < deadline ? 'pendiente' : 'ausente' };
  }
  if (!d.expected || justified) return { ...base, status: 'presente' };

  // Se compara en minutos desde las 00:00 del día (hora local del servidor, como el resto de Asistencia).
  const start = at(d.day, toMin(d.expected.start));
  const end = at(d.day, toMin(d.expected.end));
  const late = Math.floor((d.in.getTime() - start.getTime()) / 60_000);
  const lateMin = late > d.lateToleranceMin && !d.absences.includes('permiso_tarde') ? late : 0;

  const ended = d.now >= end;
  const early = d.out ? Math.ceil((end.getTime() - d.out.getTime()) / 60_000) : 0;
  const earlyMin = ended && early > d.earlyToleranceMin && !d.absences.includes('permiso_salida') ? early : 0;

  return { status: 'presente', lateMin, earlyMin, missingOut: ended && !d.out, workedMin };
}

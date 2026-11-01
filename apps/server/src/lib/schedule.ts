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
  /** Primera y última marca del día (con una sola marca, va en `in` o en `out` según la hora: ver splitSingleMark). */
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
  /** Marcó sólo la salida. */
  missingIn: boolean;
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
  const base = { lateMin: 0, earlyMin: 0, missingOut: false, missingIn: false, workedMin };
  const justified = d.absences.some((k) => FULL_DAY.includes(k));

  if (!d.in && !d.out) {
    if (justified) return { ...base, status: 'novedad' };
    if (!d.expected) return { ...base, status: 'libre' };
    const deadline = at(d.day, toMin(d.expected.start) + d.lateToleranceMin);
    return { ...base, status: d.now < deadline ? 'pendiente' : 'ausente' };
  }
  if (!d.expected || justified) return { ...base, missingIn: !d.in, status: 'presente' };

  // Se compara en minutos desde las 00:00 del día (hora local del servidor, como el resto de Asistencia).
  const start = at(d.day, toMin(d.expected.start));
  const end = at(d.day, toMin(d.expected.end));
  const late = d.in ? Math.floor((d.in.getTime() - start.getTime()) / 60_000) : 0;
  const lateMin = late > d.lateToleranceMin && !d.absences.includes('permiso_tarde') ? late : 0;

  const ended = d.now >= end;
  const early = d.out ? Math.ceil((end.getTime() - d.out.getTime()) / 60_000) : 0;
  const earlyMin = ended && early > d.earlyToleranceMin && !d.absences.includes('permiso_salida') ? early : 0;

  return { status: 'presente', lateMin, earlyMin, missingOut: ended && !d.out, missingIn: !d.in, workedMin };
}

/**
 * Con una sola marca en el día no se sabe si fue entrada o salida: si está más cerca de la hora de salida
 * del horario que de la de entrada, se toma como salida (como hace HikCentral con sus ventanas de registro).
 */
export function splitSingleMark<T extends { time: Date }>(mark: T, expected: DaySchedule | null, day: Date) {
  if (!expected) return { in: mark, out: null };
  const min = (mark.time.getTime() - day.getTime()) / 60_000;
  const isOut = min > (toMin(expected.start) + toMin(expected.end)) / 2;
  return isOut ? { in: null, out: mark } : { in: mark, out: null };
}

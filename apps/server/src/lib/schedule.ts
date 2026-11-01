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
  /** Primera y última marca del día (ver pickInOut). */
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
  /**
   * Falta la entrada o la salida (y el horario ya terminó): no se puede saber si llegó tarde o se fue antes,
   * así que no se calcula y queda para revisar, salvo que haya permiso de llegada/salida.
   */
  review: boolean;
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
  const base = { lateMin: 0, earlyMin: 0, missingOut: false, missingIn: false, review: false, workedMin };
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

  const missingOut = ended && !d.out;
  const missingIn = !d.in;
  const permiso = d.absences.includes('permiso_tarde') || d.absences.includes('permiso_salida');
  const review = (missingIn || missingOut) && !permiso;
  return review
    ? { status: 'presente', lateMin: 0, earlyMin: 0, missingOut, missingIn, review, workedMin }
    : { status: 'presente', lateMin, earlyMin, missingOut, missingIn, review, workedMin };
}

/**
 * Entrada y salida del día entre todas sus marcas. Con horario: la entrada es la primera marca hasta la mitad
 * del horario y la salida la última después de la mitad; lo del medio (pasar por el lector sin querer, ir a
 * almorzar) queda como «otras marcas» y no cambia nada. Así una sola marca a la tarde se sugiere como salida,
 * y una pasada a media mañana no se toma como salida de alguien que se olvidó de marcar.
 * Sin horario (día libre): primera y última, como HikCentral.
 */
export function pickInOut<T extends { time: Date }>(marks: T[], expected: DaySchedule | null, day: Date) {
  if (!marks.length) return { in: null, out: null, others: [] as T[] };
  if (!expected) {
    const last = marks.length > 1 ? marks[marks.length - 1]! : null;
    return { in: marks[0]!, out: last, others: marks.slice(1, last ? -1 : undefined) };
  }
  const mid = (toMin(expected.start) + toMin(expected.end)) / 2;
  const isOut = (m: T) => (m.time.getTime() - day.getTime()) / 60_000 > mid;
  const first = marks.find((m) => !isOut(m)) ?? null;
  const last = [...marks].reverse().find(isOut) ?? null;
  return { in: first, out: last, others: marks.filter((m) => m !== first && m !== last) };
}

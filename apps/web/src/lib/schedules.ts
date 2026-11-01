export interface DaySchedule {
  start: string;
  end: string;
}

export interface Schedule {
  id: number;
  name: string;
  /** 0 = domingo. */
  days: (DaySchedule | null)[];
  lateToleranceMin: number;
  earlyToleranceMin: number;
}

export interface Assignment {
  id: number;
  employeeId: number;
  scheduleId: number;
  validFrom: string;
  validTo: string | null;
}

export type AbsenceKind =
  | 'vacaciones'
  | 'franco'
  | 'licencia'
  | 'enfermedad'
  | 'feriado'
  | 'permiso_tarde'
  | 'permiso_salida'
  | 'horario_especial'
  | 'otro';

export const KIND_LABEL: Record<AbsenceKind, string> = {
  vacaciones: 'Vacaciones',
  franco: 'Franco / día libre',
  licencia: 'Licencia',
  enfermedad: 'Enfermedad / certificado médico',
  feriado: 'Feriado (para todos)',
  permiso_tarde: 'Permiso para llegar tarde',
  permiso_salida: 'Permiso para salir antes',
  horario_especial: 'Horario especial (otro horario esos días)',
  otro: 'Otro motivo',
};

/** Etiqueta corta para listas. */
export const KIND_SHORT: Record<AbsenceKind, string> = {
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

/** Lunes primero, como se piensa la semana. */
export const WEEK = [
  { i: 1, name: 'Lunes', short: 'Lun' },
  { i: 2, name: 'Martes', short: 'Mar' },
  { i: 3, name: 'Miércoles', short: 'Mié' },
  { i: 4, name: 'Jueves', short: 'Jue' },
  { i: 5, name: 'Viernes', short: 'Vie' },
  { i: 6, name: 'Sábado', short: 'Sáb' },
  { i: 0, name: 'Domingo', short: 'Dom' },
];

/** "Lun–Vie 09:00–18:00 · Sáb 09:00–13:00": agrupa días seguidos con el mismo horario. */
export function summarize(days: (DaySchedule | null)[]): string {
  const parts: string[] = [];
  let run: { from: string; to: string; key: string } | null = null;
  const flush = () => run && parts.push(`${run.from === run.to ? run.from : `${run.from}–${run.to}`} ${run.key}`);
  for (const d of WEEK) {
    const day = days[d.i];
    const key = day ? `${day.start}–${day.end}` : '';
    if (run && key && run.key === key) run.to = d.short;
    else {
      flush();
      run = key ? { from: d.short, to: d.short, key } : null;
    }
  }
  flush();
  return parts.join(' · ') || 'Sin días de trabajo';
}

export const today = () => new Date().toLocaleDateString('sv');

/** "15/10" o "15/10/2025" si no es de este año. */
export function shortDate(ymd: string) {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}${y === String(new Date().getFullYear()) ? '' : `/${y}`}`;
}

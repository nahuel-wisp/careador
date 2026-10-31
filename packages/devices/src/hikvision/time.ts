/** Utilidades de fecha para ISAPI, que trabaja en hora local del equipo. */

/** Convierte "-03:00" a minutos (-180). */
export function offsetToMinutes(offset: string): number {
  const m = /^([+-])(\d{2}):?(\d{2})$/.exec(offset.trim());
  if (!m) throw new Error(`Offset horario inválido: ${offset}`);
  const mins = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === '-' ? -mins : mins;
}

/** Formatea una fecha como hora local del equipo: "2025-03-01T08:00:00". */
export function toDeviceLocal(date: Date, offset: string): string {
  const shifted = new Date(date.getTime() + offsetToMinutes(offset) * 60_000);
  return shifted.toISOString().slice(0, 19);
}

/** Igual que toDeviceLocal pero con el offset: "2025-03-01T08:00:00-03:00". */
export function toDeviceLocalWithOffset(date: Date, offset: string): string {
  return toDeviceLocal(date, offset) + offset;
}

/**
 * Interpreta una fecha devuelta por el equipo. Si trae offset lo respeta;
 * si no, asume el offset configurado para el equipo.
 */
export function fromDevice(value: string, offset: string): Date {
  const hasZone = /([+-]\d{2}:?\d{2}|Z)$/.test(value);
  return new Date(hasZone ? value : value + offset);
}

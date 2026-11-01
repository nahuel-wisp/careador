import ExcelJS from 'exceljs';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { AppContext } from '../app';
import { employees, events } from '../db/schema';

/**
 * Importa el historial del Excel «Registros de entradas y salidas» de HikCentral Access Control:
 * una fila por empleado y día con primera entrada y última salida. No trae legajo, así que se vincula
 * por nombre; lo que no coincide queda guardado con el nombre y se vincula cuando el empleado exista.
 */

export interface RecordRow {
  name: string;
  firstName: string;
  lastName: string;
  department: string;
  date: string; // AAAA-MM-DD
  in: string | null; // HH:MM
  out: string | null;
}

/** Clave de nombre que no depende de acentos, mayúsculas ni del orden (HikCentral y los equipos lo ordenan distinto). */
export const nameKey = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

const pad = (n: number) => String(n).padStart(2, '0');

function text(v: ExcelJS.CellValue): string {
  if (v instanceof Date) return v.toISOString();
  if (v && typeof v === 'object' && 'richText' in v) return v.richText.map((t) => t.text).join('');
  return v == null ? '' : String(v).trim();
}

/** Las celdas pueden venir como texto ("2026-09-30", "07:42", "-") o como fecha de Excel (UTC). */
function dateOf(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text(v));
  return m ? `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}` : null;
}

function timeOf(v: ExcelJS.CellValue): string | null {
  if (v instanceof Date) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
  const m = /^(\d{1,2}):(\d{2})/.exec(text(v));
  return m ? `${pad(Number(m[1]))}:${m[2]}` : null;
}

export async function parseHikcentralRecords(file: Buffer): Promise<RecordRow[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw Object.assign(new Error('No se pudo leer el archivo: tiene que ser un Excel (.xlsx)'), { statusCode: 400 });
  }
  const rows: RecordRow[] = [];
  for (const ws of wb.worksheets) {
    let col: Record<'nombre' | 'apellido' | 'depto' | 'fecha' | 'entrada' | 'salida', number> | null = null;
    ws.eachRow((row) => {
      const cells = Array.from(row.values as ExcelJS.CellValue[], text); // row.values viene con huecos
      if (!col) {
        const find = (f: (h: string) => boolean) => cells.findIndex((h) => f(h.toLowerCase()));
        const c = {
          nombre: find((h) => h === 'nombre'),
          apellido: find((h) => h === 'apellido'),
          depto: find((h) => h.startsWith('departamento')),
          fecha: find((h) => h === 'fecha'),
          entrada: find((h) => h.includes('entrada')),
          salida: find((h) => h.startsWith('salida')),
        };
        if (Object.values(c).every((i) => i > 0)) col = c;
        return;
      }
      const v = row.values as ExcelJS.CellValue[];
      const date = dateOf(v[col.fecha]);
      const firstName = text(v[col.nombre]);
      const lastName = text(v[col.apellido]);
      const name = `${firstName} ${lastName}`.trim();
      if (!date || !name) return;
      rows.push({ name, firstName, lastName, department: text(v[col.depto]), date, in: timeOf(v[col.entrada]), out: timeOf(v[col.salida]) });
    });
  }
  if (!rows.length) {
    throw Object.assign(new Error('No parece el Excel «Registros de entradas y salidas» de HikCentral (no encontré las columnas Nombre, Apellido, Fecha, Entrada y Salida)'), {
      statusCode: 400,
    });
  }
  return rows;
}

/** Empleados por clave de nombre (los nombres repetidos no se vinculan solos: serían ambiguos). */
function employeesByName(ctx: AppContext) {
  const map = new Map<string, number | null>();
  for (const e of ctx.db.select({ id: employees.id, f: employees.firstName, l: employees.lastName }).from(employees).all()) {
    const k = nameKey(`${e.f} ${e.l}`);
    map.set(k, map.has(k) ? null : e.id);
  }
  return map;
}

export function importRecords(ctx: AppContext, rows: RecordRow[]) {
  const byName = employeesByName(ctx);
  let inserted = 0;
  const unmatched = new Map<string, number>();
  ctx.db.transaction((tx) => {
    for (const r of rows) {
      const key = nameKey(r.name);
      const employeeId = byName.get(key) ?? null;
      if (!employeeId) unmatched.set(r.name, (unmatched.get(r.name) ?? 0) + 1);
      const [y, m, d] = r.date.split('-').map(Number);
      // Si entrada y salida son la misma marca, va una sola.
      const marks = [...new Set([r.in, r.out].filter((t): t is string => !!t))];
      for (const [i, hm] of marks.entries()) {
        const [h, min] = hm.split(':').map(Number);
        const res = tx
          .insert(events)
          .values({
            deviceId: null,
            source: 'import',
            deviceEventId: `hikcentral:${key}:${r.date}:${i === 0 && r.in ? 'in' : 'out'}`,
            time: new Date(y!, m! - 1, d!, h!, min!), // hora local del servidor (Argentina), como el resto
            kind: 'access_granted',
            verifyMode: 'unknown',
            personName: r.name,
            employeeId,
            raw: r,
          })
          .onConflictDoNothing()
          .run();
        inserted += res.changes;
      }
    }
  });
  const dates = rows.map((r) => r.date).sort();
  return {
    days: rows.length,
    inserted,
    from: dates[0],
    to: dates[dates.length - 1],
    unmatched: [...unmatched].map(([name, days]) => ({ name, days })),
  };
}

/** Vincula las marcaciones importadas que quedaron sin empleado con los que ya existen. Devuelve cuántas. */
export function linkImported(ctx: AppContext) {
  const pending = ctx.db
    .select({ id: events.id, personName: events.personName })
    .from(events)
    .where(and(eq(events.source, 'import'), isNull(events.employeeId), isNotNull(events.personName)))
    .all();
  if (!pending.length) return 0;
  const byName = employeesByName(ctx);
  let linked = 0;
  for (const p of pending) {
    const employeeId = byName.get(nameKey(p.personName!));
    if (employeeId) linked += ctx.db.update(events).set({ employeeId }).where(eq(events.id, p.id)).run().changes;
  }
  return linked;
}

/**
 * Nombre y apellido tal como estaban separados en HikCentral, para una persona del historial importado.
 * Los equipos guardan el nombre en un solo campo y no hay forma segura de partirlo ("Juan Di Fonzo").
 */
export function historyNames(ctx: AppContext) {
  const map = new Map<string, { firstName: string; lastName: string }>();
  for (const r of ctx.db.select({ raw: events.raw }).from(events).where(eq(events.source, 'import')).all()) {
    const row = r.raw as Partial<RecordRow> | null;
    if (row?.name && row.firstName && row.lastName) map.set(nameKey(row.name), { firstName: row.firstName, lastName: row.lastName });
  }
  return map;
}

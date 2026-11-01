import { DeviceError } from '@careador/devices';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../app';
import { devices, employeeFaces, employees, enrollments, sites } from '../db/schema';
import { driverFor } from './devices';
import { historyNames, linkImported, nameKey } from './history';

/**
 * Cada cuánto se leen marcaciones nuevas y se reintenta lo que quedó pendiente (equipo apagado, sin red...).
 * Una vez por hora alcanza: la app se consulta pocas veces y «Actualizar» trae lo último cuando hace falta.
 */
export const RETRY_MS = 60 * 60 * 1000;

export interface SyncSummary {
  synced: number;
  deleted: number;
  errors: number;
}

/** Nombre que se carga en el equipo, como lo hace HikCentral: "Nombre Apellido" (Hikvision admite hasta 32). */
export function deviceName(e: { firstName: string; lastName: string }) {
  return `${e.firstName} ${e.lastName}`.trim().slice(0, 32);
}

/**
 * Lleva el personal a los equipos. Cada empleado activo va a todos los equipos habilitados
 * (pueden marcar en cualquier sucursal); el estado de cada par queda en `enrollments`.
 * Corre de a una vez: si se pide mientras corre, vuelve a correr al terminar.
 */
export class EnrollmentSync {
  private running: Promise<SyncSummary> | null = null;
  private again = false;

  constructor(private readonly ctx: AppContext) {}

  /** Dispara una sincronización en segundo plano (no espera). */
  kick() {
    this.run().catch((err) => console.error('Sincronización de personal:', err));
  }

  /** Sincroniza y espera el resultado. */
  run(): Promise<SyncSummary> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => (this.running = null));
    return this.running;
  }

  /** Espera a que termine la sincronización en curso (al cerrar la app). */
  async idle() {
    await this.running?.catch(() => {});
  }

  private async loop(): Promise<SyncSummary> {
    const total: SyncSummary = { synced: 0, deleted: 0, errors: 0 };
    do {
      this.again = false;
      const s = await this.once();
      total.synced += s.synced;
      total.deleted += s.deleted;
      total.errors = s.errors; // errores: los de la última pasada
    } while (this.again);
    return total;
  }

  private async once(): Promise<SyncSummary> {
    const { db } = this.ctx;
    const summary: SyncSummary = { synced: 0, deleted: 0, errors: 0 };

    // Todo empleado activo × equipo habilitado tiene su fila (cubre altas y equipos nuevos).
    db.run(sql`
      INSERT OR IGNORE INTO enrollments (device_id, employee_id, status)
      SELECT d.id, e.id, 'pending' FROM devices d, employees e WHERE d.enabled = 1 AND e.active = 1`);

    const work = db
      .select({ enrollment: enrollments, employee: employees })
      .from(enrollments)
      .innerJoin(employees, eq(employees.id, enrollments.employeeId))
      .where(inArray(enrollments.status, ['pending', 'error', 'pending_delete']))
      .all();

    for (const deviceId of new Set(work.map((w) => w.enrollment.deviceId))) {
      const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
      if (!device?.enabled) continue;
      const driver = driverFor(this.ctx, device);

      for (const { enrollment, employee } of work.filter((w) => w.enrollment.deviceId === deviceId)) {
        const key = and(eq(enrollments.deviceId, deviceId), eq(enrollments.employeeId, employee.id));
        try {
          if (enrollment.status === 'pending_delete') {
            await driver.deletePerson(employee.code).catch((err) => {
              if (!(err instanceof DeviceError && err.code === 'not_found')) throw err;
            });
            db.delete(enrollments).where(key).run();
            summary.deleted++;
            continue;
          }
          await driver.upsertPerson({ id: employee.code, name: deviceName(employee), enabled: true });
          const face = db.select().from(employeeFaces).where(eq(employeeFaces.employeeId, employee.id)).get();
          let faceSynced = enrollment.faceSynced;
          if (face && !faceSynced && driver.setFace) {
            await driver.setFace(employee.code, face.jpeg);
            faceSynced = true;
          }
          db.update(enrollments)
            .set({ status: 'synced', faceSynced, lastError: null, syncedAt: new Date() })
            .where(key)
            .run();
          summary.synced++;
        } catch (err) {
          db.update(enrollments)
            .set({ status: 'error', lastError: err instanceof Error ? err.message : String(err) })
            .where(key)
            .run();
          summary.errors++;
          // Sin conexión (o en sólo lectura) no tiene sentido seguir probando con el resto en este equipo.
          if (err instanceof DeviceError && ['unreachable', 'unauthorized', 'read_only'].includes(err.code)) break;
        }
      }
    }
    return summary;
  }
}

/** Marca para reenviar los datos (y opcionalmente la foto) de un empleado a todos los equipos. */
export function markPending(ctx: AppContext, employeeId: number, opts: { face?: boolean } = {}) {
  ctx.db
    .update(enrollments)
    .set({ status: 'pending', ...(opts.face ? { faceSynced: false } : {}) })
    .where(and(eq(enrollments.employeeId, employeeId), inArray(enrollments.status, ['synced', 'error', 'pending'])))
    .run();
}

/** Los equipos aceptan JPEG chico; la web ya lo manda en 480×640 y < 200 KB. */
export const MAX_FACE_BYTES = 1024 * 1024;

/**
 * Trae las personas que ya están cargadas en un equipo (p. ej. las que cargó HikCentral) como empleados,
 * con su mismo legajo y la foto que ya reconoce el equipo (para los que no tienen foto en la app).
 * Sólo lee del equipo: funciona igual en sólo lectura.
 */
export async function importPersons(ctx: AppContext, deviceId: number, warn: (msg: string) => void = () => {}) {
  const { db } = ctx;
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) throw Object.assign(new Error('Equipo inexistente'), { statusCode: 404 });

  const driver = driverFor(ctx, device);
  const fromHistory = historyNames(ctx);
  const siteByName = new Map(db.select().from(sites).all().map((s) => [s.name.toLowerCase(), s.id]));
  let created = 0;
  let existing = 0;
  let faces = 0;
  let facesFailed = 0;
  for await (const p of driver.listPersons()) {
    let emp = db.select().from(employees).where(eq(employees.code, p.id)).get();
    if (emp) {
      existing++;
    } else {
      // HikCentral carga "Nombre Apellido". Si la persona está en su historial, se usa cómo separaba nombre y
      // apellido y su departamento como sucursal; si no, primera palabra = nombre (se corrige en Personal).
      const hist = fromHistory.get(nameKey(p.name));
      const [first, ...last] = p.name.trim().split(/\s+/);
      [emp] = db
        .insert(employees)
        .values({
          code: p.id,
          firstName: hist?.firstName ?? first ?? p.id,
          lastName: hist?.lastName ?? (last.join(' ') || '-'),
          siteId: (hist && siteByName.get(hist.department.toLowerCase())) ?? device.siteId,
        })
        .returning()
        .all();
      created++;
    }
    // Ya está en este equipo: no hace falta mandarlo de nuevo.
    db.insert(enrollments)
      .values({ deviceId, employeeId: emp!.id, status: 'synced', faceSynced: (p.faceCount ?? 0) > 0, syncedAt: new Date() })
      .onConflictDoNothing()
      .run();

    // La foto que ya reconoce el equipo, si la app todavía no tiene una.
    const hasFace = db.select({ id: employeeFaces.employeeId }).from(employeeFaces).where(eq(employeeFaces.employeeId, emp!.id)).get();
    if (!hasFace && (p.faceCount ?? 1) > 0 && driver.getFace) {
      try {
        const jpeg = await driver.getFace(p.id);
        if (!jpeg) continue;
        const buf = Buffer.from(jpeg);
        if (buf[0] !== 0xff || buf[1] !== 0xd8 || buf.length > MAX_FACE_BYTES) throw new Error('no es un JPEG válido');
        db.insert(employeeFaces).values({ employeeId: emp!.id, jpeg: buf }).run();
        // A los demás equipos hay que mandársela; a éste no.
        markPending(ctx, emp!.id, { face: true });
        db.update(enrollments)
          .set({ status: 'synced', faceSynced: true, syncedAt: new Date(), lastError: null })
          .where(and(eq(enrollments.deviceId, deviceId), eq(enrollments.employeeId, emp!.id)))
          .run();
        faces++;
      } catch (err) {
        facesFailed++;
        warn(`No se pudo traer la foto de ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  linkImported(ctx); // historial de HikCentral que esperaba a estos empleados
  return { created, existing, faces, facesFailed };
}

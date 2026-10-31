import { DeviceError } from '@careador/devices';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../app';
import { devices, employeeFaces, employees, enrollments } from '../db/schema';
import { driverFor } from './devices';

/** Cada cuánto se reintenta lo que quedó pendiente o con error (equipo apagado, sin red...). */
export const RETRY_MS = 5 * 60 * 1000;

export interface SyncSummary {
  synced: number;
  deleted: number;
  errors: number;
}

/** Nombre que se carga en el equipo (Hikvision admite hasta 32 caracteres). */
export function deviceName(e: { firstName: string; lastName: string }) {
  return `${e.lastName} ${e.firstName}`.trim().slice(0, 32);
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

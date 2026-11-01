import { eq, sql } from 'drizzle-orm';
import type { AppContext } from '../app';
import { devices, employees, events } from '../db/schema';
import { driverFor } from './devices';
import { linkImported } from './history';

/** La primera vez se traen los últimos 35 días (lo que suele guardar el equipo y cubre el mes anterior). */
const FIRST_SYNC_DAYS = 35;

export interface EventSyncSummary {
  devices: number;
  inserted: number;
  errors: number;
}

/**
 * Trae las marcaciones válidas de cada equipo habilitado a la tabla `events`.
 * Sólo lee: funciona igual con equipos en sólo lectura. Una a la vez, como EnrollmentSync.
 */
export class EventSync {
  private running: Promise<EventSyncSummary> | null = null;

  constructor(private readonly ctx: AppContext) {}

  kick() {
    this.run().catch((err) => console.error('Lectura de marcaciones:', err));
  }

  run(): Promise<EventSyncSummary> {
    this.running ??= this.once().finally(() => (this.running = null));
    return this.running;
  }

  async idle() {
    await this.running?.catch(() => {});
  }

  private async once(): Promise<EventSyncSummary> {
    const { db } = this.ctx;
    const summary: EventSyncSummary = { devices: 0, inserted: 0, errors: 0 };
    const byCode = new Map(db.select({ id: employees.id, code: employees.code }).from(employees).all().map((e) => [e.code, e.id]));

    for (const device of db.select().from(devices).where(eq(devices.enabled, true)).all()) {
      summary.devices++;
      const to = new Date();
      // Sólo lo nuevo: desde donde quedó la última lectura buena (si falla, no avanza y se pide de nuevo).
      const from = device.eventsSyncedUntil ?? new Date(to.getTime() - FIRST_SYNC_DAYS * 86_400_000);
      try {
        for await (const ev of driverFor(this.ctx, device).getEvents({ from, to })) {
          const res = db
            .insert(events)
            .values({
              deviceId: device.id,
              deviceEventId: ev.deviceEventId,
              time: ev.time,
              kind: ev.kind,
              verifyMode: ev.verifyMode,
              personCode: ev.personId ?? null,
              employeeId: (ev.personId && byCode.get(ev.personId)) || null,
              doorNo: ev.doorNo ?? null,
              raw: ev.raw,
            })
            .onConflictDoNothing()
            .run();
          summary.inserted += res.changes;
        }
        db.update(devices)
          .set({ eventsSyncedUntil: to, lastSeenAt: new Date(), lastError: null })
          .where(eq(devices.id, device.id))
          .run();
      } catch (err) {
        summary.errors++;
        db.update(devices)
          .set({ lastError: `Marcaciones: ${err instanceof Error ? err.message : String(err)}` })
          .where(eq(devices.id, device.id))
          .run();
      }
    }
    // Marcaciones de personas que se dieron de alta (o importaron) después: se les asigna el empleado.
    db.run(sql`
      UPDATE events SET employee_id = (SELECT id FROM employees WHERE code = events.person_code)
      WHERE employee_id IS NULL AND person_code IS NOT NULL`);
    // Y el historial importado de HikCentral (que viene sin legajo) se vincula por nombre.
    linkImported(this.ctx);
    return summary;
  }
}

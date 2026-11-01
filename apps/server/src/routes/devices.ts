import { DeviceError, listDrivers } from '@careador/devices';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { devices, events, sites } from '../db/schema';
import { driverFor, isReadOnly } from '../lib/devices';

const deviceInput = z.object({
  siteId: z.number().int().positive(),
  name: z.string().trim().min(1),
  brand: z.string().min(1),
  host: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  https: z.boolean().default(false),
  utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('-03:00'),
  readOnly: z.boolean().default(false),
});

const siteInput = z.object({
  name: z.string().trim().min(1),
  timezone: z.string().default('America/Argentina/Buenos_Aires'),
});

export async function deviceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, secrets, config } = ctx;
  const drivers = () => listDrivers({ includeSimulated: config.SIMULATOR_ENABLED });

  /** Nunca devolver la contraseña (ni cifrada) al cliente. */
  function publicDevice(d: typeof devices.$inferSelect) {
    const { passwordEnc: _omit, ...rest } = d;
    return { ...rest, effectiveReadOnly: isReadOnly(ctx, d) };
  }

  function sendDeviceError(reply: FastifyReply, err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof DeviceError ? err.code : 'device_error';
    return reply.code(code === 'read_only' ? 409 : 502).send({ ok: false, code, error: message });
  }

  /** Datos del entorno para que la app muestre avisos (pruebas, sólo lectura). */
  app.get('/api/entorno', async () => ({
    nombre: config.CAREADOR_ENTORNO,
    empresa: config.CAREADOR_EMPRESA,
    equiposSoloLectura: config.DEVICES_READ_ONLY,
    simulador: config.SIMULATOR_ENABLED,
    drivers: drivers(),
  }));

  app.get('/api/sites', async () => db.select().from(sites).all());

  app.post('/api/sites', async (req, reply) => {
    const input = siteInput.parse(req.body);
    const [row] = db.insert(sites).values(input).returning().all();
    return reply.code(201).send(row);
  });

  app.get('/api/devices', async () => db.select().from(devices).all().map(publicDevice));

  app.post('/api/devices', async (req, reply) => {
    const input = deviceInput.parse(req.body);
    const { password, ...rest } = input;
    if (!drivers().some((d) => d.brand === input.brand)) {
      return reply.code(400).send({ error: `Marca no disponible: ${input.brand}` });
    }
    if (!db.select().from(sites).where(eq(sites.id, input.siteId)).get()) {
      return reply.code(400).send({ error: 'Sucursal inexistente' });
    }
    const [row] = db
      .insert(devices)
      .values({ ...rest, passwordEnc: secrets.encrypt(password) })
      .returning()
      .all();
    return reply.code(201).send(publicDevice(row!));
  });

  /**
   * Edita un equipo: datos de conexión (la contraseña sólo si viene), sólo lectura y habilitado.
   * Al habilitar la escritura, se manda lo pendiente.
   */
  app.patch<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const before = db.select().from(devices).where(eq(devices.id, id)).get();
    if (!before) return reply.code(404).send({ error: 'Equipo inexistente' });
    const input = deviceInput
      .pick({ siteId: true, name: true, host: true, username: true, readOnly: true, https: true })
      .extend({ password: z.string().optional(), enabled: z.boolean().optional() })
      .partial()
      .parse(req.body);
    const { password, ...rest } = input;
    if (rest.siteId && !db.select().from(sites).where(eq(sites.id, rest.siteId)).get()) {
      return reply.code(400).send({ error: 'Sucursal inexistente' });
    }
    req.auditBefore = publicDevice(before);
    const connChanged = password || (rest.host && rest.host !== before.host) || (rest.username && rest.username !== before.username);
    const [row] = db
      .update(devices)
      .set({
        ...rest,
        ...(password ? { passwordEnc: secrets.encrypt(password) } : {}),
        ...(connChanged ? { lastError: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(devices.id, id))
      .returning()
      .all();
    ctx.sync.kick();
    return publicDevice(row!);
  });

  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req, reply) => {
    if (db.select({ id: events.id }).from(events).where(eq(events.deviceId, Number(req.params.id))).limit(1).get()) {
      return reply.code(409).send({ error: 'El equipo ya tiene marcaciones: en lugar de quitarlo, editalo y desactivalo' });
    }
    const before = db.select().from(devices).where(eq(devices.id, Number(req.params.id))).get();
    req.auditBefore = before && publicDevice(before);
    const res = db.delete(devices).where(eq(devices.id, Number(req.params.id))).run();
    return res.changes ? { ok: true } : reply.code(404).send({ error: 'Equipo inexistente' });
  });

  /** Prueba la conexión con el equipo y guarda modelo/serie/firmware. */
  app.post<{ Params: { id: string } }>('/api/devices/:id/test', async (req, reply) => {
    const id = Number(req.params.id);
    const device = db.select().from(devices).where(eq(devices.id, id)).get();
    if (!device) return reply.code(404).send({ error: 'Equipo inexistente' });

    const driver = driverFor(ctx, device);
    try {
      const [info, capabilities] = await Promise.all([driver.getInfo(), driver.getCapabilities()]);
      db.update(devices)
        .set({
          model: info.model,
          serialNumber: info.serialNumber,
          firmware: info.firmware,
          lastSeenAt: new Date(),
          lastError: null,
          updatedAt: new Date(),
        })
        .where(eq(devices.id, id))
        .run();
      return { ok: true, info, capabilities };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.update(devices).set({ lastError: message }).where(eq(devices.id, id)).run();
      return sendDeviceError(reply, err);
    }
  });
}

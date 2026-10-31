import { createDriver, DeviceError, listDrivers } from '@careador/devices';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { devices, sites } from '../db/schema';
import type { AppContext } from '../app';

const deviceInput = z.object({
  siteId: z.number().int().positive(),
  name: z.string().min(1),
  brand: z.string().min(1),
  host: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
  https: z.boolean().default(false),
  utcOffset: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('-03:00'),
});

const siteInput = z.object({
  name: z.string().min(1),
  timezone: z.string().default('America/Argentina/Buenos_Aires'),
});

/** Nunca devolver la contraseña (ni cifrada) al cliente. */
function publicDevice(d: typeof devices.$inferSelect) {
  const { passwordEnc: _omit, ...rest } = d;
  return rest;
}

export async function deviceRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, secrets } = ctx;

  app.get('/api/drivers', async () => listDrivers());

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
    if (!listDrivers().some((d) => d.brand === input.brand)) {
      return reply.code(400).send({ error: `Marca no soportada: ${input.brand}` });
    }
    const [row] = db
      .insert(devices)
      .values({ ...rest, passwordEnc: secrets.encrypt(password) })
      .returning()
      .all();
    return reply.code(201).send(publicDevice(row!));
  });

  /** Prueba la conexión con el equipo y guarda modelo/serie/firmware. */
  app.post<{ Params: { id: string } }>('/api/devices/:id/test', async (req, reply) => {
    const id = Number(req.params.id);
    const device = db.select().from(devices).where(eq(devices.id, id)).get();
    if (!device) return reply.code(404).send({ error: 'Equipo inexistente' });

    const driver = createDriver(device.brand, {
      host: device.host,
      username: device.username,
      password: secrets.decrypt(device.passwordEnc),
      https: device.https,
      utcOffset: device.utcOffset,
    });

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
      const code = err instanceof DeviceError ? err.code : 'device_error';
      return reply.code(502).send({ ok: false, code, error: message });
    }
  });
}

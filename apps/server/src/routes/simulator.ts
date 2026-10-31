import { SimulatedDriver } from '@careador/devices';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { devices } from '../db/schema';

const faceInput = z.object({
  /** Sin personId = cara desconocida. */
  personId: z.string().optional(),
  /** Hora de la marcación (ISO). Si no viene, ahora. Permite cargar marcaciones pasadas. */
  at: z.string().datetime({ offset: true }).optional(),
});

const personInput = z.object({
  id: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(64),
});

const MAX_FACE_BYTES = 1024 * 1024;

/**
 * Pantalla del lector simulado: ver qué tiene cargado y "pararse frente al equipo".
 * Sólo existe si SIMULATOR_ENABLED=true.
 */
export async function simulatorRoutes(app: FastifyInstance, ctx: AppContext) {
  if (!ctx.config.SIMULATOR_ENABLED) return;
  const { db, config } = ctx;

  function simFor(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    const device = db
      .select()
      .from(devices)
      .where(and(eq(devices.id, Number(req.params.id)), eq(devices.brand, 'simulador')))
      .get();
    if (!device) {
      reply.code(404).send({ error: 'Simulador inexistente' });
      return null;
    }
    const sim = new SimulatedDriver(
      { host: device.host, username: device.username, password: '' },
      { dataDir: config.dataDir },
    );
    return { device, sim };
  }

  app.get<{ Params: { id: string } }>('/api/simulador/:id', async (req, reply) => {
    const s = simFor(req, reply);
    if (!s) return;
    return { device: { id: s.device.id, name: s.device.name }, ...s.sim.snapshot() };
  });

  app.get<{ Params: { id: string; personId: string } }>('/api/simulador/:id/cara/:personId', async (req, reply) => {
    const s = simFor(req, reply);
    if (!s) return;
    const jpeg = s.sim.getFace(req.params.personId);
    if (!jpeg) return reply.code(404).send({ error: 'Sin foto' });
    return reply.header('Cache-Control', 'no-store').type('image/jpeg').send(jpeg);
  });

  /** Alguien se para frente al lector. */
  app.post<{ Params: { id: string } }>('/api/simulador/:id/marcar', async (req, reply) => {
    const s = simFor(req, reply);
    if (!s) return;
    const { personId, at } = faceInput.parse(req.body ?? {});
    return s.sim.simulateFace(personId, at ? new Date(at) : undefined);
  });

  /** Alta directa en el equipo, como si se enrolara desde la pantalla del lector. */
  app.post<{ Params: { id: string } }>('/api/simulador/:id/personas', async (req, reply) => {
    const s = simFor(req, reply);
    if (!s) return;
    const p = personInput.parse(req.body);
    await s.sim.upsertPerson({ id: p.id, name: p.name, enabled: true });
    return reply.code(201).send({ ok: true });
  });

  /** Carga de cara directa en el equipo (body: JPEG). */
  app.put<{ Params: { id: string; personId: string } }>(
    '/api/simulador/:id/cara/:personId',
    { bodyLimit: MAX_FACE_BYTES },
    async (req, reply) => {
      const s = simFor(req, reply);
      if (!s) return;
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'Falta la imagen JPEG' });
      await s.sim.setFace(req.params.personId, body);
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; personId: string } }>('/api/simulador/:id/personas/:personId', async (req, reply) => {
    const s = simFor(req, reply);
    if (!s) return;
    await s.sim.deletePerson(req.params.personId);
    return { ok: true };
  });
}

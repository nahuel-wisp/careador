import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { employeeFaces, employees, enrollments, sites } from '../db/schema';
import { importPersons, markPending, MAX_FACE_BYTES } from '../lib/enrollment';
import { linkImported } from '../lib/history';

const employeeInput = z.object({
  /** Legajo: es el ID de la persona en los equipos. Si no viene, se asigna el siguiente número. */
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{1,32}$/, 'Legajo: hasta 32 letras, números, - o _')
    .optional(),
  firstName: z.string().trim().min(1).max(40),
  lastName: z.string().trim().min(1).max(40),
  documentNumber: z.string().trim().max(20).nullish(),
  siteId: z.number().int().positive().nullish(),
});

const employeePatch = employeeInput.omit({ code: true }).partial().extend({ active: z.boolean().optional() });


export async function employeeRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, sync } = ctx;

  function list(id?: number) {
    const rows = db
      .select({ e: employees, faceUpdatedAt: employeeFaces.updatedAt })
      .from(employees)
      .leftJoin(employeeFaces, eq(employeeFaces.employeeId, employees.id))
      .where(id ? eq(employees.id, id) : undefined)
      .orderBy(employees.lastName, employees.firstName)
      .all();
    const enr = db.select().from(enrollments).all();
    return rows.map(({ e, faceUpdatedAt }) => ({
      ...e,
      hasFace: !!faceUpdatedAt,
      faceUpdatedAt,
      devices: enr
        .filter((x) => x.employeeId === e.id)
        .map(({ deviceId, status, faceSynced, lastError, syncedAt }) => ({ deviceId, status, faceSynced, lastError, syncedAt })),
    }));
  }

  function nextCode(): string {
    const row = db.get<{ n: number | null }>(
      sql`SELECT MAX(CAST(code AS INTEGER)) AS n FROM employees WHERE code GLOB '[0-9]*' AND code NOT GLOB '*[^0-9]*'`,
    );
    return String((row?.n ?? 0) + 1);
  }

  function checkSite(siteId: number | null | undefined) {
    if (siteId && !db.select().from(sites).where(eq(sites.id, siteId)).get()) {
      throw Object.assign(new Error('Sucursal inexistente'), { statusCode: 400 });
    }
  }

  app.get('/api/employees', async () => list());

  app.post('/api/employees', async (req, reply) => {
    const { code, ...input } = employeeInput.parse(req.body);
    checkSite(input.siteId);
    const finalCode = code ?? nextCode();
    if (db.select().from(employees).where(eq(employees.code, finalCode)).get()) {
      return reply.code(409).send({ error: `Ya existe un empleado con legajo ${finalCode}` });
    }
    const [row] = db.insert(employees).values({ ...input, code: finalCode }).returning().all();
    sync.kick();
    linkImported(ctx); // historial de HikCentral que esperaba a este empleado
    return reply.code(201).send(list(row!.id)[0]);
  });

  app.patch<{ Params: { id: string } }>('/api/employees/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const prev = db.select().from(employees).where(eq(employees.id, id)).get();
    if (!prev) return reply.code(404).send({ error: 'Empleado inexistente' });
    const input = employeePatch.parse(req.body);
    checkSite(input.siteId);
    db.update(employees).set({ ...input, updatedAt: new Date() }).where(eq(employees.id, id)).run();

    if (input.active === false && prev.active) {
      // Baja: se borra de los equipos (se conserva en la base por sus marcaciones).
      db.update(enrollments).set({ status: 'pending_delete' }).where(eq(enrollments.employeeId, id)).run();
    } else if (input.active === true && !prev.active) {
      db.update(enrollments)
        .set({ status: 'pending', faceSynced: false })
        .where(and(eq(enrollments.employeeId, id), eq(enrollments.status, 'pending_delete')))
        .run();
    } else if (input.firstName !== undefined || input.lastName !== undefined) {
      markPending(ctx, id);
    }
    sync.kick();
    linkImported(ctx); // historial de HikCentral que esperaba a este empleado
    return list(id)[0];
  });

  app.put<{ Params: { id: string } }>('/api/employees/:id/face', async (req, reply) => {
    const id = Number(req.params.id);
    if (!db.select().from(employees).where(eq(employees.id, id)).get()) {
      return reply.code(404).send({ error: 'Empleado inexistente' });
    }
    const jpeg = req.body;
    if (!Buffer.isBuffer(jpeg) || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      return reply.code(400).send({ error: 'La foto tiene que ser JPEG' });
    }
    if (jpeg.length > MAX_FACE_BYTES) return reply.code(400).send({ error: 'Foto demasiado grande (máx. 1 MB)' });
    db.insert(employeeFaces)
      .values({ employeeId: id, jpeg })
      .onConflictDoUpdate({ target: employeeFaces.employeeId, set: { jpeg, updatedAt: new Date() } })
      .run();
    markPending(ctx, id, { face: true });
    sync.kick();
    return list(id)[0];
  });

  app.get<{ Params: { id: string } }>('/api/employees/:id/face', async (req, reply) => {
    const face = db.select().from(employeeFaces).where(eq(employeeFaces.employeeId, Number(req.params.id))).get();
    if (!face) return reply.code(404).send({ error: 'Sin foto' });
    return reply.header('Cache-Control', 'private, max-age=86400').type('image/jpeg').send(face.jpeg);
  });

  /** Sincroniza ya (y espera): botón "Sincronizar" de la app. */
  app.post('/api/sync', async () => sync.run());

  /** Trae las personas (con legajo y foto) que ya están cargadas en un equipo. */
  app.post<{ Params: { id: string } }>('/api/devices/:id/import-persons', async (req) => {
    const res = await importPersons(ctx, Number(req.params.id), (msg) => req.log.warn(msg));
    sync.kick();
    return res;
  });
}

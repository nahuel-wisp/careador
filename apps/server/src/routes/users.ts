import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { appUsers, sessions } from '../db/schema';
import { audit } from '../lib/audit';
import { hashPassword } from '../lib/password';

const password = z.string().min(10, 'La contraseña tiene que tener al menos 10 caracteres').max(200);
const role = z.enum(['admin', 'manager']);
const ROLE: Record<string, string> = { admin: 'administrador', manager: 'encargado' };

/** Lo que se muestra de un usuario (nunca el hash). */
const view = (u: typeof appUsers.$inferSelect) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  active: u.active,
  mustChangePassword: u.mustChangePassword,
  createdAt: u.createdAt,
});

/**
 * Usuarios de la app (sólo administradores, ver adminOnly en auth.ts). Las contraseñas que pone un admin son
 * provisorias: el usuario la cambia al entrar. Desactivar cierra sus sesiones; nada se borra.
 */
export async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  const get = (id: number) => {
    const u = db.select().from(appUsers).where(eq(appUsers.id, id)).get();
    if (!u) throw Object.assign(new Error('Usuario inexistente'), { statusCode: 404 });
    return u;
  };

  app.get('/api/users', async () => db.select().from(appUsers).orderBy(asc(appUsers.name)).all().map(view));

  app.post('/api/users', async (req, reply) => {
    const b = z
      .object({ email: z.string().trim().toLowerCase().email('Email inválido'), name: z.string().trim().min(1).max(80), role, password })
      .parse(req.body);
    if (db.select().from(appUsers).where(eq(appUsers.email, b.email)).get()) {
      return reply.code(409).send({ error: 'Ya hay un usuario con ese email' });
    }
    const [u] = db
      .insert(appUsers)
      .values({ email: b.email, name: b.name, role: b.role, passwordHash: await hashPassword(b.password), mustChangePassword: true })
      .returning()
      .all();
    audit(ctx, req, { action: 'usuario.crear', summary: `Creó el usuario ${b.name} (${b.email}, ${ROLE[b.role]})` });
    return reply.code(201).send(view(u!));
  });

  /** Nombre, rol o activo. No se puede sacar a uno mismo el rol de admin ni desactivarse. */
  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const b = z.object({ name: z.string().trim().min(1).max(80), role, active: z.boolean() }).partial().parse(req.body);
    const u = get(Number(req.params.id));
    if (u.id === req.user!.id && (b.active === false || b.role === 'manager')) {
      return reply.code(400).send({ error: 'No podés desactivarte ni sacarte el rol de administrador a vos mismo' });
    }
    const [row] = db.update(appUsers).set({ ...b, updatedAt: new Date() }).where(eq(appUsers.id, u.id)).returning().all();
    if (b.active === false) db.delete(sessions).where(eq(sessions.userId, u.id)).run();
    const what = [
      b.active === false ? 'lo desactivó' : b.active === true ? 'lo reactivó' : null,
      b.role && b.role !== u.role ? `rol ${ROLE[b.role]}` : null,
      b.name && b.name !== u.name ? `nombre «${b.name}»` : null,
    ].filter(Boolean);
    audit(ctx, req, { action: 'usuario.editar', summary: `Usuario ${u.name}: ${what.join(', ') || 'sin cambios'}` });
    return view(row!);
  });

  /** Contraseña provisoria nueva (se olvidó la suya): cierra sus sesiones y la tiene que cambiar al entrar. */
  app.post<{ Params: { id: string } }>('/api/users/:id/password', async (req) => {
    const b = z.object({ password }).parse(req.body);
    const u = get(Number(req.params.id));
    db.update(appUsers)
      .set({ passwordHash: await hashPassword(b.password), mustChangePassword: true, updatedAt: new Date() })
      .where(eq(appUsers.id, u.id))
      .run();
    db.delete(sessions).where(eq(sessions.userId, u.id)).run();
    audit(ctx, req, { action: 'usuario.clave', summary: `Le puso una contraseña provisoria a ${u.name}` });
    return { ok: true };
  });
}

import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { appUsers, sessions } from '../db/schema';
import { audit } from '../lib/audit';
import { hashPassword } from '../lib/password';
import { usernameRule } from './auth';

const password = z.string().min(10, 'La contraseña tiene que tener al menos 10 caracteres').max(200);
const role = z.enum(['admin', 'manager']);
const ROLE: Record<string, string> = { admin: 'administrador', manager: 'encargado' };

/** Lo que se muestra de un usuario (nunca el hash). */
const view = (u: typeof appUsers.$inferSelect) => ({
  id: u.id,
  username: u.username,
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
      .object({ username: usernameRule, name: z.string().trim().min(1).max(80), role, password })
      .parse(req.body);
    if (db.select().from(appUsers).where(eq(appUsers.username, b.username)).get()) {
      return reply.code(409).send({ error: 'Ya hay alguien con ese usuario' });
    }
    const [u] = db
      .insert(appUsers)
      .values({ username: b.username, name: b.name, role: b.role, passwordHash: await hashPassword(b.password), mustChangePassword: true })
      .returning()
      .all();
    audit(ctx, req, { action: 'usuario.crear', summary: `Creó el usuario ${b.name} (${b.username}, ${ROLE[b.role]})` });
    return reply.code(201).send(view(u!));
  });

  /** Usuario, nombre, rol o activo. No se puede sacar a uno mismo el rol de admin ni desactivarse. */
  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const b = z
      .object({ username: usernameRule, name: z.string().trim().min(1).max(80), role, active: z.boolean() })
      .partial()
      .parse(req.body);
    const u = get(Number(req.params.id));
    if (b.username && b.username !== u.username && db.select().from(appUsers).where(eq(appUsers.username, b.username)).get()) {
      return reply.code(409).send({ error: 'Ya hay alguien con ese usuario' });
    }
    if (u.id === req.user!.id && (b.active === false || b.role === 'manager')) {
      return reply.code(400).send({ error: 'No podés desactivarte ni sacarte el rol de administrador a vos mismo' });
    }
    const [row] = db.update(appUsers).set({ ...b, updatedAt: new Date() }).where(eq(appUsers.id, u.id)).returning().all();
    if (b.active === false) db.delete(sessions).where(eq(sessions.userId, u.id)).run();
    const what = [
      b.active === false ? 'lo desactivó' : b.active === true ? 'lo reactivó' : null,
      b.role && b.role !== u.role ? `rol ${ROLE[b.role]}` : null,
      b.name && b.name !== u.name ? `nombre «${b.name}»` : null,
      b.username && b.username !== u.username ? `usuario «${b.username}»` : null,
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

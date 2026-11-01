import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { appUsers, sessions } from '../db/schema';
import { audit } from '../lib/audit';
import { DUMMY_HASH, hashPassword, verifyPassword } from '../lib/password';

export const SESSION_COOKIE = 'careador_sesion';
/** Sesión larga: los dueños usan la app desde el celular y no quieren loguearse seguido. */
const SESSION_DAYS = 60;
/** Si a la sesión le quedan menos días que esto, se renueva sola. */
const RENEW_BELOW_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'manager';
  /** Tiene contraseña provisoria: sólo puede cambiarla (o salir). */
  mustChangePassword: boolean;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

/** Usuario para entrar: sin espacios (puede ser un nombre como «pilar» o un email, que es lo que había antes). */
export const usernameRule = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'El usuario tiene que tener al menos 3 caracteres')
  .max(60)
  .regex(/^[a-z0-9._@-]+$/, 'Usuario: letras, números, punto, guion o @, sin espacios ni acentos');

// `email` se acepta por si queda abierta una versión vieja de la app en algún celular.
const loginInput = z
  .object({ username: z.string().optional(), email: z.string().optional(), password: z.string().min(1) })
  .transform((b) => ({ username: (b.username ?? b.email ?? '').trim().toLowerCase(), password: b.password }));

/** Rutas de la API que no requieren sesión. */
const PUBLIC_API = new Set(['/api/health', '/api/auth/login']);
/** Lo único que puede hacer quien tiene contraseña provisoria. */
const WHILE_MUST_CHANGE = new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/password', '/api/entorno']);

/**
 * Lo que sólo puede hacer un administrador: equipos (salvo verlos), sucursales nuevas, usuarios, importar el
 * historial de HikCentral y el simulador.
 * Los encargados (`manager`, los dueños) usan Personal, Asistencia, Novedades, Horarios y Reportes.
 */
function adminOnly(method: string, path: string) {
  return (
    path.startsWith('/api/users') ||
    path.startsWith('/api/simulador') ||
    path.startsWith('/api/history') ||
    (path.startsWith('/api/devices') && method !== 'GET') ||
    (path === '/api/sites' && method === 'POST')
  );
}

const passwordRule = z.string().min(10, 'La contraseña tiene que tener al menos 10 caracteres').max(200);

export const sessionUser = (u: typeof appUsers.$inferSelect): SessionUser => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  mustChangePassword: u.mustChangePassword,
});

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.decorateRequest('user', null);

  function setCookie(reply: FastifyReply, req: FastifyRequest, token: string, expires: Date) {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      expires,
    });
  }

  // Resuelve la sesión y protege toda la API salvo las rutas públicas.
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/')) return;

    // Protección CSRF: cambios de estado sólo desde el mismo origen.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const origin = req.headers.origin;
      if (origin && new URL(origin).host !== req.host) {
        return reply.code(403).send({ error: 'Origen no permitido' });
      }
    }

    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const now = new Date();
      const row = db
        .select({ session: sessions, user: appUsers })
        .from(sessions)
        .innerJoin(appUsers, eq(appUsers.id, sessions.userId))
        .where(and(eq(sessions.id, tokenHash(token)), gt(sessions.expiresAt, now), eq(appUsers.active, true)))
        .get();
      if (row) {
        req.user = sessionUser(row.user);
        if (row.session.expiresAt.getTime() - now.getTime() < RENEW_BELOW_DAYS * DAY) {
          const expiresAt = new Date(now.getTime() + SESSION_DAYS * DAY);
          db.update(sessions).set({ expiresAt }).where(eq(sessions.id, row.session.id)).run();
          setCookie(reply, req, token, expiresAt);
        }
      }
    }

    if (!req.user && !PUBLIC_API.has(path)) {
      return reply.code(401).send({ error: 'Sesión no iniciada' });
    }
    if (req.user?.mustChangePassword && !WHILE_MUST_CHANGE.has(path)) {
      return reply.code(403).send({ error: 'Antes de seguir tenés que cambiar la contraseña', code: 'must_change_password' });
    }
    if (req.user && req.user.role !== 'admin' && adminOnly(req.method, path)) {
      return reply.code(403).send({ error: 'Sólo un administrador puede hacer esto' });
    }
  });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { username, password } = loginInput.parse(req.body);
      const user = db.select().from(appUsers).where(eq(appUsers.username, username)).get();
      const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok || !user.active) {
        return reply.code(401).send({ error: 'Usuario o contraseña incorrectos' });
      }

      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
      db.insert(sessions)
        .values({
          id: tokenHash(token),
          userId: user.id,
          expiresAt,
          userAgent: req.headers['user-agent']?.slice(0, 300),
          ip: req.ip,
        })
        .run();
      // Limpieza de sesiones vencidas.
      db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();

      setCookie(reply, req, token, expiresAt);
      return sessionUser(user);
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.delete(sessions).where(eq(sessions.id, tokenHash(token))).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => req.user);

  /** Cambiar la propia contraseña (obligatorio si era provisoria). Cierra las otras sesiones. */
  app.post(
    '/api/auth/password',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { current, next } = z.object({ current: z.string().min(1), next: passwordRule }).parse(req.body);
      const user = db.select().from(appUsers).where(eq(appUsers.id, req.user!.id)).get()!;
      if (!(await verifyPassword(current, user.passwordHash))) {
        return reply.code(400).send({ error: 'La contraseña actual no es correcta' });
      }
      if (current === next) return reply.code(400).send({ error: 'La nueva tiene que ser distinta de la actual' });
      db.update(appUsers)
        .set({ passwordHash: await hashPassword(next), mustChangePassword: false, updatedAt: new Date() })
        .where(eq(appUsers.id, user.id))
        .run();
      const token = req.cookies[SESSION_COOKIE];
      db.delete(sessions)
        .where(and(eq(sessions.userId, user.id), token ? ne(sessions.id, tokenHash(token)) : undefined))
        .run();
      audit(ctx, req, { action: 'usuario.clave', summary: `${user.name} cambió su contraseña` });
      return sessionUser({ ...user, mustChangePassword: false });
    },
  );
}

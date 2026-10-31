import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../app';
import { appUsers, sessions } from '../db/schema';
import { DUMMY_HASH, verifyPassword } from '../lib/password';

export const SESSION_COOKIE = 'careador_sesion';
/** Sesión larga: los dueños usan la app desde el celular y no quieren loguearse seguido. */
const SESSION_DAYS = 60;
/** Si a la sesión le quedan menos días que esto, se renueva sola. */
const RENEW_BELOW_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: 'admin' | 'manager';
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const loginInput = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

/** Rutas de la API que no requieren sesión. */
const PUBLIC_API = new Set(['/api/health', '/api/auth/login']);

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
        req.user = { id: row.user.id, email: row.user.email, name: row.user.name, role: row.user.role };
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
  });

  app.post(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const { email, password } = loginInput.parse(req.body);
      const user = db.select().from(appUsers).where(eq(appUsers.email, email)).get();
      const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
      if (!user || !ok || !user.active) {
        return reply.code(401).send({ error: 'Email o contraseña incorrectos' });
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
      return { id: user.id, email: user.email, name: user.name, role: user.role } satisfies SessionUser;
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) db.delete(sessions).where(eq(sessions.id, tokenHash(token))).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => req.user);
}

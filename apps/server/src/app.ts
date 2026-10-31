import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import type { Config } from './config';
import { openDb, type Db } from './db';
import { SecretBox } from './lib/crypto';
import { authRoutes } from './routes/auth';
import { deviceRoutes } from './routes/devices';

export interface AppContext {
  config: Config;
  db: Db;
  secrets: SecretBox;
}

export async function buildApp(config: Config) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 5 * 1024 * 1024, // fotos faciales
    // Detrás de un proxy (Traefik): confiar en X-Forwarded-For/Proto/Host.
    trustProxy: config.TRUST_PROXY,
  });

  const ctx: AppContext = {
    config,
    db: openDb(config.dataDir),
    secrets: new SecretBox(config.CAREADOR_SECRET),
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Datos inválidos', issues: err.issues });
    }
    app.log.error(err);
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    return reply.code(status).send({ error: status < 500 ? (err as Error).message : 'Error interno' });
  });

  app.get('/api/health', async () => ({ ok: true, time: new Date().toISOString() }));

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });
  await authRoutes(app, ctx);
  await deviceRoutes(app, ctx);

  // En producción el mismo servidor entrega la web (PWA).
  const webDist = resolve(config.WEB_DIST ?? '../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') ? reply.code(404).send({ error: 'No encontrado' }) : reply.sendFile('index.html'),
    );
  }

  return app;
}

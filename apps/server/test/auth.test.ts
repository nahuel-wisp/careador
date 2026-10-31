import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { appUsers } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';
import { openDb } from '../src/db';

const dataDir = mkdtempSync(join(tmpdir(), 'careador-test-'));
const config = loadConfig({ CAREADOR_SECRET: 'x'.repeat(40), DATA_DIR: dataDir, WEB_DIST: join(dataDir, 'nada') });
let app: Awaited<ReturnType<typeof buildApp>>;

beforeAll(async () => {
  openDb(config.dataDir)
    .insert(appUsers)
    .values({ email: 'duenio@example.com', name: 'Dueño', role: 'admin', passwordHash: await hashPassword('una-clave-larga') })
    .run();
  app = await buildApp({ ...config });
  app.log.level = 'silent';
});

afterAll(async () => {
  await app.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const login = (password: string) =>
  app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'Duenio@Example.com', password } });

describe('auth', () => {
  it('bloquea la API sin sesión pero deja pasar health', async () => {
    expect((await app.inject('/api/devices')).statusCode).toBe(401);
    expect((await app.inject('/api/health')).statusCode).toBe(200);
  });

  it('rechaza contraseña incorrecta', async () => {
    expect((await login('mal')).statusCode).toBe(401);
  });

  it('inicia sesión, accede a la API y cierra sesión', async () => {
    const res = await login('una-clave-larga');
    expect(res.statusCode).toBe(200);
    const cookie = res.cookies.find((c) => c.name === 'careador_sesion')!;
    expect(cookie.httpOnly).toBe(true);
    const headers = { cookie: `careador_sesion=${cookie.value}` };

    expect((await app.inject({ url: '/api/auth/me', headers })).json()).toMatchObject({ email: 'duenio@example.com' });
    expect((await app.inject({ url: '/api/devices', headers })).statusCode).toBe(200);

    await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} });
    expect((await app.inject({ url: '/api/devices', headers })).statusCode).toBe(401);
  });

  it('rechaza pedidos desde otro origen', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://malicioso.example' },
      payload: { email: 'duenio@example.com', password: 'una-clave-larga' },
    });
    expect(res.statusCode).toBe(403);
  });
});

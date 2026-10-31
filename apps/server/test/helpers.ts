import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db';
import { appUsers } from '../src/db/schema';
import { hashPassword } from '../src/lib/password';

export async function testApp(env: Record<string, string> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'careador-test-'));
  const config = loadConfig({
    CAREADOR_SECRET: 'x'.repeat(40),
    DATA_DIR: dataDir,
    WEB_DIST: join(dataDir, 'nada'),
    ...env,
  });
  openDb(config.dataDir)
    .insert(appUsers)
    .values({ email: 'duenio@example.com', name: 'Dueño', role: 'admin', passwordHash: await hashPassword('una-clave-larga') })
    .run();
  const app = await buildApp(config);
  app.log.level = 'silent';

  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'duenio@example.com', password: 'una-clave-larga' },
  });
  const cookie = res.cookies.find((c) => c.name === 'careador_sesion')!;
  const headers = { cookie: `careador_sesion=${cookie.value}` };

  return {
    app,
    headers,
    async close() {
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

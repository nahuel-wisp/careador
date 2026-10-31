import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

export type Db = ReturnType<typeof openDb>;

/** Busca la carpeta de migraciones tanto corriendo desde src/ (dev) como desde dist/ (prod). */
function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const candidate of ['../drizzle', '../../drizzle']) {
    const dir = resolve(here, candidate);
    if (existsSync(join(dir, 'meta', '_journal.json'))) return dir;
  }
  throw new Error('No se encontró la carpeta de migraciones (apps/server/drizzle)');
}

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new Database(join(dataDir, 'careador.db'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  return db;
}

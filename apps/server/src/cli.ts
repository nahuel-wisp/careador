/**
 * Tareas de administración por consola.
 *   node dist/cli.js usuario:crear <email> "<nombre>" [admin|manager]
 *   node dist/cli.js usuario:clave <email>
 *   node dist/cli.js usuario:listar
 *   node dist/cli.js db:respaldo [carpeta] [dias_a_conservar]
 */
import { eq } from 'drizzle-orm';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from './config';
import { openDb } from './db';
import { appUsers, sessions } from './db/schema';
import { hashPassword } from './lib/password';

async function askPassword(): Promise<string> {
  if (process.env.CAREADOR_PASSWORD) return process.env.CAREADOR_PASSWORD;
  const rl = createInterface({ input: stdin, output: stdout });
  const pass = await rl.question('Contraseña (mín. 10 caracteres): ');
  rl.close();
  return pass;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const db = openDb(loadConfig().dataDir);

  switch (cmd) {
    case 'usuario:crear': {
      const [email, name, role = 'admin'] = args;
      if (!email || !name || (role !== 'admin' && role !== 'manager')) {
        throw new Error('Uso: usuario:crear <email> "<nombre>" [admin|manager]');
      }
      const password = await askPassword();
      if (password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');
      db.insert(appUsers)
        .values({ email: email.toLowerCase(), name, role, passwordHash: await hashPassword(password) })
        .run();
      console.log(`Usuario ${email} creado (${role}).`);
      break;
    }
    case 'usuario:clave': {
      const [email] = args;
      if (!email) throw new Error('Uso: usuario:clave <email>');
      const user = db.select().from(appUsers).where(eq(appUsers.email, email.toLowerCase())).get();
      if (!user) throw new Error(`No existe el usuario ${email}`);
      const password = await askPassword();
      if (password.length < 10) throw new Error('La contraseña debe tener al menos 10 caracteres');
      db.update(appUsers).set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
        .where(eq(appUsers.id, user.id)).run();
      db.delete(sessions).where(eq(sessions.userId, user.id)).run();
      console.log(`Contraseña actualizada; se cerraron las sesiones de ${email}.`);
      break;
    }
    case 'usuario:listar': {
      for (const u of db.select().from(appUsers).all()) {
        console.log(`${u.id}\t${u.email}\t${u.name}\t${u.role}\t${u.active ? 'activo' : 'inactivo'}`);
      }
      break;
    }
    case 'db:respaldo': {
      // Copia consistente de la base aunque la app esté escribiendo, y borra copias viejas.
      const [dir = join(loadConfig().dataDir, 'respaldos'), keepDays = '30'] = args;
      mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const file = join(dir, `careador-${stamp}.db`);
      await db.$client.backup(file);
      const limit = Date.now() - Number(keepDays) * 24 * 60 * 60 * 1000;
      for (const f of readdirSync(dir)) {
        if (/^careador-.*\.db$/.test(f) && statSync(join(dir, f)).mtimeMs < limit) unlinkSync(join(dir, f));
      }
      console.log(`Respaldo creado: ${file}`);
      break;
    }
    default:
      console.log('Comandos: usuario:crear, usuario:clave, usuario:listar, db:respaldo [carpeta] [dias]');
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

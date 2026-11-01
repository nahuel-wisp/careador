/**
 * Tareas de administración por consola.
 *   node dist/cli.js usuario:crear <email> "<nombre>" [admin|manager]
 *   node dist/cli.js usuario:clave <email>
 *   node dist/cli.js usuario:listar
 *   node dist/cli.js db:respaldo [carpeta] [dias_a_conservar]
 *   node dist/cli.js equipo:crear "<sucursal>" "<nombre>" <host[:puerto]> <usuario> [--solo-lectura]
 *       (la contraseña del equipo se pide o se lee de la entrada; si el host ya existe, se actualiza)
 *   node dist/cli.js equipo:listar
 *   node dist/cli.js equipo:importar [id]        trae personas y fotos (de todos los equipos si no hay id)
 *   node dist/cli.js marcaciones:leer            trae las marcaciones nuevas de todos los equipos
 *   node dist/cli.js historial:importar -        importa el Excel de HikCentral leído de la entrada
 */
import { eq } from 'drizzle-orm';
import type { AppContext } from './app';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { loadConfig } from './config';
import { openDb } from './db';
import { appUsers, devices, sessions, sites } from './db/schema';
import { SecretBox } from './lib/crypto';
import { driverFor } from './lib/devices';
import { EnrollmentSync, importPersons } from './lib/enrollment';
import { EventSync } from './lib/events';
import { importRecords, parseHikcentralRecords } from './lib/history';
import { hashPassword } from './lib/password';

async function askPassword(prompt = 'Contraseña (mín. 10 caracteres): '): Promise<string> {
  if (process.env.CAREADOR_PASSWORD) return process.env.CAREADOR_PASSWORD;
  const rl = createInterface({ input: stdin, output: stdout });
  const pass = await rl.question(prompt);
  rl.close();
  return pass;
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const db = openDb(config.dataDir);
  // Lo mismo que arma la app, para usar equipos y sincronizaciones desde la consola.
  const ctx = { config, db, secrets: new SecretBox(config.CAREADOR_SECRET) } as AppContext;
  ctx.sync = new EnrollmentSync(ctx);
  ctx.events = new EventSync(ctx);

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
    case 'equipo:crear': {
      const flags = args.filter((a) => a.startsWith('--'));
      const [siteName, name, host, username] = args.filter((a) => !a.startsWith('--'));
      if (!siteName || !name || !host || !username) {
        throw new Error('Uso: equipo:crear "<sucursal>" "<nombre>" <host[:puerto]> <usuario> [--solo-lectura]');
      }
      const password = await askPassword(`Contraseña de ${username} en ${host}: `);
      if (!password) throw new Error('Falta la contraseña');
      const site =
        db.select().from(sites).where(eq(sites.name, siteName)).get() ??
        db.insert(sites).values({ name: siteName }).returning().get();
      const values = {
        siteId: site.id,
        name,
        brand: 'hikvision',
        host,
        username,
        passwordEnc: ctx.secrets.encrypt(password),
        readOnly: flags.includes('--solo-lectura'),
        updatedAt: new Date(),
      };
      const prev = db.select().from(devices).where(eq(devices.host, host)).get();
      const device = prev
        ? db.update(devices).set(values).where(eq(devices.id, prev.id)).returning().get()
        : db.insert(devices).values(values).returning().get();
      console.log(`${prev ? 'Actualizado' : 'Creado'} equipo #${device.id} «${name}» (${site.name})${values.readOnly ? ', sólo lectura' : ''}.`);
      try {
        const info = await driverFor(ctx, device).getInfo();
        db.update(devices)
          .set({ model: info.model, serialNumber: info.serialNumber, firmware: info.firmware, lastSeenAt: new Date(), lastError: null })
          .where(eq(devices.id, device.id))
          .run();
        console.log(`  Conexión OK: ${info.model} · serie ${info.serialNumber} · firmware ${info.firmware}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        db.update(devices).set({ lastError: message }).where(eq(devices.id, device.id)).run();
        throw new Error(`  No se pudo conectar: ${message}`);
      }
      break;
    }
    case 'equipo:listar': {
      for (const d of db.select().from(devices).all()) {
        const site = db.select().from(sites).where(eq(sites.id, d.siteId)).get();
        console.log(
          [d.id, d.name, site?.name, d.host, d.model ?? '-', d.firmware ?? '-', d.readOnly ? 'sólo lectura' : 'lectura/escritura', d.lastError ?? 'ok'].join('	'),
        );
      }
      break;
    }
    case 'equipo:importar': {
      const list = args[0] ? db.select().from(devices).where(eq(devices.id, Number(args[0]))).all() : db.select().from(devices).all();
      if (!list.length) throw new Error('No hay equipos (ver equipo:listar)');
      let failed = false;
      for (const d of list) {
        try {
          const r = await importPersons(ctx, d.id, (msg) => console.warn(`    ${msg}`));
          console.log(`  ${d.name}: ${r.created} personas nuevas, ${r.existing} ya estaban · fotos: ${r.faces} traídas, ${r.facesFailed} con error`);
        } catch (err) {
          failed = true;
          console.error(`  ${d.name}: no se pudo importar: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (failed) process.exitCode = 1;
      break;
    }
    case 'marcaciones:leer': {
      const r = await ctx.events.run();
      console.log(`  Marcaciones: ${r.inserted} nuevas de ${r.devices} equipos${r.errors ? ` · ${r.errors} con error (ver equipo:listar)` : ''}`);
      break;
    }
    case 'historial:importar': {
      if (args[0] !== '-') throw new Error('Uso: historial:importar - < registros.xlsx');
      const r = importRecords(ctx, await parseHikcentralRecords(await readStdin()));
      console.log(`  Historial: ${r.days} días del ${r.from} al ${r.to}, ${r.inserted} marcas nuevas.`);
      if (r.unmatched.length) console.log(`  Todavía sin empleado: ${r.unmatched.map((u) => u.name).join(', ')}`);
      break;
    }
    default:
      console.log(
        'Comandos: usuario:crear, usuario:clave, usuario:listar, db:respaldo, equipo:crear, equipo:listar, equipo:importar, marcaciones:leer, historial:importar',
      );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

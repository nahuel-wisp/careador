import { resolve } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  CAREADOR_SECRET: z.string().min(32, 'CAREADOR_SECRET debe tener al menos 32 caracteres'),
  /**
   * Confiar en los headers X-Forwarded-*: "false", "true" (cualquier origen) o IPs/CIDR del proxy
   * separadas por coma (recomendado: sólo el proxy, si no cualquiera falsifica su IP y esquiva el rate limit).
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v): boolean | string => (v === 'true' ? true : v === 'false' || v === '' ? false : v)),
  /** Nombre del entorno, se muestra en la app ("pruebas", "produccion"). */
  CAREADOR_ENTORNO: z.string().default('produccion'),
  /** Nombre de la empresa cliente, se muestra arriba en la app. */
  CAREADOR_EMPRESA: z.string().default(''),
  /** Fuerza sólo lectura en TODOS los equipos (entorno de pruebas contra equipos reales). */
  DEVICES_READ_ONLY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Habilita el lector simulado. */
  SIMULATOR_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Carpeta con el build de la web. Si existe, el servidor la sirve. */
  WEB_DIST: z.string().optional(),
});

export type Config = z.infer<typeof schema> & { dataDir: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuración inválida (revisar .env):\n${issues}`);
  }
  return { ...parsed.data, dataDir: resolve(parsed.data.DATA_DIR) };
}

import { resolve } from 'node:path';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  CAREADOR_SECRET: z.string().min(32, 'CAREADOR_SECRET debe tener al menos 32 caracteres'),
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

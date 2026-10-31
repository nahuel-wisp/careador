// Empaqueta el servidor (y el paquete de drivers) en un solo archivo para desplegar en Windows Server.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  // Módulos nativos o con archivos propios quedan fuera del bundle.
  external: ['better-sqlite3', '@fastify/static'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});

# Careador

App web (mobile-first, instalable como PWA) para gestionar personal, horarios y reportes de asistencia
sobre equipos de control de acceso. Habla directo con los equipos (Hikvision vía ISAPI en la fase 1),
sin depender de HikCentral, y está diseñada para sumar otras marcas.

Contexto y decisiones: [docs/contexto.md](docs/contexto.md). Manual de uso: [docs/manual.md](docs/manual.md).
Versiones: [CHANGELOG.md](CHANGELOG.md). Despliegue y versionado: [docs/despliegue.md](docs/despliegue.md).

## Estructura

```
apps/
  server/      API (Fastify + SQLite/Drizzle). En producción también sirve la web.
  web/         PWA (React + Vite) pensada para usar desde el iPhone.
packages/
  devices/     Capa de dispositivos: interfaz común + drivers por marca (Hikvision ISAPI).
docs/          Contexto, decisiones y ejemplos.
```

## Desarrollo

Requisitos: Node.js 22 o superior.

```bash
npm install
cp .env.example .env   # y completar CAREADOR_SECRET
npm run dev            # API en :8080 y web en :5173 (con proxy a la API)
npm test
npm run typecheck
```

Cambios en la base: editar `apps/server/src/db/schema.ts` y correr
`npm run db:generate -w @careador/server -- --name descripcion`. Las migraciones se aplican solas al iniciar.

## Producción

```bash
npm run build
npm start              # sirve API + web en PORT (default 8080)
```

Instalación con Docker Compose en VM detrás de Traefik: [docs/despliegue.md](docs/despliegue.md).

Primer usuario: `npm run cli -w @careador/server -- usuario:crear email "Nombre" admin`.

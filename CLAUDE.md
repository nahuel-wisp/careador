# Careador — guía para trabajar en este repo

App web mobile-first (PWA) para gestionar personal, horarios y asistencia sobre lectores faciales,
hablando directo con los equipos (Hikvision ISAPI) sin HikCentral. En la app se llama **Fichada** (Careador
queda como nombre interno del repo). Primer cliente: **Arsa** = American Rider SA, concesionario de motos de
La Plata, oficial Benelli y multimarca (`CAREADOR_EMPRESA` en el .env de cada instancia)
(2 sucursales, 2 × DS-K1T321 firmware V3.9.2 build 240222, ~11–20 empleados, 3 dueños con iPhone).

Contexto completo y decisiones: `docs/contexto.md`. Despliegue: `docs/despliegue.md`.

## Forma de trabajo

- Todo en **español** (código comentado, docs, UI, commits). El usuario es el integrador (Nahuel):
  instaló y administra la red y los equipos del cliente.
- Explicar decisiones con recomendación clara, sin listas eternas de opciones.
- Commits chicos y descriptivos en `main`, push a GitHub (es el respaldo).
- Antes de commitear: `npm run typecheck && npm test` (y `npm run build` si se tocó la web).
- **Nunca** commitear datos reales del cliente: van en `docs/ejemplos/privado/` (ignorado por git).
- Nunca commitear credenciales de equipos, `.env` ni `CAREADOR_SECRET`.

## Arquitectura

```
apps/server     Fastify + SQLite (better-sqlite3 + Drizzle). Sirve la API y la web en producción.
apps/web        React + Vite + vite-plugin-pwa. Pensada para iPhone (instalable, cámara).
packages/devices  Capa multi-marca: interfaz DeviceDriver + drivers (hikvision, simulador) + readOnly().
deploy/         Dockerfile (raíz), compose.yml, env.produccion / env.pruebas, actualizar.sh, respaldo.cron
```

Principios que no hay que romper:

- La app **nunca** habla directo con una marca: siempre `driverFor()` → `DeviceDriver`. Las marcas
  declaran capacidades (`getCapabilities`). Segunda parte prevista: abrir puertas, permisos por puerta,
  porteros/intercom, visitas, multi-cliente.
- Modelo de datos neutral; se guarda el evento crudo (`raw`) para auditoría.
- Contraseñas de equipos cifradas (`SecretBox`, AES-GCM con `CAREADOR_SECRET`).
- Toda la API requiere sesión salvo `/api/health` y `/api/auth/login`.
- Cambios de esquema: editar `apps/server/src/db/schema.ts` y
  `npm run db:generate -w @careador/server -- --name descripcion` (las migraciones se aplican solas).

## Entornos (VM 10.10.70.5, Ubuntu 26.04 + Docker Compose, detrás de Traefik 10.10.70.2)

| | Producción | Pruebas |
|---|---|---|
| URL | `arsa.nmc.wisp.com.ar` | `arsa-test.nmc.wisp.com.ar` |
| Carpeta / puerto | `/srv/careador-arsa` · 8080 | `/srv/careador-arsa-test` · 8180 |
| Imagen | `careador:estable` | `careador:latest` |
| Equipos reales | lectura/escritura | forzado sólo lectura (`DEVICES_READ_ONLY=true`) |
| Simulador | no | sí (`SIMULATOR_ENABLED=true`) |

- DNS: comodín `*.nmc.wisp.com.ar` → 181.191.64.7 (Traefik) en PowerDNS. Let's Encrypt lo hace Traefik.
- La config de Traefik la maneja el usuario (tiene muchas modificaciones propias): no reescribirla,
  sólo indicar lo que la app necesita.
- Los lectores se alcanzan vía IP Cloud de los MikroTik (las sucursales tienen más de un proveedor).
  Recomendado: WireGuard hacia la MikroTik en lugar de port-forward de ISAPI.
- Backups: `db:respaldo` diario (cron) + Nakivo respalda la VM entera al servidor de backups (RAID 6).

## Estado (actualizar al avanzar)

Hecho:
- Driver Hikvision ISAPI (Digest, personas, caras, eventos, hora, puerta). **Sin probar contra el
  equipo real**: endpoints y códigos de evento salen de la documentación ISAPI; validar con V3.9.2.
- Lector simulado con pantalla web (`/simulador/:id`) y modo sólo lectura.
- Login (cookie de sesión 60 días, scrypt, rate limit, chequeo de origen) y CLI de usuarios.
- Alta/baja de sucursales y equipos desde la app; prueba de conexión.
- Docker + despliegue por entornos; instructivo. Pruebas y producción andando en 10.10.70.5 (31/10).
- **Personal**: alta con foto desde el celular, edición, baja/re-alta, importar personas de un equipo.
  Cada empleado activo va a todos los equipos habilitados (`lib/enrollment.ts`, reintento cada 5 min).
- **Marcaciones**: se leen de cada equipo cada 5 min y al arrancar (`lib/events.ts`, sólo lectura) y la
  pantalla Asistencia muestra por día entrada (primera) / salida (última) y quién no marcó.

Pendiente, en orden:
1. Crear los usuarios de los dueños en producción (`usuario:crear`, lo hace Nahuel por PuTTY) y la ruta a
   los lectores (WireGuard hacia las MikroTik, necesita sudo).
2. Probar el driver Hikvision contra los DS-K1T321 reales (en pruebas, sólo lectura).
3. **Horarios** (modelo en `docs/contexto.md`): turnos por día, almuerzo, tolerancias, asignación por
   empleado con vigencia, default por sucursal; rotativos/horas extra/feriados contemplados.
4. **Reportes Excel** (exceljs): hoja "Registros" igual a la de HikCentral
   (`docs/ejemplos/registros_entradas_salidas_anonimizado.xlsx`) + hoja "Resumen" por empleado.

Preguntas abiertas al cliente:
- Horarios oficiales: Arsa 1 ~L-V 9–18, sáb 9–13; Arsa 2 mayoría 8–18, algunos 9–18 u 8–17,
  sáb 9–13 (no todos). ¿Tolerancia? ¿Se descuenta almuerzo y cuánto? ¿Sábados rotan?
- En el Excel de septiembre aparecen 11 empleados, no 20: ¿bajas o gente que no marca?

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
- **Horarios y novedades**: horarios semanales con tolerancias (`schedules`), default por sucursal y horario
  propio con vigencia (`schedule_assignments`). El día se mide con el horario de la sucursal **donde marcó
  la entrada** (el personal rota). Novedades (`absences`: vacaciones, franco, licencia, enfermedad, feriado
  para todos, permisos de llegada/salida) con comprobantes adjuntos (`absence_files`, foto o PDF).
  Cálculo en `lib/schedule.ts` (`evaluateDay`): presente/tarde/salida anticipada/sin salida/ausente/novedad/libre.
- **Historial de HikCentral**: Asistencia → «Subir Excel de HikCentral» importa el informe «Registros de
  entradas y salidas» (`lib/history.ts`). Trae primera/última marca por día, sin legajo: se vincula por nombre
  (sin acentos ni orden) y lo que no coincide queda con `person_name` hasta que el empleado exista.

Pendiente, en orden:
1. Crear los usuarios de los dueños en producción (`usuario:crear`, lo hace Nahuel por PuTTY). Lectores:
   port-forward por IP Cloud `:1082` (Arsa 1 `cc230e7e1e6e.sn.mynetname.net`, Arsa 2 `d5030cc700bd...`);
   falta filtrar el origen a 181.191.64.9 (salida de la VM) y, más adelante, WireGuard. Cargarlos con
   `deploy/vm/04-lectores.sh` (quedan en sólo lectura también en producción hasta comparar con HikCentral).
2. Probar el driver Hikvision contra los DS-K1T321 reales (en pruebas, sólo lectura).
3. Cargar los horarios de Arsa en producción (relevados de HikCentral, `docs/contexto.md`).
4. **Reportes Excel** (exceljs): hoja "Registros" igual a la de HikCentral
   (`docs/ejemplos/registros_entradas_salidas_anonimizado.xlsx`) + hoja "Resumen" por empleado.

Más adelante: horas extra (¿la hora de más de Arsa 2 vs Arsa 1 es extra?; ver cómo lo liquida Arsa),
rotativos.

Preguntas abiertas al cliente:
- Horarios: relevados de HikCentral (`docs/contexto.md`, «Horarios actuales en HikCentral»): tolerancia 15 min,
  almuerzo 13–14 cuenta como trabajado. Falta confirmar si los sábados rotan y los casos 9–18 / 8–17 en Arsa 2.
- En el Excel de septiembre aparecen 11 empleados, no 20: ¿bajas o gente que no marca?
- Pilar, César y Sofía (sin departamento en HikCentral) son los **dueños**: sin horario, no se les mide asistencia.

# Careador — guía para trabajar en este repo

App web mobile-first (PWA) para gestionar personal, horarios y asistencia sobre lectores faciales,
hablando directo con los equipos (Hikvision ISAPI) sin HikCentral. En la app se llama **Control Horario** (Careador
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
- Driver Hikvision ISAPI (Digest, personas, caras, eventos, hora, puerta). **Validado contra los
  DS-K1T321MFWX reales (V3.9.2, 01/11)**: conexión, 17 personas, búsqueda de caras y marcaciones; los días
  28–30/09 coinciden al minuto con el Excel de HikCentral (31 de 32; el otro es una marca a las 07:53 que
  HikCentral ignora por estar fuera de su ventana de entrada). Notas:
  - **Los lectores no guardan la foto**, sólo el modelo facial (`faceURL` da 404 «Can't locate document»).
    Las fotos se sacaron de HikCentral (01/11): su web pide `.../PersonCredential/Persons/<id>/Photo?...&PHOTOTYPE=0`
    (miniatura 135×189); con `PHOTOTYPE=1` da la original (~500×716). Se tomaron de la página con la sesión del
    usuario, se pasaron a 480×640 y se cargaron con `personal:foto <legajo> < foto.jpg` (sin `--enviar`).
  - El nombre en el lector es «Nombre Apellido» (como lo carga HikCentral).
  - Por IP Cloud el Lector Arsa 1 corta pedidos largos: las marcaciones se leen de a un día.
  - `equipo:isapi <id> GET|POST <ruta>` (CLI) para diagnosticar contra el equipo, sólo lectura.
- Lector simulado con pantalla web (`/simulador/:id`) y modo sólo lectura.
- Login (cookie de sesión 60 días, scrypt, rate limit, chequeo de origen) y CLI de usuarios.
- Alta/baja de sucursales y equipos desde la app; prueba de conexión.
- Docker + despliegue por entornos; instructivo. Pruebas y producción andando en 10.10.70.5 (31/10).
- **Personal**: alta con foto desde el celular, edición, baja/re-alta, importar personas de un equipo.
  Cada empleado activo va a todos los equipos habilitados (`lib/enrollment.ts`, reintento cada hora).
- **Marcaciones**: se leen de cada equipo cada hora (sólo lo nuevo), al arrancar y con «Actualizar» (`lib/events.ts`, sólo lectura) y la
  pantalla Asistencia muestra por día entrada (primera) / salida (última) y quién no marcó.
- **Horarios y novedades**: horarios semanales con tolerancias (`schedules`), default por sucursal y horario
  propio con vigencia (`schedule_assignments`). El día se mide con el horario de la sucursal **donde marcó
  la entrada** (el personal rota). Novedades (`absences`: vacaciones, franco, licencia, enfermedad, feriado
  para todos, permisos de llegada/salida) con comprobantes adjuntos (`absence_files`, foto o PDF).
  Cálculo en `lib/schedule.ts` (`evaluateDay`): presente/tarde/salida anticipada/sin salida/ausente/novedad/libre.
- **Historial de HikCentral**: Asistencia → «Subir Excel de HikCentral» importa el informe «Registros de
  entradas y salidas» (`lib/history.ts`). Trae primera/última marca por día, sin legajo: se vincula por nombre
  (sin acentos ni orden) y lo que no coincide queda con `person_name` hasta que el empleado exista.
- **Reportes** (`lib/report.ts`, pantalla Reportes): hoy, ayer, semana, semana pasada, mes, mes anterior o
  entre fechas; por sucursal (donde trabajó ese día) y/o persona. Vista Resumen (por empleado) y Día por día
  (como el Excel de HikCentral, con observaciones). PDF con imprimir del navegador (CSS de impresión) y
  Excel (`/api/reports.xlsx`: hojas «Registros» con las columnas de HikCentral y «Resumen»).
  Exporta también CSV (del navegador, separado por «;»).
- **Entrada/salida** (`pickInOut`): entrada = primera marca hasta la mitad del horario, salida = última después;
  las del medio son «otras marcas» (pasó por el lector) y no cuentan. Si falta una, el día queda **«A revisar»**
  (la hora es una sugerencia y no se calcula tardanza/salida), salvo permiso de llegada/salida.
- **Correcciones a mano** (Asistencia → tocar a la persona, `routes/marks.ts`): agregar (marca `source='manual'`,
  motivo y quién en `raw`), cambiar hora (manual: se edita; de equipo: se anula y se agrega una manual) y
  anular/restaurar (`voided_*`). **Nada se borra.** Se ven como «Corregido a mano» en reportes.
- **Historial de cambios** (`audit_log`, `lib/audit.ts`): las marcas se registran solas; el resto de los cambios
  (personal, horarios, novedades, equipos, importaciones) con un hook `onResponse` y la tabla `LABELS`.
  Pantalla `/historial` (desde Reportes) y el historial del día en el detalle de Asistencia.
- Novedad **«Horario especial»**: otra entrada/salida para esos días (reemplaza al horario).

Pendiente, en orden:
1. Crear los usuarios de los dueños en producción (`usuario:crear`, lo hace Nahuel por PuTTY). Lectores:
   port-forward por IP Cloud `:1082` (Arsa 1 `cc230e7e1e6e.sn.mynetname.net`, Arsa 2 `d5030cc700bd...`);
   falta filtrar el origen a 181.191.64.9 (salida de la VM) y, más adelante, WireGuard. Cargarlos con
   `deploy/vm/04-lectores.sh` (quedan en sólo lectura también en producción hasta comparar con HikCentral).
2. Probar el driver Hikvision contra los DS-K1T321 reales (en pruebas, sólo lectura).
3. Cargar los horarios de Arsa en producción (relevados de HikCentral, `docs/contexto.md`).
4. Comparar lo que traen los lectores con HikCentral y, si coincide, pasar los lectores de producción a
   lectura/escritura (hoy `read_only = 1`).

Más adelante: horas extra (¿la hora de más de Arsa 2 vs Arsa 1 es extra?; ver cómo lo liquida Arsa),
rotativos.

Preguntas abiertas al cliente:
- Horarios: relevados de HikCentral (`docs/contexto.md`, «Horarios actuales en HikCentral»): tolerancia 15 min,
  almuerzo 13–14 cuenta como trabajado. Falta confirmar si los sábados rotan y los casos 9–18 / 8–17 en Arsa 2.
- En el Excel de septiembre aparecen 11 empleados, no 20: ¿bajas o gente que no marca?
- Pilar, César y Sofía (sin departamento en HikCentral) son los **dueños**: sin horario, no se les mide asistencia.

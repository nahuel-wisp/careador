# Careador — Contexto del proyecto

## Problema

Un cliente con **dos sucursales** usa dos lectores faciales **Hikvision DS-K1T321** para marcar
ingreso y egreso del personal. Los equipos están gestionados por **HikCentral Access Control (HCAC)**,
que corre en un Windows Server dentro de la red de una de las sucursales.

En la práctica sólo se usa para:

- registrar ingresos/egresos,
- sacar un resumen mensual en Excel.

Dolores actuales:

- Para entrar a HCAC hay que buscar una PC con Windows y usar Edge en modo Internet Explorer.
- La configuración de ese acceso se borra cada 30 días y hay que volver a cargarla.
- Hoy el Excel mensual lo saca el integrador y se lo pasa a los dueños.
- El alta de personal (con foto) se hace con la app HikCentral Mobile.

## Objetivo

Una app web simple, **mobile-first**, para:

1. **Alta/baja/edición de personal**, incluyendo **sacar la foto con el celular** y subirla a los equipos.
2. **Gestión de horarios** por sucursal y por empleado.
3. **Reportes en Excel** (asistencia, horas trabajadas, llegadas tarde, etc.).

## Decisión de arquitectura

**Hablar directo con los equipos vía ISAPI** (API HTTP de Hikvision), sin depender de HCAC.

- Alta/edición/baja de personas y carga de foto facial en ambos equipos.
- Lectura del historial de marcaciones guardado en cada equipo (polling periódico; el equipo
  conserva los eventos aunque la app esté caída) y eventualmente recepción en tiempo real.
- Sincronización de hora y estado de los equipos.
- Base de datos propia con personal, horarios y marcaciones; los cálculos de asistencia los hace la app.

HCAC puede quedar en paralelo durante la transición (ver riesgos).

### Cliente: web app instalable (PWA), no app nativa

- Usuarios: los 3 dueños, **todos con iPhone**. No queremos pagar cuenta de desarrollador Apple.
- Solución: **PWA** — se abre en Safari y se agrega a la pantalla de inicio; se ve y se usa como una app.
- La foto se saca con la cámara del celular desde el navegador, se recorta/comprime en el cliente
  al formato que acepta el equipo (JPEG liviano; requisitos exactos a verificar contra el DS-K1T321).
- Requiere **HTTPS** (cámara, instalación como PWA).
- Para Android, si hiciera falta, se puede empaquetar un APK aparte.

## Infraestructura

| Elemento | Detalle |
|---|---|
| Servidor | Windows Server en la red de una de las sucursales (donde hoy corre HCAC). Opción preferida para no sumar costo de nube. |
| Alternativa | Nube del integrador (costo extra para el cliente). |
| Red entre sucursales | Túnel L2TP entre dos MikroTik. Hoy sólo se comparte la ruta hacia el servidor. |
| Equipos | 2 × DS-K1T321, uno por sucursal. Acceso admin disponible. |
| Acceso externo | Requerido: los dueños usan la app desde fuera de la sucursal. |

Pendientes de infraestructura:

- Habilitar en el túnel/firewall que el servidor llegue al equipo de la **otra** sucursal (IP del lector).
- Definir cómo se publica la app con HTTPS hacia afuera. Candidatos:
  - **Cloudflare Tunnel** (sin abrir puertos, HTTPS automático, gratis).
  - Port-forward en MikroTik + dominio + Let's Encrypt.
  - VPN (Tailscale/WireGuard) en los celulares — más fricción para los usuarios.
- Correr la app como servicio de Windows.

## Usuarios

- ~20 empleados.
- 3 operadores (los dueños), que hacen todo: altas, horarios, reportes.

## Horarios — modelo a contemplar

Hoy: turnos fijos por sucursal, con horario de almuerzo; algunos empleados pueden tener horarios
distintos. No hay rotativos ni horas extra hoy, pero **todo debe ser configurable** para poder
reutilizar el sistema con otros clientes.

Conceptos:

- **Turno / plantilla horaria**: por día de la semana, hora de entrada y salida, corte de almuerzo.
- **Tolerancias**: minutos de gracia de entrada y salida.
- **Asignación**: empleado → turno, con vigencia desde/hasta (permite cambios y rotaciones).
- **Default por sucursal**: turno que hereda el empleado si no tiene uno propio.
- **Rotativos**: secuencia de turnos que se repite (a futuro).
- **Horas extra**: reglas opcionales (desactivadas por defecto).
- **Excepciones**: feriados, licencias, ausencias justificadas (a futuro).

## Reportes

- Excel mensual (o por rango de fechas) por sucursal / empleado.

### Reporte actual (HCAC) — `docs/ejemplos/registros_entradas_salidas_anonimizado.xlsx`

Ejemplo real de septiembre 2026, anonimizado (nombres inventados, sucursales renombradas).

Formato:

- Encabezado: título "Registros de entradas y salidas", hora de exportación, operador, período.
- Una fila por **empleado y día con marcaciones**, ordenado por empleado y fecha descendente.
- Columnas: Nombre · Apellido · Departamento (= sucursal, ej. `All Departments>Sucursal 2`) · Fecha ·
  Día de la semana · Entrada · Salida · Duración · Duración total (formato `HH : MM`).
- Entrada = primera marcación del día; Salida = última. Duración = salida − entrada, **sin descontar
  almuerzo** (no se marca al ir/volver de almorzar).
- Si falta una de las dos marcas se muestra `-` y la duración queda en `00 : 00`.
- No informa: tardanzas, ausencias, horas esperadas vs. trabajadas, totales por empleado.

Lo que muestran los datos (11 empleados con marcaciones: 3 en Sucursal 1, 8 en Sucursal 2):

| Sucursal | Lunes a viernes | Sábado |
|---|---|---|
| Sucursal 1 | ~09:00 – 18:00 | ~09:00 – 13:00 |
| Sucursal 2 | mayoría ~08:00 – 18:00; algunos 09:00 – 18:00 u 08:00 – 17:00 | ~09:00 – 13:00 (no todos) |

Hay días sueltos con salida 13:00/14:00 (medio día) y 3 casos de marca faltante en el mes.

### Reporte nuevo (propuesta)

1. **Hoja "Registros"**: mismo formato que el actual, para que no extrañen nada.
2. **Hoja "Resumen"**: una fila por empleado con días trabajados, horas totales, horas esperadas según
   su horario, llegadas tarde (cantidad y minutos), salidas anticipadas, ausencias y marcas incompletas.
3. En "Registros", marcar con color las llegadas tarde, salidas anticipadas y marcas faltantes, y sumar
   los días hábiles sin marcación como "Ausente".
4. Filtros: período, sucursal, empleado.

## Multi-marca y control de acceso (segunda parte)

El sistema se va a reutilizar en otros proyectos, así que **no puede quedar atado a Hikvision**.
Desde la fase 1 el diseño separa el núcleo de los equipos:

```
App (personal, horarios, reportes, accesos)
        │  usa sólo el modelo común
        ▼
Capa de dispositivos (interfaz común)
        │
        ├── Driver Hikvision (ISAPI)       ← fase 1
        ├── Driver ZKTeco / Dahua / ...    ← futuro
        └── Driver intercom / portero      ← futuro
```

Principios:

- **Interfaz común de driver**: alta/baja/edición de personas, carga de credenciales (cara,
  tarjeta, PIN, huella), lectura de eventos, hora, estado, abrir puerta, etc.
- **Capacidades declaradas por driver/equipo**: cada equipo informa qué soporta (`face`, `card`,
  `pin`, `fingerprint`, `door_control`, `intercom`, `realtime_events`...). La app muestra u oculta
  funciones según eso, en lugar de asumir un modelo.
- **Modelo de datos neutral**: personas, credenciales, eventos y puertas en formato propio;
  cada driver traduce desde/hacia el formato de su marca. Se guarda el evento crudo para auditoría.
- **Equipos como entidades configurables**: marca, modelo, IP, credenciales (cifradas), sucursal,
  puertas asociadas. Agregar un equipo no requiere tocar código si el driver ya existe.
- **Mismo canal para comandos**: la orden "abrir puerta X" pasa por la capa de dispositivos y queda
  registrada (quién, cuándo, desde dónde).

Funciones previstas para la segunda parte (fuera del alcance de la fase 1):

- Apertura remota de puertas desde la app.
- Permisos de acceso: quién entra por qué puerta y en qué horario.
- Porteros de edificios / video intercom: llamadas a la app, ver cámara y abrir desde el celular
  (evaluar SIP/WebRTC y notificaciones push en PWA de iOS).
- Visitas y credenciales temporales (QR / PIN de un solo uso).
- Multi-cliente / multi-sitio, para usar la misma plataforma con varios clientes.

## Riesgos y puntos a validar

- **Convivencia con HCAC**: si HCAC sigue gestionando los equipos, puede pisar o borrar personas
  dadas de alta por fuera. Definir si se desconectan los equipos de HCAC o se apaga HCAC.
- **Migración**: importar las personas (y fotos) que ya están cargadas en los equipos.
- **Requisitos de la foto facial** del DS-K1T321 (tamaño, resolución, encuadre) y versión de firmware.
- **Hora de los equipos**: mantenerla sincronizada para que las marcaciones sean confiables.
- Marcaciones dobles o faltantes (alguien que no marca la salida): definir reglas de interpretación.

## Pendientes de definir

- [x] Stack tecnológico: Node.js + TypeScript, Fastify, SQLite (Drizzle), React + Vite PWA, exceljs.
- [ ] Método de publicación HTTPS.
- [x] Ejemplo del Excel actual (anonimizado en `docs/ejemplos/`; el original queda en `docs/ejemplos/privado/`, que no se sube).
- [x] Firmware de los DS-K1T321: V3.9.2 build 240222.
- [ ] IPs de los equipos (no commitear credenciales).

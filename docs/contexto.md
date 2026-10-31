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
- Tomar como base el Excel que hoy entrega el integrador (pendiente: sumar un ejemplo anonimizado
  al repo en `docs/ejemplos/`).

## Riesgos y puntos a validar

- **Convivencia con HCAC**: si HCAC sigue gestionando los equipos, puede pisar o borrar personas
  dadas de alta por fuera. Definir si se desconectan los equipos de HCAC o se apaga HCAC.
- **Migración**: importar las personas (y fotos) que ya están cargadas en los equipos.
- **Requisitos de la foto facial** del DS-K1T321 (tamaño, resolución, encuadre) y versión de firmware.
- **Hora de los equipos**: mantenerla sincronizada para que las marcaciones sean confiables.
- Marcaciones dobles o faltantes (alguien que no marca la salida): definir reglas de interpretación.

## Pendientes de definir

- [ ] Stack tecnológico (backend, base de datos, frontend).
- [ ] Método de publicación HTTPS.
- [ ] Ejemplo del Excel actual.
- [ ] Firmware e IPs de los equipos (no commitear credenciales).

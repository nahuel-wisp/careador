/**
 * Modelo común, independiente de la marca del equipo.
 * Los drivers traducen desde/hacia el formato propio de cada fabricante.
 */

/** Funciones que un equipo puede soportar. La app muestra u oculta opciones según esto. */
export type Capability =
  | 'persons' // alta/baja/edición de personas
  | 'face' // credencial facial
  | 'card' // tarjeta de proximidad
  | 'pin' // código numérico
  | 'fingerprint' // huella
  | 'events' // lectura de historial de marcaciones
  | 'realtime_events' // envío de eventos en el momento
  | 'time_sync' // lectura/ajuste de hora
  | 'door_control' // apertura remota de puerta
  | 'intercom'; // portero / video intercom

export interface DeviceConnection {
  /** Host o IP, con puerto opcional: "192.168.1.50" o "192.168.1.50:8080". */
  host: string;
  username: string;
  password: string;
  /** Usar HTTPS para hablar con el equipo. */
  https?: boolean;
  /** Offset horario del equipo, ej. "-03:00". Necesario para consultas por fecha. */
  utcOffset?: string;
  /** Timeout por request en ms. */
  timeoutMs?: number;
}

export interface DeviceInfo {
  brand: string;
  model: string;
  serialNumber: string;
  firmware: string;
  macAddress?: string;
  name?: string;
}

export interface DevicePerson {
  /** Identificador de la persona en el equipo. Usamos el legajo/código propio del sistema. */
  id: string;
  name: string;
  enabled: boolean;
  validFrom?: Date;
  validTo?: Date;
  /** Cantidad de caras registradas (si el equipo lo informa). */
  faceCount?: number;
  /** Cantidad de tarjetas registradas (si el equipo lo informa). */
  cardCount?: number;
}

export type AccessEventKind =
  | 'access_granted' // la persona fue reconocida/autorizada (marcación válida)
  | 'access_denied' // intento fallido (cara no reconocida, fuera de horario, etc.)
  | 'door' // eventos de puerta (abierta, cerrada, forzada...)
  | 'device' // eventos del equipo (encendido, tamper, etc.)
  | 'other';

export type VerifyMode = 'face' | 'card' | 'pin' | 'fingerprint' | 'remote' | 'unknown';

export interface AccessEvent {
  /** Identificador único del evento dentro del equipo (para deduplicar). */
  deviceEventId: string;
  time: Date;
  kind: AccessEventKind;
  personId?: string;
  personName?: string;
  verifyMode: VerifyMode;
  doorNo?: number;
  /** Evento original del fabricante, para auditoría y depuración. */
  raw: unknown;
}

export interface EventQuery {
  from: Date;
  to: Date;
  /** Sólo marcaciones válidas (access_granted). Por defecto true. */
  onlyGranted?: boolean;
}

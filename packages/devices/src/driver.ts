import type {
  AccessEvent,
  Capability,
  DeviceConnection,
  DeviceInfo,
  DevicePerson,
  EventQuery,
} from './types';

/**
 * Interfaz que implementa cada marca. Los métodos opcionales sólo existen
 * si el driver declara la capacidad correspondiente.
 */
export interface DeviceDriver {
  readonly brand: string;

  /** Capacidades del equipo concreto (puede depender del modelo/firmware). */
  getCapabilities(): Promise<Capability[]>;
  getInfo(): Promise<DeviceInfo>;

  // --- Personas ---
  listPersons(): AsyncIterable<DevicePerson>;
  /** Crea la persona o la actualiza si ya existe. */
  upsertPerson(person: DevicePerson): Promise<void>;
  deletePerson(personId: string): Promise<void>;

  // --- Credenciales ---
  /** Carga o reemplaza la cara de la persona. `jpeg` ya debe venir en el formato que acepta el equipo. */
  setFace?(personId: string, jpeg: Uint8Array): Promise<void>;
  deleteFace?(personId: string): Promise<void>;
  /** Foto facial cargada en el equipo (JPEG), o null si no tiene. */
  getFace?(personId: string): Promise<Uint8Array | null>;

  // --- Eventos ---
  getEvents(query: EventQuery): AsyncIterable<AccessEvent>;

  // --- Hora ---
  getTime?(): Promise<Date>;
  setTime?(time: Date): Promise<void>;

  // --- Puertas (segunda parte) ---
  openDoor?(doorNo: number): Promise<void>;
}

export interface DriverOptions {
  /** Carpeta donde el driver puede guardar estado propio (lo usa el simulador). */
  dataDir?: string;
}

export interface DriverFactory {
  brand: string;
  /** Nombre legible para mostrar en la app. */
  label: string;
  /** Driver de prueba: sólo se ofrece si el entorno lo habilita. */
  simulated?: boolean;
  create(connection: DeviceConnection, options?: DriverOptions): DeviceDriver;
}

export class DeviceError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'unreachable'
      | 'unauthorized'
      | 'not_found'
      | 'invalid_request'
      | 'unsupported'
      | 'read_only'
      | 'device_error',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DeviceError';
  }
}

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DeviceError, type DeviceDriver, type DriverFactory, type DriverOptions } from '../driver';
import type {
  AccessEvent,
  Capability,
  DeviceConnection,
  DeviceInfo,
  DevicePerson,
  EventQuery,
} from '../types';

interface StoredPerson {
  id: string;
  name: string;
  enabled: boolean;
  validFrom?: string;
  validTo?: string;
  /** JPEG en base64. */
  face?: string;
}

interface StoredEvent {
  deviceEventId: string;
  time: string;
  kind: AccessEvent['kind'];
  personId?: string;
  personName?: string;
  verifyMode: AccessEvent['verifyMode'];
  doorNo?: number;
}

interface SimState {
  serial: string;
  seq: number;
  persons: Record<string, StoredPerson>;
  events: StoredEvent[];
  /** Diferencia entre la hora del equipo y la real, en ms (para probar desfasajes). */
  clockOffsetMs: number;
}

/** Máximo de eventos que guarda, como un equipo real con memoria limitada. */
const MAX_EVENTS = 50_000;

/**
 * Lector simulado: se comporta como un equipo real (personas, caras, marcaciones, hora, puerta)
 * pero guarda todo en un archivo JSON. Sirve para pruebas y demos sin hardware.
 * Las marcaciones se generan desde la pantalla web del simulador.
 */
export class SimulatedDriver implements DeviceDriver {
  readonly brand = 'simulador';
  private readonly file: string;

  constructor(
    private readonly conn: DeviceConnection,
    options: DriverOptions = {},
  ) {
    const dir = join(options.dataDir ?? '.', 'simulador');
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, `${conn.host.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  }

  private load(): SimState {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as SimState;
    } catch {
      return {
        serial: `SIM${Date.now().toString(36).toUpperCase()}`,
        seq: 0,
        persons: {},
        events: [],
        clockOffsetMs: 0,
      };
    }
  }

  private save(state: SimState) {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, this.file);
  }

  private checkAuth() {
    if (this.conn.password === 'incorrecta') {
      throw new DeviceError('Usuario o contraseña incorrectos', 'unauthorized');
    }
  }

  async getCapabilities(): Promise<Capability[]> {
    return ['persons', 'face', 'events', 'time_sync', 'door_control'];
  }

  async getInfo(): Promise<DeviceInfo> {
    this.checkAuth();
    const s = this.load();
    this.save(s);
    return { brand: this.brand, model: 'Lector simulado', serialNumber: s.serial, firmware: 'sim-1.0', name: this.conn.host };
  }

  async *listPersons(): AsyncIterable<DevicePerson> {
    this.checkAuth();
    for (const p of Object.values(this.load().persons)) yield toPerson(p);
  }

  async upsertPerson(person: DevicePerson): Promise<void> {
    this.checkAuth();
    const s = this.load();
    const prev = s.persons[person.id];
    s.persons[person.id] = {
      id: person.id,
      name: person.name,
      enabled: person.enabled,
      validFrom: person.validFrom?.toISOString(),
      validTo: person.validTo?.toISOString(),
      face: prev?.face,
    };
    this.save(s);
  }

  async deletePerson(personId: string): Promise<void> {
    this.checkAuth();
    const s = this.load();
    delete s.persons[personId];
    this.save(s);
  }

  async setFace(personId: string, jpeg: Uint8Array): Promise<void> {
    this.checkAuth();
    const s = this.load();
    const p = s.persons[personId];
    if (!p) throw new DeviceError(`La persona ${personId} no existe en el equipo`, 'not_found');
    p.face = Buffer.from(jpeg).toString('base64');
    this.save(s);
  }

  async deleteFace(personId: string): Promise<void> {
    this.checkAuth();
    const s = this.load();
    if (s.persons[personId]) delete s.persons[personId].face;
    this.save(s);
  }

  async *getEvents(query: EventQuery): AsyncIterable<AccessEvent> {
    this.checkAuth();
    const onlyGranted = query.onlyGranted ?? true;
    const from = query.from.getTime();
    const to = query.to.getTime();
    for (const e of this.load().events) {
      const t = Date.parse(e.time);
      if (t < from || t > to) continue;
      if (onlyGranted && e.kind !== 'access_granted') continue;
      yield { ...e, time: new Date(t), raw: e };
    }
  }

  async getTime(): Promise<Date> {
    return new Date(Date.now() + this.load().clockOffsetMs);
  }

  async setTime(time: Date): Promise<void> {
    const s = this.load();
    s.clockOffsetMs = time.getTime() - Date.now();
    this.save(s);
  }

  async openDoor(doorNo: number): Promise<void> {
    this.addEvent({ kind: 'door', verifyMode: 'remote', doorNo });
  }

  // ------------------------------------------------- Funciones del simulador

  /** Simula que alguien se para frente al lector. Sin personId = cara desconocida. */
  simulateFace(personId?: string, at?: Date): AccessEvent {
    const s = this.load();
    const p = personId ? s.persons[personId] : undefined;
    const now = at ?? new Date(Date.now() + s.clockOffsetMs);
    const valid =
      !!p &&
      p.enabled &&
      !!p.face &&
      (!p.validFrom || Date.parse(p.validFrom) <= now.getTime()) &&
      (!p.validTo || Date.parse(p.validTo) >= now.getTime());
    return this.addEvent(
      valid
        ? { kind: 'access_granted', verifyMode: 'face', personId: p.id, personName: p.name, doorNo: 1, time: now }
        : { kind: 'access_denied', verifyMode: 'face', personId: p?.id, personName: p?.name, doorNo: 1, time: now },
    );
  }

  /** Estado completo para la pantalla del simulador (sin las fotos). */
  snapshot() {
    const s = this.load();
    return {
      serial: s.serial,
      clock: new Date(Date.now() + s.clockOffsetMs),
      persons: Object.values(s.persons).map((p) => ({ ...toPerson(p), hasFace: !!p.face })),
      recentEvents: s.events.slice(-50).reverse(),
    };
  }

  async getFace(personId: string): Promise<Buffer | null> {
    const face = this.load().persons[personId]?.face;
    return face ? Buffer.from(face, 'base64') : null;
  }

  private addEvent(e: Omit<StoredEvent, 'deviceEventId' | 'time'> & { time?: Date }): AccessEvent {
    const s = this.load();
    s.seq += 1;
    const stored: StoredEvent = {
      ...e,
      deviceEventId: `sim:${s.seq}`,
      time: (e.time ?? new Date(Date.now() + s.clockOffsetMs)).toISOString(),
    };
    s.events.push(stored);
    if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
    this.save(s);
    return { ...stored, time: new Date(stored.time), raw: stored };
  }
}

function toPerson(p: StoredPerson): DevicePerson {
  return {
    id: p.id,
    name: p.name,
    enabled: p.enabled,
    validFrom: p.validFrom ? new Date(p.validFrom) : undefined,
    validTo: p.validTo ? new Date(p.validTo) : undefined,
    faceCount: p.face ? 1 : 0,
  };
}

export const simulatorFactory: DriverFactory = {
  brand: 'simulador',
  label: 'Lector simulado (pruebas)',
  simulated: true,
  create: (conn, options) => new SimulatedDriver(conn, options),
};

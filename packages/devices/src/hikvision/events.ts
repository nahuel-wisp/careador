import type { AccessEvent, AccessEventKind, VerifyMode } from '../types';
import { fromDevice } from './time';

/**
 * Códigos de evento ISAPI (AcsEvent). major 5 = eventos de control de acceso.
 * Los minor más comunes en terminales faciales. A validar contra el DS-K1T321 real.
 */
export const MAJOR = { ALARM: 1, EXCEPTION: 2, OPERATION: 3, EVENT: 5 } as const;

const GRANTED_MINORS: Record<number, VerifyMode> = {
  0x01: 'card', // tarjeta válida
  0x26: 'fingerprint', // huella válida
  0x4b: 'face', // cara reconocida
};

const DENIED_MINORS = new Set<number>([
  0x09, // tarjeta inexistente
  0x27, // huella no coincide
  0x4c, // cara no reconocida
  0x08, // fuera de horario
  0x06, // tarjeta vencida
]);

const DOOR_MINORS = new Set<number>([0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c]);

const VERIFY_MODE_BY_NAME: Record<string, VerifyMode> = {
  face: 'face',
  card: 'card',
  fp: 'fingerprint',
  fingerprint: 'fingerprint',
  password: 'pin',
};

export interface IsapiAcsEventInfo {
  major: number;
  minor: number;
  time: string;
  employeeNoString?: string;
  name?: string;
  doorNo?: number;
  serialNo?: number;
  currentVerifyMode?: string;
  [key: string]: unknown;
}

export function classifyEvent(major: number, minor: number): AccessEventKind {
  if (major === MAJOR.EVENT) {
    if (minor in GRANTED_MINORS) return 'access_granted';
    if (DENIED_MINORS.has(minor)) return 'access_denied';
    if (DOOR_MINORS.has(minor)) return 'door';
    return 'other';
  }
  if (major === MAJOR.ALARM || major === MAJOR.EXCEPTION || major === MAJOR.OPERATION) {
    return 'device';
  }
  return 'other';
}

export function normalizeEvent(info: IsapiAcsEventInfo, utcOffset: string): AccessEvent {
  const kind = classifyEvent(info.major, info.minor);
  const verifyMode: VerifyMode =
    (info.currentVerifyMode && matchVerifyMode(info.currentVerifyMode)) ||
    (kind === 'access_granted' ? GRANTED_MINORS[info.minor] : undefined) ||
    'unknown';
  const personId = info.employeeNoString?.trim() || undefined;

  return {
    deviceEventId:
      info.serialNo !== undefined
        ? `sn:${info.serialNo}`
        : `t:${info.time}|${info.major}|${info.minor}|${personId ?? ''}`,
    time: fromDevice(info.time, utcOffset),
    kind,
    personId,
    personName: info.name || undefined,
    verifyMode,
    doorNo: info.doorNo,
    raw: info,
  };
}

function matchVerifyMode(mode: string): VerifyMode | undefined {
  const lower = mode.toLowerCase();
  if (lower.includes('face')) return 'face';
  if (lower.includes('fp') || lower.includes('finger')) return 'fingerprint';
  if (lower.includes('card')) return 'card';
  return VERIFY_MODE_BY_NAME[lower];
}

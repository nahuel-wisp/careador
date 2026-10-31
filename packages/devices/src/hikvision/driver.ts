import { randomUUID } from 'node:crypto';
import { DeviceError, type DeviceDriver, type DriverFactory } from '../driver';
import type {
  AccessEvent,
  Capability,
  DeviceConnection,
  DeviceInfo,
  DevicePerson,
  EventQuery,
} from '../types';
import { MAJOR, normalizeEvent, type IsapiAcsEventInfo } from './events';
import { IsapiClient } from './isapi-client';
import { fromDevice, toDeviceLocal, toDeviceLocalWithOffset } from './time';

/** Biblioteca facial por defecto en terminales de control de acceso. */
const FACE_LIB = { FDID: '1', faceLibType: 'blackFD' } as const;
const PAGE_SIZE = 30;
const DEFAULT_VALID_FROM = '2000-01-01T00:00:00';
const DEFAULT_VALID_TO = '2037-12-31T23:59:59';

interface IsapiUserInfo {
  employeeNo: string;
  name: string;
  userType?: string;
  Valid?: { enable: boolean; beginTime: string; endTime: string; timeType?: string };
  numOfFace?: number;
  numOfCard?: number;
}

interface SearchPage<T> {
  responseStatusStrg: 'OK' | 'MORE' | 'NO MATCH';
  numOfMatches: number;
  totalMatches: number;
  items: T[];
}

/**
 * Driver para terminales de control de acceso Hikvision (MinMoe: DS-K1T321, DS-K1T341, etc.) vía ISAPI.
 * Endpoints según ISAPI Access Control. A validar contra el firmware V3.9.2 del cliente.
 */
export class HikvisionDriver implements DeviceDriver {
  readonly brand = 'hikvision';
  private readonly client: IsapiClient;
  private readonly offset: string;

  constructor(conn: DeviceConnection) {
    this.client = new IsapiClient(conn);
    this.offset = conn.utcOffset ?? '-03:00';
  }

  async getCapabilities(): Promise<Capability[]> {
    // Base de cualquier terminal MinMoe. TODO: refinar leyendo /ISAPI/AccessControl/capabilities.
    return ['persons', 'face', 'card', 'events', 'time_sync', 'door_control'];
  }

  async getInfo(): Promise<DeviceInfo> {
    const data = await this.client.xml<{ DeviceInfo: Record<string, string> }>({
      method: 'GET',
      path: '/ISAPI/System/deviceInfo',
    });
    const d = data.DeviceInfo ?? {};
    return {
      brand: this.brand,
      model: d.model ?? '',
      serialNumber: d.serialNumber ?? '',
      firmware: [d.firmwareVersion, d.firmwareReleasedDate].filter(Boolean).join(' '),
      macAddress: d.macAddress,
      name: d.deviceName,
    };
  }

  // ---------------------------------------------------------------- Personas

  async *listPersons(): AsyncIterable<DevicePerson> {
    const searchID = randomUUID();
    let position = 0;
    for (;;) {
      const res = await this.client.json<{
        UserInfoSearch: Omit<SearchPage<never>, 'items'> & { UserInfo?: IsapiUserInfo[] };
      }>({
        method: 'POST',
        path: '/ISAPI/AccessControl/UserInfo/Search?format=json',
        json: {
          UserInfoSearchCond: { searchID, searchResultPosition: position, maxResults: PAGE_SIZE },
        },
      });
      const page = res.UserInfoSearch;
      for (const u of page.UserInfo ?? []) yield this.fromUserInfo(u);
      if (page.responseStatusStrg !== 'MORE' || !page.numOfMatches) break;
      position += page.numOfMatches;
    }
  }

  async upsertPerson(person: DevicePerson): Promise<void> {
    const body = { UserInfo: this.toUserInfo(person) };
    try {
      // SetUp crea o actualiza en una sola llamada (firmware reciente).
      await this.client.json({
        method: 'PUT',
        path: '/ISAPI/AccessControl/UserInfo/SetUp?format=json',
        json: body,
      });
    } catch (err) {
      if (!(err instanceof DeviceError) || err.code !== 'unsupported') throw err;
      const exists = await this.personExists(person.id);
      await this.client.json({
        method: exists ? 'PUT' : 'POST',
        path: exists
          ? '/ISAPI/AccessControl/UserInfo/Modify?format=json'
          : '/ISAPI/AccessControl/UserInfo/Record?format=json',
        json: body,
      });
    }
  }

  async deletePerson(personId: string): Promise<void> {
    await this.client.json({
      method: 'PUT',
      path: '/ISAPI/AccessControl/UserInfo/Delete?format=json',
      json: { UserInfoDelCond: { EmployeeNoList: [{ employeeNo: personId }] } },
    });
  }

  private async personExists(personId: string): Promise<boolean> {
    const res = await this.client.json<{ UserInfoSearch: { numOfMatches?: number } }>({
      method: 'POST',
      path: '/ISAPI/AccessControl/UserInfo/Search?format=json',
      json: {
        UserInfoSearchCond: {
          searchID: randomUUID(),
          searchResultPosition: 0,
          maxResults: 1,
          EmployeeNoList: [{ employeeNo: personId }],
        },
      },
    });
    return (res.UserInfoSearch.numOfMatches ?? 0) > 0;
  }

  // ------------------------------------------------------------------- Caras

  async setFace(personId: string, jpeg: Uint8Array): Promise<void> {
    const form = () => {
      const f = new FormData();
      f.append('FaceDataRecord', JSON.stringify({ ...FACE_LIB, FPID: personId }));
      f.append('img', new Blob([new Uint8Array(jpeg)], { type: 'image/jpeg' }), 'face.jpg');
      return f;
    };
    try {
      // FDSetUp crea o reemplaza la cara.
      await this.client.json({
        method: 'PUT',
        path: '/ISAPI/Intelligent/FDLib/FDSetUp?format=json',
        form: form(),
      });
    } catch (err) {
      if (!(err instanceof DeviceError) || err.code !== 'unsupported') throw err;
      await this.client.json({
        method: 'POST',
        path: '/ISAPI/Intelligent/FDLib/FaceDataRecord?format=json',
        form: form(),
      });
    }
  }

  async deleteFace(personId: string): Promise<void> {
    const q = `FDID=${FACE_LIB.FDID}&faceLibType=${FACE_LIB.faceLibType}`;
    await this.client.json({
      method: 'PUT',
      path: `/ISAPI/Intelligent/FDLib/FDSearch/Delete?format=json&${q}`,
      json: { FPID: [{ value: personId }] },
    });
  }

  // ----------------------------------------------------------------- Eventos

  async *getEvents(query: EventQuery): AsyncIterable<AccessEvent> {
    const onlyGranted = query.onlyGranted ?? true;
    const searchID = randomUUID();
    let position = 0;
    for (;;) {
      const res = await this.client.json<{
        AcsEvent: Omit<SearchPage<never>, 'items'> & { InfoList?: IsapiAcsEventInfo[] };
      }>({
        method: 'POST',
        path: '/ISAPI/AccessControl/AcsEvent?format=json',
        json: {
          AcsEventCond: {
            searchID,
            searchResultPosition: position,
            maxResults: PAGE_SIZE,
            major: onlyGranted ? MAJOR.EVENT : 0,
            minor: 0,
            startTime: toDeviceLocalWithOffset(query.from, this.offset),
            endTime: toDeviceLocalWithOffset(query.to, this.offset),
          },
        },
      });
      const page = res.AcsEvent;
      for (const info of page.InfoList ?? []) {
        const ev = normalizeEvent(info, this.offset);
        if (!onlyGranted || ev.kind === 'access_granted') yield ev;
      }
      if (page.responseStatusStrg !== 'MORE' || !page.numOfMatches) break;
      position += page.numOfMatches;
    }
  }

  // -------------------------------------------------------------------- Hora

  async getTime(): Promise<Date> {
    const data = await this.client.xml<{ Time: { localTime: string } }>({
      method: 'GET',
      path: '/ISAPI/System/time',
    });
    return fromDevice(data.Time.localTime, this.offset);
  }

  async setTime(time: Date): Promise<void> {
    await this.client.xml({
      method: 'PUT',
      path: '/ISAPI/System/time',
      xml:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<Time><timeMode>manual</timeMode>' +
        `<localTime>${toDeviceLocal(time, this.offset)}</localTime></Time>`,
    });
  }

  // ----------------------------------------------------------------- Puertas

  async openDoor(doorNo: number): Promise<void> {
    await this.client.xml({
      method: 'PUT',
      path: `/ISAPI/AccessControl/RemoteControl/door/${doorNo}`,
      xml:
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>',
    });
  }

  // ------------------------------------------------------------- Conversión

  private toUserInfo(p: DevicePerson): IsapiUserInfo & Record<string, unknown> {
    return {
      employeeNo: p.id,
      name: p.name,
      userType: 'normal',
      Valid: {
        enable: p.enabled,
        beginTime: p.validFrom ? toDeviceLocal(p.validFrom, this.offset) : DEFAULT_VALID_FROM,
        endTime: p.validTo ? toDeviceLocal(p.validTo, this.offset) : DEFAULT_VALID_TO,
        timeType: 'local',
      },
      doorRight: '1',
      RightPlan: [{ doorNo: 1, planTemplateNo: '1' }],
    };
  }

  private fromUserInfo(u: IsapiUserInfo): DevicePerson {
    return {
      id: u.employeeNo,
      name: u.name,
      enabled: u.Valid?.enable ?? true,
      validFrom: u.Valid?.beginTime ? fromDevice(u.Valid.beginTime, this.offset) : undefined,
      validTo: u.Valid?.endTime ? fromDevice(u.Valid.endTime, this.offset) : undefined,
      faceCount: u.numOfFace,
      cardCount: u.numOfCard,
    };
  }
}

export const hikvisionFactory: DriverFactory = {
  brand: 'hikvision',
  label: 'Hikvision (ISAPI)',
  create: (conn) => new HikvisionDriver(conn),
};

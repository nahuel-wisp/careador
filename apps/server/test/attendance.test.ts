import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

/** Hora local de ayer (u otro día) como ISO: siempre en el pasado, para que el equipo ya la tenga. */
const at = (h: number, m = 0, dayOffset = -1) => {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

describe('marcaciones y asistencia del día', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let simId: number;
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: t.headers, payload });

  beforeAll(async () => {
    t = await testApp({ SIMULATOR_ENABLED: 'true' });
    const siteId = (await inject('POST', '/api/sites', { name: 'Arsa 2' })).json().id;
    simId = (
      await inject('POST', '/api/devices', { siteId, name: 'Lector', brand: 'simulador', host: 'att-1', username: 'x', password: 'x' })
    ).json().id;
    for (const [firstName, lastName] of [['Ana', 'Gómez'], ['Beto', 'Ruiz'], ['Caro', 'Díaz']]) {
      const e = (await inject('POST', '/api/employees', { firstName, lastName, siteId })).json();
      await t.app.inject({ method: 'PUT', url: `/api/employees/${e.id}/face`, headers: { ...t.headers, 'content-type': 'image/jpeg' }, payload: JPEG });
    }
    await inject('POST', '/api/sync');
    // Ayer: Ana entrada, almuerzo ida y vuelta, salida. Beto sólo entrada. Caro vino anteayer.
    for (const time of [at(8, 55), at(13, 0), at(14, 0), at(18, 5)]) {
      await inject('POST', `/api/simulador/${simId}/marcar`, { personId: '1', at: time });
    }
    await inject('POST', `/api/simulador/${simId}/marcar`, { personId: '2', at: at(9, 12) });
    await inject('POST', `/api/simulador/${simId}/marcar`, { personId: '3', at: at(9, 0, -2) });
    // Cara desconocida: no cuenta.
    await inject('POST', `/api/simulador/${simId}/marcar`, { at: at(10, 0) });
  });

  afterAll(() => t.close());

  it('trae las marcaciones del equipo sin duplicar', async () => {
    expect(await (await inject('POST', '/api/events/sync')).json()).toMatchObject({ inserted: 6, errors: 0 });
    expect(await (await inject('POST', '/api/events/sync')).json()).toMatchObject({ inserted: 0 });
  });

  it('arma entrada (primera) y salida (última) por empleado y día', async () => {
    const day = (offset: number) => new Date(at(12, 0, offset)).toLocaleDateString('sv');
    const res = (await inject('GET', `/api/attendance?date=${day(-1)}`)).json();
    const by = (code: string) => res.employees.find((e: { code: string }) => e.code === code);
    expect(by('1')).toMatchObject({ marks: 4, in: { time: at(8, 55), device: 'Lector' }, out: { time: at(18, 5) } });
    expect(by('2')).toMatchObject({ marks: 1, in: { time: at(9, 12) }, out: null });
    expect(by('3')).toMatchObject({ marks: 0, in: null, out: null });
    expect(res.syncedUntil).not.toBeNull();

    const resAntes = (await inject('GET', `/api/attendance?date=${day(-2)}`)).json();
    expect(resAntes.employees.find((e: { code: string }) => e.code === '3')).toMatchObject({ marks: 1 });
  });
});

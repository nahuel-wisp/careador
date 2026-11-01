import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

// JPEG mínimo de 1x1 (el simulador no decodifica la imagen).
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

describe('personal y sincronización a los equipos', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let siteId: number;
  let simA: number;
  let simB: number;

  const inject = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: t.headers, payload });
  const sim = async (id: number) => (await inject('GET', `/api/simulador/${id}`)).json();
  const sync = async () => (await inject('POST', '/api/sync')).json();

  beforeAll(async () => {
    t = await testApp({ SIMULATOR_ENABLED: 'true' });
    siteId = (await inject('POST', '/api/sites', { name: 'Arsa 1' })).json().id;
    const dev = { siteId, brand: 'simulador', username: 'x', password: 'x' };
    simA = (await inject('POST', '/api/devices', { ...dev, name: 'A', host: 'emp-a' })).json().id;
    simB = (await inject('POST', '/api/devices', { ...dev, name: 'B', host: 'emp-b' })).json().id;
  });

  afterAll(() => t.close());

  it('da de alta con legajo automático y lo carga en todos los equipos, con la foto', async () => {
    const ana = (await inject('POST', '/api/employees', { firstName: 'Ana', lastName: 'Gómez', siteId })).json();
    expect(ana.code).toBe('1');
    const face = await t.app.inject({
      method: 'PUT',
      url: `/api/employees/${ana.id}/face`,
      headers: { ...t.headers, 'content-type': 'image/jpeg' },
      payload: JPEG,
    });
    expect(face.json().hasFace).toBe(true);

    expect(await sync()).toMatchObject({ errors: 0 });
    for (const id of [simA, simB]) {
      expect((await sim(id)).persons).toEqual([expect.objectContaining({ id: '1', name: 'Gómez Ana', hasFace: true })]);
    }
    const [emp] = (await inject('GET', '/api/employees')).json();
    expect(emp.devices).toHaveLength(2);
    expect(emp.devices.every((d: { status: string; faceSynced: boolean }) => d.status === 'synced' && d.faceSynced)).toBe(true);

    const marca = (await inject('POST', `/api/simulador/${simA}/marcar`, { personId: '1' })).json();
    expect(marca.kind).toBe('access_granted');
  });

  it('rechaza legajos repetidos y fotos que no son JPEG', async () => {
    expect((await inject('POST', '/api/employees', { code: '1', firstName: 'X', lastName: 'Y' })).statusCode).toBe(409);
    const bad = await t.app.inject({
      method: 'PUT',
      url: '/api/employees/1/face',
      headers: { ...t.headers, 'content-type': 'image/jpeg' },
      payload: Buffer.from('no es jpeg'),
    });
    expect(bad.statusCode).toBe(400);
  });

  it('la baja lo borra de los equipos y la re-alta lo vuelve a cargar', async () => {
    await inject('PATCH', '/api/employees/1', { active: false });
    await sync();
    expect((await sim(simA)).persons).toEqual([]);
    expect((await sim(simB)).persons).toEqual([]);
    expect((await inject('GET', '/api/employees')).json()[0].devices).toEqual([]);

    await inject('PATCH', '/api/employees/1', { active: true });
    await sync();
    expect((await sim(simB)).persons).toEqual([expect.objectContaining({ id: '1', hasFace: true })]);
  });

  it('importa las personas que ya estaban en un equipo', async () => {
    await inject('POST', `/api/simulador/${simB}/personas`, { id: '500', name: 'Pérez Juan Carlos' });
    await t.app.inject({
      method: 'PUT',
      url: `/api/simulador/${simB}/cara/500`,
      headers: { ...t.headers, 'content-type': 'image/jpeg' },
      payload: JPEG,
    });
    const res = (await inject('POST', `/api/devices/${simB}/import-persons`)).json();
    expect(res).toEqual({ created: 1, existing: 1, faces: 1, facesFailed: 0 });
    await sync();
    const juan = (await inject('GET', '/api/employees')).json().find((e: { code: string }) => e.code === '500');
    expect(juan).toMatchObject({ lastName: 'Pérez', firstName: 'Juan Carlos', siteId, hasFace: true });
    // Y se lo lleva al otro equipo, con la foto.
    expect((await sim(simA)).persons.find((p: { id: string }) => p.id === '500')).toMatchObject({ hasFace: true });
  });

  it('un equipo caído deja el error guardado para reintentar', async () => {
    const caido = (
      await inject('POST', '/api/devices', { siteId, brand: 'simulador', name: 'C', host: 'emp-c', username: 'x', password: 'incorrecta' })
    ).json().id;
    expect((await sync()).errors).toBeGreaterThan(0);
    const emp = (await inject('GET', '/api/employees')).json()[0];
    expect(emp.devices.find((d: { deviceId: number }) => d.deviceId === caido)).toMatchObject({ status: 'error' });
  });
});

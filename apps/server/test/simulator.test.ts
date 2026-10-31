import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

// JPEG mínimo de 1x1 (válido para el simulador, que no decodifica la imagen).
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

describe('simulador y sólo lectura (entorno de pruebas)', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let simId: number;
  let hikId: number;

  beforeAll(async () => {
    t = await testApp({ CAREADOR_ENTORNO: 'pruebas', SIMULATOR_ENABLED: 'true', DEVICES_READ_ONLY: 'true' });
    const site = (await t.app.inject({ method: 'POST', url: '/api/sites', headers: t.headers, payload: { name: 'Sucursal 1' } })).json();
    const base = { siteId: site.id, username: 'admin', password: 'clave' };
    simId = (
      await t.app.inject({ method: 'POST', url: '/api/devices', headers: t.headers, payload: { ...base, name: 'Sim', brand: 'simulador', host: 'sim-1' } })
    ).json().id;
    hikId = (
      await t.app.inject({ method: 'POST', url: '/api/devices', headers: t.headers, payload: { ...base, name: 'Real', brand: 'hikvision', host: '127.0.0.1:9' } })
    ).json().id;
  });

  afterAll(() => t.close());

  it('informa el entorno y ofrece el simulador', async () => {
    const env = (await t.app.inject({ url: '/api/entorno', headers: t.headers })).json();
    expect(env).toMatchObject({ nombre: 'pruebas', equiposSoloLectura: true, simulador: true });
    expect(env.drivers.map((d: { brand: string }) => d.brand)).toContain('simulador');
  });

  it('fuerza sólo lectura en equipos reales pero no en el simulador', async () => {
    const list = (await t.app.inject({ url: '/api/devices', headers: t.headers })).json();
    expect(list.find((d: { id: number }) => d.id === hikId).effectiveReadOnly).toBe(true);
    expect(list.find((d: { id: number }) => d.id === simId).effectiveReadOnly).toBe(false);
  });

  it('el simulador responde la prueba de conexión', async () => {
    const res = await t.app.inject({ method: 'POST', url: `/api/devices/${simId}/test`, headers: t.headers, payload: {} });
    expect(res.json()).toMatchObject({ ok: true, info: { model: 'Lector simulado' } });
  });

  it('reconoce sólo a personas con cara cargada', async () => {
    const url = `/api/simulador/${simId}`;
    await t.app.inject({ method: 'POST', url: `${url}/personas`, headers: t.headers, payload: { id: '7', name: 'Ana Gómez' } });

    const sinCara = (await t.app.inject({ method: 'POST', url: `${url}/marcar`, headers: t.headers, payload: { personId: '7' } })).json();
    expect(sinCara.kind).toBe('access_denied');

    const put = await t.app.inject({
      method: 'PUT',
      url: `${url}/cara/7`,
      headers: { ...t.headers, 'content-type': 'image/jpeg' },
      payload: JPEG,
    });
    expect(put.statusCode).toBe(200);

    const ok = (await t.app.inject({ method: 'POST', url: `${url}/marcar`, headers: t.headers, payload: { personId: '7' } })).json();
    expect(ok).toMatchObject({ kind: 'access_granted', personId: '7', verifyMode: 'face' });

    const desconocida = (await t.app.inject({ method: 'POST', url: `${url}/marcar`, headers: t.headers, payload: {} })).json();
    expect(desconocida.kind).toBe('access_denied');

    const snap = (await t.app.inject({ url, headers: t.headers })).json();
    expect(snap.persons).toEqual([expect.objectContaining({ id: '7', hasFace: true })]);
    expect(snap.recentEvents).toHaveLength(3);
    expect((await t.app.inject({ url: `${url}/cara/7`, headers: t.headers })).headers['content-type']).toBe('image/jpeg');
  });

  it('no expone el simulador en producción', async () => {
    const prod = await (await import('./helpers')).testApp();
    const env = (await prod.app.inject({ url: '/api/entorno', headers: prod.headers })).json();
    expect(env.drivers.map((d: { brand: string }) => d.brand)).not.toContain('simulador');
    expect((await prod.app.inject({ url: '/api/simulador/1', headers: prod.headers })).statusCode).toBe(404);
    await prod.close();
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers';

describe('usuarios, roles y contraseña provisoria', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  const admin = (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: t.headers, payload });
  const as = (cookie: string) => (method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: { cookie }, payload });
  const login = async (username: string, password: string) => {
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } });
    const c = res.cookies.find((x) => x.name === 'careador_sesion');
    return { res, cookie: c ? `careador_sesion=${c.value}` : '' };
  };
  let ana: { id: number };

  beforeAll(async () => {
    t = await testApp();
  });
  afterAll(() => t.close());

  it('el admin crea un operador con contraseña provisoria, que la tiene que cambiar al entrar', async () => {
    const res = await admin('POST', '/api/users', { username: 'Ana', name: 'Ana', role: 'manager', password: 'provisoria-123' });
    expect(res.statusCode).toBe(201);
    ana = res.json();
    expect(ana).toMatchObject({ username: 'ana', role: 'manager', mustChangePassword: true });
    expect(JSON.stringify((await admin('GET', '/api/users')).json())).not.toMatch(/passwordHash|scrypt/);
    expect((await admin('POST', '/api/users', { username: 'ana', name: 'X', role: 'manager', password: 'otra-clave-123' })).statusCode).toBe(409);

    const { res: l, cookie } = await login('ana', 'provisoria-123');
    expect(l.json()).toMatchObject({ name: 'Ana', mustChangePassword: true });
    const ana$ = as(cookie);
    // Hasta cambiarla, nada más.
    expect((await ana$('GET', '/api/employees')).json()).toMatchObject({ code: 'must_change_password' });
    expect((await ana$('GET', '/api/auth/me')).statusCode).toBe(200);
    expect((await ana$('POST', '/api/auth/password', { current: 'mal', next: 'nueva-clave-456' })).statusCode).toBe(400);
    expect((await ana$('POST', '/api/auth/password', { current: 'provisoria-123', next: 'corta' })).statusCode).toBe(400);
    const ok = await ana$('POST', '/api/auth/password', { current: 'provisoria-123', next: 'nueva-clave-456' });
    expect(ok.json()).toMatchObject({ mustChangePassword: false });
    expect((await ana$('GET', '/api/employees')).statusCode).toBe(200);
  });

  it('un operador usa personal, asistencia y reportes, pero no equipos ni usuarios', async () => {
    const ana$ = as((await login('ana', 'nueva-clave-456')).cookie);
    expect((await ana$('GET', '/api/devices')).statusCode).toBe(200); // ver sí (Personal muestra a qué equipo llegó)
    expect((await ana$('POST', '/api/devices', { siteId: 1, name: 'x', brand: 'simulador', host: 'x', username: 'x', password: 'x' })).statusCode).toBe(403);
    expect((await ana$('PATCH', '/api/devices/1', { readOnly: false })).statusCode).toBe(403);
    expect((await ana$('GET', '/api/users')).statusCode).toBe(403);
    expect((await ana$('POST', '/api/sites', { name: 'Otra' })).statusCode).toBe(403);
    expect((await ana$('POST', '/api/history/hikcentral')).statusCode).toBe(403);
    expect((await ana$('GET', '/api/reports?from=2026-10-01&to=2026-10-02')).statusCode).toBe(200);
    expect((await ana$('POST', '/api/absences', { employeeId: null, kind: 'feriado', dateFrom: '2026-11-20', dateTo: '2026-11-20' })).statusCode).toBe(201);
  });

  it('desactivar cierra sus sesiones; resetear deja otra provisoria; uno no se puede desactivar a sí mismo', async () => {
    const { cookie } = await login('ana', 'nueva-clave-456');
    expect((await admin('PATCH', `/api/users/${ana.id}`, { active: false })).json()).toMatchObject({ active: false });
    expect((await as(cookie)('GET', '/api/employees')).statusCode).toBe(401);
    expect((await login('ana', 'nueva-clave-456')).res.statusCode).toBe(401);

    await admin('PATCH', `/api/users/${ana.id}`, { active: true });
    expect((await admin('POST', `/api/users/${ana.id}/password`, { password: 'otra-provisoria-1' })).statusCode).toBe(200);
    expect((await login('ana', 'otra-provisoria-1')).res.json()).toMatchObject({ mustChangePassword: true });

    const me = (await admin('GET', '/api/auth/me')).json();
    expect((await admin('PATCH', `/api/users/${me.id}`, { active: false })).statusCode).toBe(400);
    expect((await admin('PATCH', `/api/users/${me.id}`, { role: 'manager' })).statusCode).toBe(400);

    const hist = (await admin('GET', '/api/audit')).json().map((h: { summary: string }) => h.summary);
    expect(hist).toEqual(
      expect.arrayContaining([
        'Creó el usuario Ana: «ana», operador',
        'Ana cambió su contraseña',
        'Usuario Ana: lo desactivó',
        'Le puso una contraseña provisoria a Ana',
      ]),
    );
  });
});

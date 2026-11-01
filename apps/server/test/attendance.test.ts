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

  it('contra el horario y las novedades: tarde, sin salida, ausente y justificado con certificado', async () => {
    const day = (offset: number) => new Date(at(12, 0, offset)).toLocaleDateString('sv');
    const nueveASeis = Array(7).fill({ start: '09:00', end: '18:00' });
    const ochoASeis = Array(7).fill({ start: '08:00', end: '18:00' });
    const sucursal = (await inject('POST', '/api/schedules', { name: 'Arsa 2', days: nueveASeis })).json();
    const temprano = (await inject('POST', '/api/schedules', { name: 'Temprano', days: ochoASeis })).json();
    const site = (await inject('GET', '/api/sites')).json()[0];
    await inject('PUT', `/api/sites/${site.id}/schedule`, { scheduleId: sucursal.id });
    const people = (await inject('GET', '/api/employees')).json();
    const id = (code: string) => people.find((e: { code: string }) => e.code === code).id;
    // Ana es de otra sucursal (que entra a las 8) pero ayer marcó acá: se la mide con el horario de acá.
    const otra = (await inject('POST', '/api/sites', { name: 'Arsa 1' })).json();
    await inject('PUT', `/api/sites/${otra.id}/schedule`, { scheduleId: temprano.id });
    await t.app.inject({ method: 'PATCH', url: `/api/employees/${id('1')}`, headers: t.headers, payload: { siteId: otra.id } });
    // Beto entra a las 8 desde anteayer: ayer llegó 9:12 → 72 min tarde.
    await inject('PUT', `/api/employees/${id('2')}/schedule`, { scheduleId: temprano.id, from: day(-2) });

    const get = async () => {
      const res = (await inject('GET', `/api/attendance?date=${day(-1)}`)).json();
      return (code: string) => res.employees.find((e: { code: string }) => e.code === code);
    };
    let by = await get();
    expect(by('1')).toMatchObject({ status: 'presente', lateMin: 0, earlyMin: 0, schedule: { name: 'Arsa 2' }, workedMin: 550, workedSiteId: site.id });
    expect(by('2')).toMatchObject({ status: 'presente', lateMin: 72, missingOut: true, schedule: { name: 'Temprano' } });
    expect(by('3')).toMatchObject({ status: 'ausente' });

    // Caro estuvo enferma: se carga la novedad con el certificado.
    const nov = (
      await inject('POST', '/api/absences', { employeeId: id('3'), kind: 'enfermedad', dateFrom: day(-1), dateTo: day(-1), note: 'gripe' })
    ).json();
    const PDF = Buffer.from('%PDF-1.4 certificado');
    const file = await t.app.inject({
      method: 'POST',
      url: `/api/absences/${nov.id}/files?name=certificado.pdf`,
      headers: { ...t.headers, 'content-type': 'application/pdf' },
      payload: PDF,
    });
    expect(file.statusCode).toBe(201);
    const back = await t.app.inject({ method: 'GET', url: `/api/absence-files/${file.json().id}`, headers: t.headers });
    expect(back.headers['content-type']).toBe('application/pdf');
    expect(back.rawPayload.equals(PDF)).toBe(true);
    const html = await t.app.inject({
      method: 'POST',
      url: `/api/absences/${nov.id}/files`,
      headers: { ...t.headers, 'content-type': 'text/html' },
      payload: '<script>',
    });
    expect(html.statusCode).toBeGreaterThanOrEqual(400);

    by = await get();
    expect(by('3')).toMatchObject({ status: 'novedad', absences: [{ kind: 'enfermedad', note: 'gripe' }] });
    const list = (await inject('GET', `/api/absences?from=${day(-1)}`)).json();
    expect(list[0].files).toEqual([expect.objectContaining({ fileName: 'certificado.pdf', mime: 'application/pdf' })]);

    // Los feriados son para todos; una novedad por empleado necesita empleado.
    expect((await inject('POST', '/api/absences', { employeeId: null, kind: 'vacaciones', dateFrom: day(-1), dateTo: day(-1) })).statusCode).toBe(400);
    expect((await inject('POST', '/api/absences', { employeeId: null, kind: 'feriado', dateFrom: day(-2), dateTo: day(-2) })).statusCode).toBe(201);
    const antes = (await inject('GET', `/api/attendance?date=${day(-2)}`)).json();
    expect(antes.employees.find((e: { code: string }) => e.code === '1')).toMatchObject({ status: 'novedad' });

    // Volver al horario de la sucursal desde hoy deja el historial de ayer intacto.
    await inject('PUT', `/api/employees/${id('2')}/schedule`, { scheduleId: null, from: day(0) });
    expect((await get())('2')).toMatchObject({ schedule: { name: 'Temprano' } });
    const asig = (await inject('GET', '/api/schedule-assignments')).json();
    expect(asig).toEqual([expect.objectContaining({ validFrom: day(-2), validTo: day(-1) })]);
  });
});

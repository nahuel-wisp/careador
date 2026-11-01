import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nameKey } from '../src/lib/history';
import { testApp } from './helpers';

// Exportación real de HikCentral (septiembre 2026) con nombres inventados.
const XLSX = readFileSync(new URL('../../../docs/ejemplos/registros_entradas_salidas_anonimizado.xlsx', import.meta.url));
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

describe('historial importado de HikCentral', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  const inject = (method: 'GET' | 'POST', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: t.headers, payload });
  const upload = (payload: Buffer | string, type = XLSX_TYPE) =>
    t.app.inject({ method: 'POST', url: '/api/history/hikcentral', headers: { ...t.headers, 'content-type': type }, payload });

  beforeAll(async () => {
    t = await testApp();
    // Ana ya está cargada, con el nombre al revés (como lo cargan los equipos).
    await inject('POST', '/api/employees', { firstName: 'Gomez', lastName: 'ANA' });
  });

  afterAll(() => t.close());

  it('el nombre se compara sin acentos, mayúsculas ni orden', () => {
    expect(nameKey('Ana  Gómez')).toBe(nameKey('GOMEZ ana'));
  });

  it('importa las marcas, vincula las que puede y no duplica al reimportar', async () => {
    const res = await upload(XLSX);
    expect(res.statusCode).toBe(200);
    const r = res.json();
    // 252 días; 3 con una sola marca.
    expect(r).toMatchObject({ days: 252, inserted: 252 * 2 - 3, from: '2026-09-01', to: '2026-09-30' });
    expect(r.unmatched).toHaveLength(10);
    expect(r.unmatched).toContainEqual({ name: 'Bruno Pérez', days: 26 });

    expect((await upload(XLSX)).json()).toMatchObject({ inserted: 0 });

    const day = (await inject('GET', '/api/attendance?date=2026-09-30')).json();
    const ana = day.employees.find((e: { name: string }) => e.name === 'ANA, Gomez');
    expect(ana).toMatchObject({ marks: 2, in: { device: 'HikCentral (historial)' } });
    expect(new Date(ana.in.time).getHours()).toBe(7);
    expect(new Date(ana.out.time).getMinutes()).toBe(1); // 18:01
    expect(day.unknownCodes).toEqual([]);
  });

  it('al dar de alta a alguien que estaba en el historial, se le vinculan sus marcas', async () => {
    const bruno = (await inject('POST', '/api/employees', { firstName: 'Bruno', lastName: 'Pérez' })).json();
    const day = (await inject('GET', '/api/attendance?date=2026-09-30')).json();
    expect(day.employees.find((e: { employeeId: number }) => e.employeeId === bruno.id).marks).toBe(2);
  });

  it('rechaza archivos que no son el Excel de HikCentral', async () => {
    expect((await upload('no soy un excel')).statusCode).toBe(400);
  });
});

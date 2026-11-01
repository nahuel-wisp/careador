import { describe, expect, it } from 'vitest';
import { evaluateDay, pickInOut, type DayInput } from '../src/lib/schedule';

const day = new Date(2026, 9, 15); // jueves 15/10/2026, 00:00 local
const t = (h: number, m = 0) => new Date(2026, 9, 15, h, m);
const base: DayInput = {
  expected: { start: '09:00', end: '18:00' },
  lateToleranceMin: 15,
  earlyToleranceMin: 15,
  in: null,
  out: null,
  absences: [],
  day,
  now: t(23),
};

describe('evaluateDay', () => {
  it('a horario, dentro de la tolerancia', () => {
    expect(evaluateDay({ ...base, in: t(9, 15), out: t(17, 50) })).toEqual({
      status: 'presente',
      lateMin: 0,
      earlyMin: 0,
      missingOut: false,
      missingIn: false,
      review: false,
      workedMin: 515,
    });
  });

  it('tarde y salida anticipada fuera de la tolerancia', () => {
    expect(evaluateDay({ ...base, in: t(9, 16), out: t(17, 40) })).toMatchObject({ lateMin: 16, earlyMin: 20 });
  });

  it('los permisos perdonan la tardanza y la salida', () => {
    const r = evaluateDay({ ...base, in: t(10), out: t(16), absences: ['permiso_tarde', 'permiso_salida'] });
    expect(r).toMatchObject({ status: 'presente', lateMin: 0, earlyMin: 0 });
  });

  it('sin marcas: ausente, salvo novedad, día libre o que todavía no venció la entrada', () => {
    expect(evaluateDay(base).status).toBe('ausente');
    expect(evaluateDay({ ...base, absences: ['vacaciones'] }).status).toBe('novedad');
    expect(evaluateDay({ ...base, absences: ['permiso_tarde'] }).status).toBe('ausente');
    expect(evaluateDay({ ...base, expected: null }).status).toBe('libre');
    expect(evaluateDay({ ...base, now: t(9, 10) }).status).toBe('pendiente');
  });

  it('una sola marca: sin salida cuando ya terminó el horario, no antes', () => {
    expect(evaluateDay({ ...base, in: t(9) })).toMatchObject({ missingOut: true, earlyMin: 0, review: true });
    // Hoy, todavía en horario: no está a revisar y la tardanza cuenta.
    expect(evaluateDay({ ...base, in: t(9, 40), now: t(12) })).toMatchObject({ missingOut: false, review: false, lateMin: 40 });
  });

  it('una sola marca a la tarde es la salida: sin entrada, no 9 horas tarde', () => {
    const exp = { start: '09:00', end: '18:00' };
    expect(pickInOut([{ time: t(17, 59) }], exp, day)).toMatchObject({ in: null, out: { time: t(17, 59) } });
    expect(pickInOut([{ time: t(9, 20) }], exp, day)).toMatchObject({ in: { time: t(9, 20) }, out: null });
    expect(evaluateDay({ ...base, out: t(17, 59) })).toMatchObject({ status: 'presente', lateMin: 0, missingIn: true, missingOut: false, review: true });
    // Una sola marca no deja calcular tardanza ni salida: a revisar, salvo que haya permiso.
    expect(evaluateDay({ ...base, in: t(10, 30) })).toMatchObject({ review: true, lateMin: 0 });
    expect(evaluateDay({ ...base, out: t(15), absences: ['permiso_salida'] })).toMatchObject({ review: false, earlyMin: 0 });
  });

  it('las marcas del medio no cambian entrada ni salida', () => {
    const exp = { start: '09:00', end: '18:00' };
    const m = (h: number, mi = 0) => ({ time: t(h, mi) });
    // Entró, pasó por el lector dos veces y salió.
    const all = pickInOut([m(8, 55), m(11), m(14, 30), m(18, 2)], exp, day);
    expect(all).toMatchObject({ in: m(8, 55), out: m(18, 2), others: [m(11), m(14, 30)] });
    // Entró, pasó a las 11 y se olvidó de marcar la salida: no se fue a las 11.
    expect(pickInOut([m(8, 55), m(11)], exp, day)).toMatchObject({ in: m(8, 55), out: null, others: [m(11)] });
    // Día libre: primera y última.
    expect(pickInOut([m(10), m(11), m(12)], null, day)).toMatchObject({ in: m(10), out: m(12), others: [m(11)] });
  });

  it('marcó en día libre o con novedad: presente, sin juzgar horario', () => {
    expect(evaluateDay({ ...base, expected: null, in: t(10), out: t(12) })).toMatchObject({ status: 'presente', lateMin: 0 });
    expect(evaluateDay({ ...base, absences: ['feriado'], in: t(11), out: t(13) })).toMatchObject({ status: 'presente', lateMin: 0 });
  });
});

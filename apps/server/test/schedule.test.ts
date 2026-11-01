import { describe, expect, it } from 'vitest';
import { evaluateDay, type DayInput } from '../src/lib/schedule';

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
    expect(evaluateDay({ ...base, in: t(9) })).toMatchObject({ missingOut: true, earlyMin: 0 });
    expect(evaluateDay({ ...base, in: t(9), now: t(12) })).toMatchObject({ missingOut: false });
  });

  it('marcó en día libre o con novedad: presente, sin juzgar horario', () => {
    expect(evaluateDay({ ...base, expected: null, in: t(10), out: t(12) })).toMatchObject({ status: 'presente', lateMin: 0 });
    expect(evaluateDay({ ...base, absences: ['feriado'], in: t(11), out: t(13) })).toMatchObject({ status: 'presente', lateMin: 0 });
  });
});

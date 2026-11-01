import { describe, expect, it } from 'vitest';
import { parseChangelog, RELEASES } from './version';

describe('changelog', () => {
  it('lee versión, fecha y notas', () => {
    const r = parseChangelog('# Cambios\n\n## 1.1.0 — 2026-12-01\n\n- Algo nuevo\n\n## 1.0.0 — 2026-11-01\n\n- Primera\n');
    expect(r).toEqual([
      { version: '1.1.0', date: '2026-12-01', notes: '- Algo nuevo' },
      { version: '1.0.0', date: '2026-11-01', notes: '- Primera' },
    ]);
  });

  it('rechaza un título mal escrito', () => {
    expect(() => parseChangelog('## 1.0 - ayer\n')).toThrow(/mal escrito/);
  });

  it('CHANGELOG.md está bien: versiones únicas, de la más nueva a la más vieja', () => {
    expect(RELEASES.length).toBeGreaterThan(0);
    RELEASES.slice(1).forEach((r, i) => {
      const prev = RELEASES[i]!;
      expect(prev.version.localeCompare(r.version, 'en', { numeric: true }), `${prev.version} tiene que ser mayor que ${r.version}`).toBe(1);
      expect(prev.date >= r.date).toBe(true);
    });
    for (const r of RELEASES) expect(r.notes, `${r.version} sin notas`).not.toBe('');
  });
});

import changelog from '../../../../CHANGELOG.md?raw';

export interface Release {
  /** VERSIÓN.FUNCIÓN.CORRECCIÓN, por ejemplo 1.2.3. */
  version: string;
  /** AAAA-MM-DD. */
  date: string;
  /** Notas en markdown. */
  notes: string;
}

/** Las entradas de CHANGELOG.md: «## 1.0.0 — 2026-11-01» y debajo las notas. La primera es la versión actual. */
export function parseChangelog(md: string): Release[] {
  return md
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const [head = '', ...rest] = chunk.split('\n');
      const [, version, date] = head.match(/^(\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})\s*$/) ?? [];
      if (!version || !date) throw new Error(`Título de versión mal escrito en CHANGELOG.md: «## ${head}»`);
      return { version, date, notes: rest.join('\n').trim() };
    });
}

export const RELEASES = parseChangelog(changelog);
export const CURRENT = RELEASES[0]!; // el test de version garantiza que hay al menos una

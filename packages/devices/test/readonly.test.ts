import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOnly, SimulatedDriver } from '../src';

describe('readOnly', () => {
  it('bloquea escrituras y deja pasar lecturas', async () => {
    const sim = new SimulatedDriver({ host: 'ro', username: 'a', password: 'b' }, { dataDir: mkdtempSync(join(tmpdir(), 'ro-')) });
    await sim.upsertPerson({ id: '1', name: 'Uno', enabled: true });
    const ro = readOnly(sim);

    await expect(ro.upsertPerson({ id: '2', name: 'Dos', enabled: true })).rejects.toMatchObject({ code: 'read_only' });
    await expect(ro.deletePerson('1')).rejects.toMatchObject({ code: 'read_only' });
    await expect(ro.setFace!('1', new Uint8Array([1]))).rejects.toMatchObject({ code: 'read_only' });
    await expect(ro.openDoor!(1)).rejects.toMatchObject({ code: 'read_only' });

    const persons = [];
    for await (const p of ro.listPersons()) persons.push(p.id);
    expect(persons).toEqual(['1']);
    expect((await ro.getInfo()).model).toBe('Lector simulado');
  });
});

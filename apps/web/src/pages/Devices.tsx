import { useEffect, useState } from 'react';
import { api } from '../api';

interface Device {
  id: number;
  name: string;
  brand: string;
  host: string;
  model: string | null;
  firmware: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);

  const load = () =>
    api<Device[]>('/devices')
      .then(setDevices)
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function test(id: number) {
    setTesting(id);
    try {
      await api(`/devices/${id}/test`, { method: 'POST', body: '{}' });
    } catch {
      // el error queda guardado en el equipo
    } finally {
      setTesting(null);
      load();
    }
  }

  return (
    <section>
      <h1>Equipos</h1>
      {error && <p className="error">{error}</p>}
      {devices?.length === 0 && <p className="muted">No hay equipos cargados.</p>}
      <ul className="list">
        {devices?.map((d) => (
          <li key={d.id} className="card">
            <div>
              <strong>{d.name}</strong>
              <div className="muted">
                {d.brand} · {d.host}
                {d.model ? ` · ${d.model}` : ''}
              </div>
              {d.lastError ? (
                <div className="error">{d.lastError}</div>
              ) : d.lastSeenAt ? (
                <div className="ok">En línea</div>
              ) : null}
            </div>
            <button onClick={() => test(d.id)} disabled={testing === d.id}>
              {testing === d.id ? 'Probando…' : 'Probar'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

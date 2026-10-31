import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useEntorno } from '../entorno';

interface Device {
  id: number;
  siteId: number;
  name: string;
  brand: string;
  host: string;
  model: string | null;
  firmware: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  effectiveReadOnly: boolean;
}

interface Site {
  id: number;
  name: string;
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const load = () =>
    Promise.all([api<Device[]>('/devices'), api<Site[]>('/sites')])
      .then(([d, s]) => {
        setDevices(d);
        setSites(s);
      })
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

  async function remove(d: Device) {
    if (!confirm(`¿Quitar "${d.name}" de la app? (No borra nada en el equipo)`)) return;
    await api(`/devices/${d.id}`, { method: 'DELETE' }).catch((e: Error) => setError(e.message));
    load();
  }

  const siteName = (id: number) => sites.find((s) => s.id === id)?.name ?? '';

  return (
    <section>
      <div className="row">
        <h1>Equipos</h1>
        {!adding && <button onClick={() => setAdding(true)}>Agregar</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {adding && (
        <DeviceForm
          sites={sites}
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {devices?.length === 0 && !adding && <p className="muted">No hay equipos cargados.</p>}
      <ul className="list">
        {devices?.map((d) => (
          <li key={d.id} className="card col">
            <div>
              <strong>{d.name}</strong>
              <div className="muted">
                {siteName(d.siteId)} · {d.brand} · {d.host}
                {d.model ? ` · ${d.model}` : ''}
              </div>
              {d.effectiveReadOnly && <div className="tag">Sólo lectura</div>}
              {d.lastError ? (
                <div className="error">{d.lastError}</div>
              ) : d.lastSeenAt ? (
                <div className="ok">En línea · {d.firmware}</div>
              ) : null}
            </div>
            <div className="actions">
              <button onClick={() => test(d.id)} disabled={testing === d.id}>
                {testing === d.id ? 'Probando…' : 'Probar'}
              </button>
              {d.brand === 'simulador' && (
                <Link className="button secondary" to={`/simulador/${d.id}`}>
                  Abrir simulador
                </Link>
              )}
              <button className="link danger" onClick={() => remove(d)}>
                Quitar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DeviceForm({ sites, onCancel, onSaved }: { sites: Site[]; onCancel(): void; onSaved(): void }) {
  const entorno = useEntorno();
  const drivers = entorno?.drivers ?? [];
  const [f, setF] = useState({
    siteId: sites[0]?.id ? String(sites[0].id) : 'nueva',
    newSite: '',
    name: '',
    brand: drivers[0]?.brand ?? 'hikvision',
    host: '',
    username: 'admin',
    password: '',
    readOnly: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) =>
    setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const isSim = f.brand === 'simulador';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let siteId = Number(f.siteId);
      if (f.siteId === 'nueva') {
        siteId = (await api<Site>('/sites', { method: 'POST', body: JSON.stringify({ name: f.newSite }) })).id;
      }
      await api('/devices', {
        method: 'POST',
        body: JSON.stringify({
          siteId,
          name: f.name,
          brand: f.brand,
          host: f.host,
          username: isSim ? 'sim' : f.username,
          password: isSim ? 'sim' : f.password,
          readOnly: f.readOnly,
        }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form card col" onSubmit={submit}>
      <label>
        Sucursal
        <select value={f.siteId} onChange={set('siteId')}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="nueva">+ Nueva sucursal…</option>
        </select>
      </label>
      {f.siteId === 'nueva' && (
        <label>
          Nombre de la sucursal
          <input value={f.newSite} onChange={set('newSite')} required />
        </label>
      )}
      <label>
        Nombre del equipo
        <input value={f.name} onChange={set('name')} placeholder="Lector entrada" required />
      </label>
      <label>
        Marca
        <select value={f.brand} onChange={set('brand')}>
          {drivers.map((d) => (
            <option key={d.brand} value={d.brand}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        {isSim ? 'Identificador del simulador' : 'IP o host (con puerto si no es 80)'}
        <input
          value={f.host}
          onChange={set('host')}
          placeholder={isSim ? 'sim-sucursal-1' : '192.168.1.50 o xxxx.sn.mynetname.net:8081'}
          autoCapitalize="none"
          required
        />
      </label>
      {!isSim && (
        <>
          <label>
            Usuario
            <input value={f.username} onChange={set('username')} autoCapitalize="none" required />
          </label>
          <label>
            Contraseña
            <input type="password" value={f.password} onChange={set('password')} autoComplete="off" required />
          </label>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={f.readOnly} onChange={set('readOnly')} />
        Sólo lectura (no enviar cambios a este equipo)
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="link" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

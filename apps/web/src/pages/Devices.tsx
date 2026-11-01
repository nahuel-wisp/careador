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
  username: string;
  readOnly: boolean;
  enabled: boolean;
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
  const [editing, setEditing] = useState<number | null>(null);

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
    if (!confirm(`¿Quitar "${d.name}" de la app? En el equipo no se borra nada.`)) return;
    await api(`/devices/${d.id}`, { method: 'DELETE' }).catch((e: Error) => setError(e.message));
    load();
  }

  async function importPersons(d: Device) {
    if (!confirm(`¿Traer como empleados a las personas que ya están cargadas en "${d.name}"?`)) return;
    setTesting(d.id);
    try {
      const r = await api<{ created: number; existing: number; faces: number; facesFailed: number }>(
        `/devices/${d.id}/import-persons`,
        { method: 'POST', body: '{}' },
      );
      alert(
        `Listo: ${r.created} nuevos, ${r.existing} ya estaban, ${r.faces} fotos traídas` +
          (r.facesFailed ? `, ${r.facesFailed} sin foto` : '') +
          '. Revisá nombres y fotos en Personal.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo importar');
    } finally {
      setTesting(null);
    }
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
        {devices?.map((d) =>
          editing === d.id ? (
            <li key={d.id}>
              <EditDeviceForm
                device={d}
                sites={sites}
                onDone={() => {
                  setEditing(null);
                  load();
                }}
              />
            </li>
          ) : (
          <li key={d.id} className="card col">
            <div>
              <strong>{d.name}</strong>
              <div className="muted">
                {siteName(d.siteId)} · {d.brand} · {d.host}
                {d.model ? ` · ${d.model}` : ''}
              </div>
              {d.effectiveReadOnly && <div className="tag">Sólo lectura</div>}
              {!d.enabled && <div className="tag">Desactivado</div>}
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
              <button className="secondary" onClick={() => importPersons(d)} disabled={testing === d.id}>
                Importar personas
              </button>
              {d.brand === 'simulador' && (
                <Link className="button secondary" to={`/simulador/${d.id}`}>
                  Abrir simulador
                </Link>
              )}
              <button className="secondary" onClick={() => setEditing(d.id)}>
                Editar
              </button>
              <button className="link danger" onClick={() => remove(d)}>
                Quitar
              </button>
            </div>
          </li>
          ),
        )}
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
        {isSim ? 'Identificador del simulador' : 'IP o host'}
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
        Sólo lectura
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

/** Editar un equipo: datos de conexión, sólo lectura y activo. La contraseña sólo se cambia si se escribe. */
function EditDeviceForm({ device, sites, onDone }: { device: Device; sites: Site[]; onDone(): void }) {
  const entorno = useEntorno();
  const [f, setF] = useState({
    siteId: String(device.siteId),
    name: device.name,
    host: device.host,
    username: device.username,
    password: '',
    readOnly: device.readOnly,
    enabled: device.enabled,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSim = device.brand === 'simulador';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (device.readOnly && !f.readOnly && !confirm(`¿Habilitar la escritura en "${device.name}"? La app va a poder cargar, cambiar y dar de baja personas en el equipo.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/devices/${device.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...f, siteId: Number(f.siteId), password: f.password || undefined }),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      setBusy(false);
    }
  }

  return (
    <form className="form card col wide" onSubmit={submit}>
      <label>
        Sucursal
        <select value={f.siteId} onChange={(e) => setF({ ...f, siteId: e.target.value })}>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Nombre del equipo
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </label>
      {!isSim && (
        <>
          <label>
            IP o host
            <input value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} autoCapitalize="none" required />
          </label>
          <label>
            Usuario
            <input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoCapitalize="none" required />
          </label>
          <label>
            Contraseña nueva
            <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="off" />
          </label>
        </>
      )}
      <label className="check">
        <input type="checkbox" checked={f.readOnly} onChange={(e) => setF({ ...f, readOnly: e.target.checked })} />
        Sólo lectura
      </label>
      {entorno?.equiposSoloLectura && !isSim && (
        <p className="warn small">En este entorno los equipos reales siempre quedan en sólo lectura.</p>
      )}
      <label className="check">
        <input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
        Activo
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button type="button" className="link" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

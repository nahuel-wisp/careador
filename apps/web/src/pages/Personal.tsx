import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { prepareFaceJpeg } from '../lib/image';
import { today, type Assignment, type Schedule } from '../lib/schedules';

interface DeviceState {
  deviceId: number;
  status: 'pending' | 'synced' | 'error' | 'pending_delete';
  faceSynced: boolean;
  lastError: string | null;
}

interface Employee {
  id: number;
  code: string;
  firstName: string;
  lastName: string;
  documentNumber: string | null;
  siteId: number | null;
  active: boolean;
  hasFace: boolean;
  faceUpdatedAt: string | null;
  devices: DeviceState[];
}

interface Site {
  id: number;
  name: string;
  scheduleId: number | null;
}

interface Device {
  id: number;
  name: string;
}

export function PersonalPage() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Employee | 'nuevo' | null>(null);
  const [filter, setFilter] = useState('');
  const [showBajas, setShowBajas] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = () =>
    Promise.all([
      api<Employee[]>('/employees'),
      api<Site[]>('/sites'),
      api<Device[]>('/devices'),
      api<Schedule[]>('/schedules'),
      api<Assignment[]>('/schedule-assignments'),
    ])
      .then(([e, s, d, sc, a]) => {
        setEmployees(e);
        setSites(s);
        setDevices(d);
        setSchedules(sc);
        setAssignments(a);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function syncNow() {
    setSyncing(true);
    await api('/sync', { method: 'POST', body: '{}' }).catch((e: Error) => setError(e.message));
    setSyncing(false);
    load();
  }

  const q = filter.trim().toLowerCase();
  const visible = (employees ?? []).filter(
    (e) => e.active !== showBajas && (!q || `${e.lastName} ${e.firstName} ${e.code}`.toLowerCase().includes(q)),
  );
  const siteName = (id: number | null) => sites.find((s) => s.id === id)?.name;
  const bajas = employees?.filter((e) => !e.active).length ?? 0;

  if (editing) {
    return (
      <EmployeeForm
        employee={editing === 'nuevo' ? null : editing}
        sites={sites}
        devices={devices}
        schedules={schedules}
        ownSchedule={editing === 'nuevo' ? null : ownSchedule(assignments, editing.id)}
        onDone={() => {
          setEditing(null);
          load();
          setTimeout(load, 4000); // para ver cómo terminó el envío a los equipos
        }}
      />
    );
  }

  return (
    <section>
      <div className="row">
        <h1>Personal</h1>
        <button onClick={() => setEditing('nuevo')}>Agregar</button>
      </div>
      {error && <p className="error">{error}</p>}
      <input
        className="search"
        type="search"
        placeholder="Buscar por nombre o legajo"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {employees?.length === 0 && <p className="muted">Todavía no hay personal cargado.</p>}
      <ul className="list">
        {visible.map((e) => (
          <li key={e.id}>
            <button className="card person" onClick={() => setEditing(e)}>
              <Face employee={e} size={52} />
              <div className="grow">
                <strong>
                  {e.lastName}, {e.firstName}
                </strong>
                <div className="muted small">
                  Legajo {e.code}
                  {siteName(e.siteId) ? ` · ${siteName(e.siteId)}` : ''}
                </div>
                {e.active && <SyncLine employee={e} devices={devices} />}
              </div>
            </button>
          </li>
        ))}
      </ul>
      <div className="actions footer-actions">
        {bajas > 0 && (
          <button className="link" onClick={() => setShowBajas(!showBajas)}>
            {showBajas ? 'Ver activos' : `Ver bajas: ${bajas}`}
          </button>
        )}
        {devices.length > 0 && (
          <button className="link" onClick={syncNow} disabled={syncing}>
            {syncing ? 'Enviando a los equipos…' : 'Reenviar a los equipos'}
          </button>
        )}
      </div>
    </section>
  );
}

function Face({ employee, size }: { employee: Employee; size: number }) {
  if (!employee.hasFace) {
    return (
      <div className="avatar" style={{ width: size, height: size }} aria-hidden>
        {employee.firstName[0]}
        {employee.lastName[0]}
      </div>
    );
  }
  return (
    <img
      className="avatar"
      src={`/api/employees/${employee.id}/face?v=${employee.faceUpdatedAt}`}
      alt=""
      width={size}
      height={size}
    />
  );
}

/** Resumen de cómo está el empleado en los equipos. */
function SyncLine({ employee, devices }: { employee: Employee; devices: Device[] }) {
  const states = employee.devices;
  if (devices.length === 0) return null;
  const errors = states.filter((s) => s.status === 'error');
  if (errors.length) {
    const names = errors.map((s) => devices.find((d) => d.id === s.deviceId)?.name ?? `#${s.deviceId}`);
    return <div className="error small">No se pudo cargar en {names.join(', ')}; se reintenta cada hora</div>;
  }
  const synced = states.filter((s) => s.status === 'synced');
  if (synced.length < devices.length) return <div className="muted small">Enviando a los equipos…</div>;
  if (!employee.hasFace) return <div className="warn small">Sin foto: no va a poder marcar con la cara</div>;
  if (synced.some((s) => !s.faceSynced)) return <div className="muted small">Enviando la foto…</div>;
  return <div className="ok small">✓ Cargado en {synced.length === 1 ? 'el equipo' : `los ${synced.length} equipos`}</div>;
}

/** Horario propio vigente hoy (null = usa el de la sucursal). */
function ownSchedule(assignments: Assignment[], employeeId: number) {
  const t = today();
  return assignments.find((a) => a.employeeId === employeeId && a.validFrom <= t && (!a.validTo || a.validTo >= t))?.scheduleId ?? null;
}

function EmployeeForm({
  employee,
  sites,
  devices,
  schedules,
  ownSchedule,
  onDone,
}: {
  employee: Employee | null;
  sites: Site[];
  devices: Device[];
  schedules: Schedule[];
  ownSchedule: number | null;
  onDone(): void;
}) {
  const [f, setF] = useState({
    firstName: employee?.firstName ?? '',
    lastName: employee?.lastName ?? '',
    documentNumber: employee?.documentNumber ?? '',
    siteId: employee ? String(employee.siteId ?? '') : String(sites[0]?.id ?? ''),
    code: '',
    scheduleId: String(ownSchedule ?? ''),
  });
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function pickPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const jpeg = await prepareFaceJpeg(file);
      setPhoto(jpeg);
      setPreview(URL.createObjectURL(jpeg));
    } catch {
      setError('No se pudo leer la foto. Probá de nuevo.');
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = {
      firstName: f.firstName,
      lastName: f.lastName,
      documentNumber: f.documentNumber || null,
      siteId: f.siteId ? Number(f.siteId) : null,
    };
    try {
      const saved = employee
        ? await api<Employee>(`/employees/${employee.id}`, { method: 'PATCH', body: JSON.stringify(body) })
        : await api<Employee>('/employees', {
            method: 'POST',
            body: JSON.stringify({ ...body, ...(f.code.trim() ? { code: f.code.trim() } : {}) }),
          });
      if (f.scheduleId !== String(ownSchedule ?? '')) {
        await api(`/employees/${saved.id}/schedule`, {
          method: 'PUT',
          body: JSON.stringify({ scheduleId: f.scheduleId ? Number(f.scheduleId) : null }),
        });
      }
      if (photo) {
        await api(`/employees/${saved.id}/face`, { method: 'PUT', body: photo, headers: { 'Content-Type': 'image/jpeg' } });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!employee) return;
    const baja = employee.active;
    if (baja && !confirm(`¿Dar de baja a ${employee.firstName} ${employee.lastName}? Se borra de los equipos y deja de poder marcar. Sus marcaciones quedan guardadas.`)) {
      return;
    }
    setBusy(true);
    try {
      await api(`/employees/${employee.id}`, { method: 'PATCH', body: JSON.stringify({ active: !baja }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      setBusy(false);
    }
  }

  const currentFace = preview ?? (employee?.hasFace ? `/api/employees/${employee.id}/face?v=${employee.faceUpdatedAt}` : null);

  return (
    <section>
      <div className="row">
        <h1>{employee ? `${employee.firstName} ${employee.lastName}` : 'Nuevo empleado'}</h1>
      </div>
      <form className="form card col wide" onSubmit={submit}>
        <div className="photo-pick">
          {currentFace ? (
            <img src={currentFace} alt="Foto para el lector" className="photo" />
          ) : (
            <div className="photo empty">Sin foto</div>
          )}
          <label className="button secondary">
            {currentFace ? 'Cambiar foto' : 'Sacar foto'}
            <input
              type="file"
              accept="image/*"
              capture="user"
              hidden
              onChange={(e) => pickPhoto(e.target.files?.[0])}
            />
          </label>
          <p className="muted small">
            De frente, con buena luz, sin anteojos de sol ni gorra. La cara tiene que ocupar casi toda la foto.
          </p>
        </div>
        <label>
          Nombre
          <input value={f.firstName} onChange={set('firstName')} autoComplete="off" required />
        </label>
        <label>
          Apellido
          <input value={f.lastName} onChange={set('lastName')} autoComplete="off" required />
        </label>
        <label>
          DNI
          <input value={f.documentNumber} onChange={set('documentNumber')} inputMode="numeric" autoComplete="off" />
        </label>
        {sites.length > 0 && (
          <label>
            Sucursal
            <select value={f.siteId} onChange={set('siteId')}>
              <option value="">Sin sucursal</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {schedules.length > 0 && (
          <label>
            Horario
            <select value={f.scheduleId} onChange={set('scheduleId')}>
              <option value="">
                El de la sucursal
                {(() => {
                  const id = sites.find((s) => String(s.id) === f.siteId)?.scheduleId;
                  const name = schedules.find((s) => s.id === id)?.name;
                  return name ? `: ${name}` : '';
                })()}
              </option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {employee ? (
          <p className="muted small">Legajo {employee.code}</p>
        ) : (
          <label>
            Legajo
            <input value={f.code} onChange={set('code')} placeholder="Siguiente número" autoCapitalize="none" autoComplete="off" />
          </label>
        )}
        {devices.length === 0 && (
          <p className="warn small">Todavía no hay equipos cargados: se va a enviar cuando agregues uno.</p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="link" onClick={onDone}>
            Cancelar
          </button>
          {employee && (
            <button type="button" className={employee.active ? 'link danger' : 'link'} onClick={toggleActive} disabled={busy}>
              {employee.active ? 'Dar de baja' : 'Volver a dar de alta'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

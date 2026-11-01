import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { api } from '../api';
import { prepareFaceJpeg } from '../lib/image';
import { whatsappUrl } from '../lib/phone';
import { today, type Assignment, type DaySchedule, type Schedule } from '../lib/schedules';
import { Camera, PageHeader, useVista } from '../ui';

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
  position: string | null;
  phone: string | null;
  notes: string | null;
  lunch: DaySchedule | null;
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

/** Lo que usan la lista y la ficha. */
function usePersonalData() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [error, setError] = useState<string | null>(null);
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
  return { employees, sites, devices, schedules, assignments, error, load };
}

export function PersonalPage() {
  const navigate = useNavigate();
  const [vista] = useVista();
  const { employees, sites, devices, error, load } = usePersonalData();
  const [filter, setFilter] = useState('');
  const [showBajas, setShowBajas] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function syncNow() {
    setSyncing(true);
    await api('/sync', { method: 'POST', body: '{}' }).catch(() => {});
    setSyncing(false);
    load();
  }

  const q = filter.trim().toLowerCase();
  const visible = (employees ?? []).filter(
    (e) => e.active !== showBajas && (!q || `${e.lastName} ${e.firstName} ${e.code} ${e.position ?? ''}`.toLowerCase().includes(q)),
  );
  const siteName = (id: number | null) => sites.find((s) => s.id === id)?.name ?? '';
  const bajas = employees?.filter((e) => !e.active).length ?? 0;
  const open = (e: Employee) => navigate(`/personal/${e.id}`);

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Personal' }]}>
        <button onClick={() => navigate('/personal/nuevo')}>Agregar</button>
      </PageHeader>
      {error && <p className="error">{error}</p>}
      <div className="toolbar">
        <input type="search" placeholder="Buscar por nombre, legajo o cargo" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {bajas > 0 && (
          <button className="link" onClick={() => setShowBajas(!showBajas)}>
            {showBajas ? 'Ver activos' : `Ver bajas: ${bajas}`}
          </button>
        )}
        <span className="sep" />
        {devices.length > 0 && vista === 'pc' && (
          <button className="secondary small-btn" onClick={syncNow} disabled={syncing}>
            {syncing ? 'Enviando…' : 'Reenviar a los equipos'}
          </button>
        )}
      </div>
      {employees?.length === 0 && <p className="muted">Todavía no hay personal cargado.</p>}

      {vista === 'celular' ? (
        <ul className="list">
          {visible.map((e) => (
            <li key={e.id}>
              <button className="card person" onClick={() => open(e)}>
                <Face employee={e} size={48} />
                <div className="grow">
                  <strong>
                    {e.lastName}, {e.firstName}
                  </strong>
                  <div className="muted small">
                    Legajo {e.code}
                    {siteName(e.siteId) && ` · ${siteName(e.siteId)}`}
                  </div>
                  {e.active && <SyncLine employee={e} devices={devices} />}
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        visible.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>Apellido y nombre</th>
                  <th>Legajo</th>
                  <th>Sucursal</th>
                  <th>Cargo</th>
                  <th>Teléfono</th>
                  <th>Equipos</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => open(e)}>
                    <td style={{ width: 44 }}>
                      <Face employee={e} size={30} />
                    </td>
                    <td>
                      <strong>
                        {e.lastName}, {e.firstName}
                      </strong>
                    </td>
                    <td>{e.code}</td>
                    <td>{siteName(e.siteId)}</td>
                    <td>{e.position}</td>
                    <td className="nowrap" onClick={(ev) => ev.stopPropagation()}>
                      {e.phone && (
                        <a className="wa" href={whatsappUrl(e.phone)} target="_blank" rel="noreferrer" title="Abrir WhatsApp">
                          {e.phone}
                        </a>
                      )}
                    </td>
                    <td>{e.active && <SyncLine employee={e} devices={devices} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </section>
  );
}

function Face({ employee, size }: { employee: Employee; size: number }) {
  if (!employee.hasFace) {
    return (
      <div className="avatar" style={{ width: size, height: size, fontSize: size / 2.6 }} aria-hidden>
        {employee.firstName[0]}
        {employee.lastName[0]}
      </div>
    );
  }
  return (
    <img className="avatar" src={`/api/employees/${employee.id}/face?v=${employee.faceUpdatedAt}`} alt="" width={size} height={size} />
  );
}

/** Cómo está la persona en los equipos. */
function SyncLine({ employee, devices }: { employee: Employee; devices: Device[] }) {
  const states = employee.devices;
  if (devices.length === 0) return null;
  const errors = states.filter((s) => s.status === 'error');
  if (errors.length) {
    const names = errors.map((s) => devices.find((d) => d.id === s.deviceId)?.name ?? `#${s.deviceId}`);
    return <span className="badge warn-bg" title={errors[0]?.lastError ?? ''}>Falta cargar en {names.join(', ')}</span>;
  }
  const synced = states.filter((s) => s.status === 'synced');
  if (synced.length < devices.length) return <span className="badge">Enviando…</span>;
  if (!employee.hasFace) return <span className="badge warn-bg">Sin foto</span>;
  if (synced.some((s) => !s.faceSynced)) return <span className="badge">Enviando la foto…</span>;
  return <span className="badge good">✓ En {synced.length === 1 ? 'el equipo' : `los ${synced.length} equipos`}</span>;
}

/** Horario propio vigente hoy (null = usa el de la sucursal). */
function ownSchedule(assignments: Assignment[], employeeId: number) {
  const t = today();
  return assignments.find((a) => a.employeeId === employeeId && a.validFrom <= t && (!a.validTo || a.validTo >= t))?.scheduleId ?? null;
}

/** Ficha de una persona: /personal/:id (o /personal/nuevo). */
export function EmployeePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const data = usePersonalData();
  if (!data.employees) return null;
  const employee = id === 'nuevo' ? null : (data.employees.find((e) => String(e.id) === id) ?? null);
  if (id !== 'nuevo' && !employee) return <p className="muted">No existe esa persona.</p>;
  return (
    <EmployeeForm
      key={employee?.id ?? 'nuevo'}
      employee={employee}
      sites={data.sites}
      devices={data.devices}
      schedules={data.schedules}
      ownSchedule={employee ? ownSchedule(data.assignments, employee.id) : null}
      onDone={() => navigate('/personal')}
    />
  );
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
    position: employee?.position ?? '',
    phone: employee?.phone ?? '',
    notes: employee?.notes ?? '',
    ownLunch: !!employee?.lunch,
    lunchStart: employee?.lunch?.start ?? '13:00',
    lunchEnd: employee?.lunch?.end ?? '14:00',
  });
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function pickPhoto(file: Blob | undefined) {
    setCamera(false);
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
      position: f.position || null,
      phone: f.phone || null,
      notes: f.notes || null,
      lunch: f.ownLunch ? { start: f.lunchStart, end: f.lunchEnd } : null,
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
  const siteSchedule = schedules.find((s) => s.id === sites.find((x) => String(x.id) === f.siteId)?.scheduleId)?.name;
  const title = employee ? `${employee.lastName}, ${employee.firstName}` : 'Nueva persona';

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Personal', to: '/personal' }, { label: title }]}>
        {employee && !employee.active && <span className="tag">Dado de baja</span>}
      </PageHeader>
      <form className="split" onSubmit={submit}>
        <div className="panel photo-pick">
          {camera ? (
            <Camera onPhoto={pickPhoto} onClose={() => setCamera(false)} />
          ) : (
            <>
              {currentFace ? <img src={currentFace} alt="Foto para el lector" className="photo" /> : <div className="photo empty">Sin foto</div>}
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button type="button" className="secondary small-btn" onClick={() => setCamera(true)}>
                  Sacar foto
                </button>
                <label className="button small-btn">
                  Subir foto
                  <input type="file" accept="image/*" capture="user" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
                </label>
              </div>
            </>
          )}
          <p className="muted small">De frente, con buena luz, sin anteojos de sol ni gorra. La cara tiene que ocupar casi toda la foto.</p>
        </div>

        <div className="panel form wide">
          <div className="form-grid">
            <label>
              Nombre
              <input value={f.firstName} onChange={set('firstName')} autoComplete="off" required />
            </label>
            <label>
              Apellido
              <input value={f.lastName} onChange={set('lastName')} autoComplete="off" required />
            </label>
            {employee ? (
              <label>
                Legajo
                <input value={employee.code} disabled />
              </label>
            ) : (
              <label>
                Legajo
                <input value={f.code} onChange={set('code')} placeholder="Siguiente número" autoCapitalize="none" autoComplete="off" />
              </label>
            )}
            <label>
              DNI
              <input value={f.documentNumber} onChange={set('documentNumber')} inputMode="numeric" autoComplete="off" />
            </label>
            <label>
              Cargo
              <input value={f.position} onChange={set('position')} placeholder="Vendedor, mecánico…" autoComplete="off" />
            </label>
            <label>
              Teléfono
              <input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="221 555-1234" autoComplete="off" />
              {f.phone.replace(/\D/g, '').length >= 8 && (
                <a className="wa small" href={whatsappUrl(f.phone)} target="_blank" rel="noreferrer">
                  Abrir WhatsApp
                </a>
              )}
            </label>
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
            <label>
              Horario
              <select value={f.scheduleId} onChange={set('scheduleId')}>
                <option value="">{siteSchedule ? `El de la sucursal: ${siteSchedule}` : 'El de la sucursal'}</option>
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="full">
              <label className="check">
                <input type="checkbox" checked={f.ownLunch} onChange={(e) => setF({ ...f, ownLunch: e.target.checked })} />
                Almuerzo propio
              </label>
              {f.ownLunch && (
                <div className="times-edit" style={{ marginTop: 6 }}>
                  <input type="time" value={f.lunchStart} onChange={set('lunchStart')} aria-label="Empieza el almuerzo" required />
                  <span className="muted">a</span>
                  <input type="time" value={f.lunchEnd} onChange={set('lunchEnd')} aria-label="Termina el almuerzo" required />
                </div>
              )}
            </div>
            <label className="full">
              Notas
              <textarea value={f.notes} onChange={set('notes')} rows={4} />
            </label>
          </div>
          {devices.length === 0 && <p className="warn small">Todavía no hay equipos: se va a enviar cuando se agregue uno.</p>}
          {error && <p className="error">{error}</p>}
          <div className="actions">
            <button type="submit" disabled={busy}>
              {busy ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" className="link" onClick={onDone}>
              Cancelar
            </button>
            <span className="grow" />
            {employee && (
              <button type="button" className={employee.active ? 'link danger' : 'link'} onClick={toggleActive} disabled={busy}>
                {employee.active ? 'Dar de baja' : 'Volver a dar de alta'}
              </button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}

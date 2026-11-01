import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { summarize, WEEK, type DaySchedule, type Schedule } from '../lib/schedules';
import { PageHeader } from '../ui';

interface Site {
  id: number;
  name: string;
  address: string | null;
  phone: string | null;
  notes: string | null;
  scheduleId: number | null;
}

interface Device {
  id: number;
  name: string;
  siteId: number;
}

/** Sucursales (con sus lectores y su horario) y los horarios que se les pueden aplicar. */
export function SitesPage() {
  const isAdmin = useAuth().user?.role === 'admin';
  const [sites, setSites] = useState<Site[]>([]);
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [editingSite, setEditingSite] = useState<Site | 'nueva' | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api<Site[]>('/sites'), api<Schedule[]>('/schedules'), api<Device[]>('/devices')])
      .then(([si, sc, d]) => {
        setSites(si);
        setSchedules(sc);
        setDevices(d);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const scheduleName = (id: number | null) => schedules?.find((s) => s.id === id)?.name ?? '';
  const done = () => {
    setEditingSite(null);
    setEditingSchedule(null);
    load();
  };

  if (editingSite) {
    return <SiteForm site={editingSite === 'nueva' ? null : editingSite} schedules={schedules ?? []} devices={devices} isAdmin={isAdmin} sites={sites} onDone={done} />;
  }
  if (editingSchedule) {
    return <ScheduleForm schedule={editingSchedule === 'nuevo' ? null : editingSchedule} onDone={done} />;
  }

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Sucursales y horarios' }]} />
      {error && <p className="error">{error}</p>}

      <div className="row">
        <h2 style={{ margin: 0 }}>Sucursales</h2>
        <button className="small-btn" onClick={() => setEditingSite('nueva')}>
          Agregar sucursal
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Sucursal</th>
              <th>Dirección</th>
              <th>Teléfono</th>
              <th>Horario</th>
              <th>Lectores</th>
              <th>Notas</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setEditingSite(s)}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td>{s.address}</td>
                <td className="nowrap">{s.phone}</td>
                <td>{scheduleName(s.scheduleId) || <span className="muted">Sin horario</span>}</td>
                <td>
                  {devices
                    .filter((d) => d.siteId === s.id)
                    .map((d) => d.name)
                    .join(', ') || <span className="muted">Ninguno</span>}
                </td>
                <td className="muted small">{s.notes}</td>
              </tr>
            ))}
            {sites.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  Todavía no hay sucursales.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 24 }}>
        <h2 style={{ margin: 0 }}>Horarios</h2>
        <button className="small-btn" onClick={() => setEditingSchedule('nuevo')}>
          Agregar horario
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Horario</th>
              <th>Días</th>
              <th>Almuerzo</th>
              <th>Tolerancia</th>
              <th>Lo usan</th>
            </tr>
          </thead>
          <tbody>
            {schedules?.map((s) => (
              <tr key={s.id} className="clickable" onClick={() => setEditingSchedule(s)}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td>{summarize(s.days)}</td>
                <td className="nowrap">
                  {s.lunch ? `${s.lunch.start}–${s.lunch.end}${s.lunchDeducted ? ', se descuenta' : ''}` : <span className="muted">Sin almuerzo</span>}
                </td>
                <td className="nowrap">
                  {s.lateToleranceMin} min llegada · {s.earlyToleranceMin} min salida
                </td>
                <td>
                  {sites
                    .filter((x) => x.scheduleId === s.id)
                    .map((x) => x.name)
                    .join(', ')}
                </td>
              </tr>
            ))}
            {schedules?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Todavía no hay horarios.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SiteForm({
  site,
  sites,
  schedules,
  devices,
  isAdmin,
  onDone,
}: {
  site: Site | null;
  sites: Site[];
  schedules: Schedule[];
  devices: Device[];
  isAdmin: boolean;
  onDone(): void;
}) {
  const [f, setF] = useState({
    name: site?.name ?? '',
    address: site?.address ?? '',
    phone: site?.phone ?? '',
    notes: site?.notes ?? '',
    scheduleId: String(site?.scheduleId ?? ''),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState(devices);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = JSON.stringify({
      name: f.name,
      address: f.address || null,
      phone: f.phone || null,
      notes: f.notes || null,
      scheduleId: f.scheduleId ? Number(f.scheduleId) : null,
    });
    try {
      await (site ? api(`/sites/${site.id}`, { method: 'PATCH', body }) : api('/sites', { method: 'POST', body }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      setBusy(false);
    }
  }

  async function remove() {
    if (!site || !confirm(`¿Borrar la sucursal «${site.name}»?`)) return;
    try {
      await api(`/sites/${site.id}`, { method: 'DELETE' });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo borrar');
    }
  }

  /** Cada lector está en una sola sucursal: asignarlo acá lo saca de la otra. */
  async function moveDevice(deviceId: number, siteId: number) {
    setError(null);
    try {
      await api(`/devices/${deviceId}`, { method: 'PATCH', body: JSON.stringify({ siteId }) });
      setList(list.map((d) => (d.id === deviceId ? { ...d, siteId } : d)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo mover el lector');
    }
  }

  const mine = site ? list.filter((d) => d.siteId === site.id) : [];
  const others = site ? list.filter((d) => d.siteId !== site.id) : [];
  const siteName = (id: number) => sites.find((s) => s.id === id)?.name ?? '';

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Sucursales y horarios', to: '/sucursales' }, { label: site ? site.name : 'Nueva sucursal' }]} />
      <form className="panel form wide" onSubmit={submit} style={{ maxWidth: 760 }}>
        <div className="form-grid">
          <label>
            Nombre
            <input value={f.name} onChange={set('name')} required />
          </label>
          <label>
            Teléfono
            <input value={f.phone} onChange={set('phone')} inputMode="tel" />
          </label>
          <label className="full">
            Dirección
            <input value={f.address} onChange={set('address')} />
          </label>
          <label>
            Horario
            <select value={f.scheduleId} onChange={set('scheduleId')}>
              <option value="">Sin horario</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="full">
            Notas
            <textarea value={f.notes} onChange={set('notes')} rows={3} />
          </label>
        </div>

        {site && (
          <div>
            <strong>Lectores</strong>
            {mine.length === 0 && <p className="muted small">Esta sucursal no tiene lectores.</p>}
            <ul className="list compact" style={{ margin: '6px 0' }}>
              {mine.map((d) => (
                <li key={d.id} className="small">
                  📟 {d.name}
                </li>
              ))}
            </ul>
            {isAdmin && others.length > 0 && (
              <select value="" onChange={(e) => e.target.value && moveDevice(Number(e.target.value), site.id)} aria-label="Asignar lector">
                <option value="">Asignar un lector de otra sucursal…</option>
                {others.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}, hoy en {siteName(d.siteId)}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="link" onClick={onDone}>
            Cancelar
          </button>
          <span className="grow" />
          {site && (
            <button type="button" className="link danger" onClick={remove}>
              Borrar sucursal
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

const DEFAULT_WEEK: (DaySchedule | null)[] = [null, ...Array(5).fill({ start: '09:00', end: '18:00' }), { start: '09:00', end: '13:00' }];

function ScheduleForm({ schedule, onDone }: { schedule: Schedule | null; onDone(): void }) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [days, setDays] = useState(schedule?.days ?? DEFAULT_WEEK);
  const [late, setLate] = useState(String(schedule?.lateToleranceMin ?? 15));
  const [early, setEarly] = useState(String(schedule?.earlyToleranceMin ?? 15));
  const [hasLunch, setHasLunch] = useState(!!schedule?.lunch);
  const [lunch, setLunch] = useState(schedule?.lunch ?? { start: '13:00', end: '14:00' });
  const [lunchDeducted, setLunchDeducted] = useState(schedule?.lunchDeducted ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setDay = (i: number, d: DaySchedule | null) => setDays(days.map((x, j) => (j === i ? d : x)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = JSON.stringify({
      name,
      days,
      lateToleranceMin: Number(late),
      earlyToleranceMin: Number(early),
      lunch: hasLunch ? lunch : null,
      lunchDeducted: hasLunch && lunchDeducted,
    });
    try {
      await (schedule ? api(`/schedules/${schedule.id}`, { method: 'PUT', body }) : api('/schedules', { method: 'POST', body }));
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      setBusy(false);
    }
  }

  async function remove() {
    if (!schedule || !confirm(`¿Borrar el horario «${schedule.name}»? Quien lo tenga queda sin horario.`)) return;
    setBusy(true);
    await api(`/schedules/${schedule.id}`, { method: 'DELETE' }).catch((e: Error) => setError(e.message));
    onDone();
  }

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Sucursales y horarios', to: '/sucursales' }, { label: schedule ? schedule.name : 'Nuevo horario' }]} />
      <form className="panel form wide" onSubmit={submit} style={{ maxWidth: 560 }}>
        <label>
          Nombre
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Arsa 1" required />
        </label>
        <div className="week">
          {WEEK.map(({ i, name: dayName }) => {
            const d = days[i];
            return (
              <div key={i} className="week-day">
                <label className="check">
                  <input type="checkbox" checked={!!d} onChange={(e) => setDay(i, e.target.checked ? { start: '09:00', end: '18:00' } : null)} />
                  {dayName}
                </label>
                {d ? (
                  <span className="times-edit">
                    <input type="time" value={d.start} onChange={(e) => setDay(i, { ...d, start: e.target.value })} required aria-label={`Entrada ${dayName}`} />
                    <span className="muted">a</span>
                    <input type="time" value={d.end} onChange={(e) => setDay(i, { ...d, end: e.target.value })} required aria-label={`Salida ${dayName}`} />
                  </span>
                ) : (
                  <span className="muted small">No trabaja</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="week-day">
          <label className="check">
            <input type="checkbox" checked={hasLunch} onChange={(e) => setHasLunch(e.target.checked)} />
            Almuerzo
          </label>
          {hasLunch ? (
            <span className="times-edit">
              <input type="time" value={lunch.start} onChange={(e) => setLunch({ ...lunch, start: e.target.value })} required aria-label="Empieza el almuerzo" />
              <span className="muted">a</span>
              <input type="time" value={lunch.end} onChange={(e) => setLunch({ ...lunch, end: e.target.value })} required aria-label="Termina el almuerzo" />
            </span>
          ) : (
            <span className="muted small">Sin almuerzo</span>
          )}
        </div>
        {hasLunch && (
          <label className="check">
            <input type="checkbox" checked={lunchDeducted} onChange={(e) => setLunchDeducted(e.target.checked)} />
            El almuerzo se descuenta de las horas trabajadas
          </label>
        )}

        <div className="two">
          <label>
            Tolerancia de llegada, minutos
            <input type="number" min={0} max={240} value={late} onChange={(e) => setLate(e.target.value)} inputMode="numeric" />
          </label>
          <label>
            Tolerancia de salida, minutos
            <input type="number" min={0} max={240} value={early} onChange={(e) => setEarly(e.target.value)} inputMode="numeric" />
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="link" onClick={onDone}>
            Cancelar
          </button>
          <span className="grow" />
          {schedule && (
            <button type="button" className="link danger" onClick={remove} disabled={busy}>
              Borrar horario
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

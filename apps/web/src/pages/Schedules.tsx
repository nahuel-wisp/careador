import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { summarize, WEEK, type DaySchedule, type Schedule } from '../lib/schedules';

interface Site {
  id: number;
  name: string;
  scheduleId: number | null;
}

/** Horarios semanales y cuál usa cada sucursal por defecto. */
export function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [editing, setEditing] = useState<Schedule | 'nuevo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    Promise.all([api<Schedule[]>('/schedules'), api<Site[]>('/sites')])
      .then(([sc, si]) => {
        setSchedules(sc);
        setSites(si);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  async function setSiteSchedule(site: Site, value: string) {
    setError(null);
    await api(`/sites/${site.id}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({ scheduleId: value ? Number(value) : null }),
    }).catch((e: Error) => setError(e.message));
    load();
  }

  if (editing) {
    return (
      <ScheduleForm
        schedule={editing === 'nuevo' ? null : editing}
        onDone={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <section>
      <div className="row">
        <h1>Horarios</h1>
        <button onClick={() => setEditing('nuevo')}>Agregar</button>
      </div>
      {error && <p className="error">{error}</p>}
      {schedules?.length === 0 && (
        <p className="muted">Todavía no hay horarios. Cargá uno por sucursal.</p>
      )}
      <ul className="list">
        {schedules?.map((s) => (
          <li key={s.id}>
            <button className="card person" onClick={() => setEditing(s)}>
              <div className="grow">
                <strong>{s.name}</strong>
                <div className="muted small">{summarize(s.days)}</div>
                <div className="muted small">
                  Tolerancia: {s.lateToleranceMin} min de llegada · {s.earlyToleranceMin} min de salida
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>

      {sites.length > 0 && !!schedules?.length && (
        <>
          <h2>Horario de cada sucursal</h2>
          <p className="muted small">
            Lo tiene todo el personal de la sucursal, salvo quien tenga uno propio en Personal.
          </p>
          <div className="card col">
            {sites.map((site) => (
              <label key={site.id} className="inline">
                <span className="grow">{site.name}</span>
                <select value={site.scheduleId ?? ''} onChange={(e) => setSiteSchedule(site, e.target.value)}>
                  <option value="">Sin horario</option>
                  {schedules.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

const EMPTY_WEEK: (DaySchedule | null)[] = [null, ...Array(5).fill({ start: '09:00', end: '18:00' }), { start: '09:00', end: '13:00' }];

function ScheduleForm({ schedule, onDone }: { schedule: Schedule | null; onDone(): void }) {
  const [name, setName] = useState(schedule?.name ?? '');
  const [days, setDays] = useState(schedule?.days ?? EMPTY_WEEK);
  const [late, setLate] = useState(String(schedule?.lateToleranceMin ?? 15));
  const [early, setEarly] = useState(String(schedule?.earlyToleranceMin ?? 15));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setDay = (i: number, d: DaySchedule | null) => setDays(days.map((x, j) => (j === i ? d : x)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = JSON.stringify({ name, days, lateToleranceMin: Number(late), earlyToleranceMin: Number(early) });
    try {
      await (schedule
        ? api(`/schedules/${schedule.id}`, { method: 'PUT', body })
        : api('/schedules', { method: 'POST', body }));
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
      <h1>{schedule ? schedule.name : 'Nuevo horario'}</h1>
      <form className="form card col wide" onSubmit={submit}>
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
        <label>
          Minutos de tolerancia para llegar
          <input type="number" min={0} max={240} value={late} onChange={(e) => setLate(e.target.value)} inputMode="numeric" />
        </label>
        <label>
          Minutos de tolerancia para salir
          <input type="number" min={0} max={240} value={early} onChange={(e) => setEarly(e.target.value)} inputMode="numeric" />
        </label>
        <p className="muted small">
          El almuerzo no se descuenta: las horas van de la primera a la última marca.
        </p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
          <button type="button" className="link" onClick={onDone}>
            Cancelar
          </button>
          {schedule && (
            <button type="button" className="link danger" onClick={remove} disabled={busy}>
              Borrar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

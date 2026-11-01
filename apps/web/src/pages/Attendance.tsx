import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api';
import { KIND_SHORT, shortDate, type AbsenceKind, type DaySchedule } from '../lib/schedules';
import { PageHeader } from '../ui';

interface Mark {
  id: number;
  time: string;
  device?: string;
  /** Cargada a mano (con motivo y quién). */
  manual: boolean;
  note: string | null;
  by: string | null;
}

interface AuditRow {
  id: number;
  at: string;
  userName: string;
  summary: string;
}

interface Row {
  employeeId: number;
  code: string;
  name: string;
  marks: number;
  siteId: number | null;
  workedSiteId: number | null;
  in: Mark | null;
  out: Mark | null;
  schedule: { id: number; name: string } | null;
  expected: DaySchedule | null;
  absences: { id: number; kind: AbsenceKind; note: string | null }[];
  status: 'libre' | 'novedad' | 'ausente' | 'pendiente' | 'presente';
  lateMin: number;
  earlyMin: number;
  missingOut: boolean;
  missingIn: boolean;
  /** Falta la entrada o la salida: lo que se muestra es una sugerencia. */
  review: boolean;
  workedMin: number;
  otherMarks: Mark[];
  manualMarks: Mark[];
  voidedMarks: (Mark & { voidedBy: string | null; voidReason: string | null })[];
}

interface Attendance {
  employees: Row[];
  unknownCodes: string[];
  syncedUntil: string | null;
}

const today = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD en hora local
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`);

/** Asistencia de un día, en una tabla: quién vino y a qué hora, quién llegó tarde, faltó o tenía novedad. */
export function AttendancePage() {
  const [params, setParams] = useSearchParams();
  const date = params.get('fecha') ?? today();
  const detail = params.get('persona');
  const [data, setData] = useState<Attendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    api<{ id: number; name: string }[]>('/sites').then(setSites).catch(() => {});
  }, []);

  const load = (d = date) =>
    api<Attendance>(`/attendance?date=${d}`)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));

  useEffect(() => {
    load(date);
  }, [date]);

  async function refresh() {
    setBusy(true);
    await api('/events/sync', { method: 'POST', body: '{}' }).catch((e: Error) => setError(e.message));
    await load();
    setBusy(false);
  }

  const setDate = (d: string) => setParams(d === today() ? {} : { fecha: d });
  const openPerson = (id: number) => setParams({ fecha: date, persona: String(id) });
  const open = data?.employees.find((e) => String(e.employeeId) === detail);

  if (open) {
    return <DayDetail row={open} date={date} onChange={() => load()} />;
  }

  // Los que no tienen horario ni marcaron (los dueños) y los que tenían el día libre no se listan.
  const rows = (data?.employees ?? []).filter((e) => e.status !== 'libre' || e.marks > 0);
  const order: Record<Row['status'], number> = { ausente: 0, presente: 1, pendiente: 2, novedad: 3, libre: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'es'));
  const present = rows.filter((e) => e.status === 'presente');
  const absent = rows.filter((e) => e.status === 'ausente').length;
  const late = present.filter((e) => e.lateMin > 0).length;
  const toReview = present.filter((e) => e.review).length;
  const siteName = (id: number | null) => sites.find((s) => s.id === id)?.name ?? '';

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Asistencia' }]}>
        <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Día" />
        <button className="secondary" onClick={refresh} disabled={busy}>
          {busy ? 'Leyendo…' : 'Actualizar'}
        </button>
      </PageHeader>
      {error && <p className="error">{error}</p>}
      {data && (
        <div className="kpis">
          <span>
            <b>{present.length}</b>vinieron
          </span>
          <span className={late ? 'bad' : ''}>
            <b>{late}</b>tarde
          </span>
          <span className={absent ? 'bad' : ''}>
            <b>{absent}</b>faltaron
          </span>
          <span className={toReview ? 'warn' : ''}>
            <b>{toReview}</b>a revisar
          </span>
          <span className="muted small">
            {data.syncedUntil ? `Leído de los equipos a las ${hhmm(data.syncedUntil)}` : 'Todavía no se leyeron los equipos'}
          </span>
        </div>
      )}

      {data && rows.length === 0 && <p className="muted">Nadie tenía que trabajar este día.</p>}
      {rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Persona</th>
                <th>Sucursal</th>
                <th>Horario</th>
                <th>Entrada</th>
                <th>Salida</th>
                <th className="num">Horas</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.employeeId} className="clickable" onClick={() => openPerson(e.employeeId)}>
                  <td>
                    <strong>{e.name}</strong>
                  </td>
                  <td>{siteName(e.workedSiteId)}</td>
                  <td className="muted nowrap">{e.expected ? `${e.expected.start}–${e.expected.end}` : ''}</td>
                  <td className={e.review && e.in ? 'guess' : ''} title={e.in?.device}>
                    {e.in ? hhmm(e.in.time) : '–'}
                  </td>
                  <td className={e.review && e.out ? 'guess' : ''} title={e.out?.device}>
                    {e.out ? hhmm(e.out.time) : '–'}
                  </td>
                  <td className="num">{e.workedMin > 0 ? dur(e.workedMin) : ''}</td>
                  <td>
                    <div className="badges">
                      {e.status === 'ausente' && <span className="badge bad">Faltó</span>}
                      {e.status === 'pendiente' && <span className="badge">Todavía no llegó</span>}
                      {e.status === 'presente' && !e.lateMin && !e.earlyMin && !e.review && !e.missingOut && <span className="badge good">Bien</span>}
                      {e.lateMin > 0 && <span className="badge bad">Llegó {dur(e.lateMin)} tarde</span>}
                      {e.earlyMin > 0 && <span className="badge bad">Se fue {dur(e.earlyMin)} antes</span>}
                      {e.review && <span className="badge warn-bg">A revisar: {e.in ? 'sin salida' : 'sin entrada'}</span>}
                      {!e.review && e.missingOut && <span className="badge warn-bg">Sin salida</span>}
                      {(e.manualMarks.length > 0 || e.voidedMarks.length > 0) && <span className="badge warn-bg">✎ Corregido</span>}
                      {e.absences.map((a) => (
                        <span key={a.id} className={`badge kind-${a.kind}`} title={a.note ?? ''}>
                          {KIND_SHORT[a.kind]}
                        </span>
                      ))}
                      {e.workedSiteId !== e.siteId && e.siteId && <span className="badge">Rotó de sucursal</span>}
                    </div>
                  </td>
                  <td className="nowrap" onClick={(ev) => ev.stopPropagation()}>
                    {e.status === 'ausente' && (
                      <button className="link small" onClick={() => navigate(`/novedades?empleado=${e.employeeId}&fecha=${date}`)}>
                        Justificar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data && data.unknownCodes.length > 0 && (
        <p className="warn small">
          Hay marcaciones de legajos que no están en Personal: {data.unknownCodes.join(', ')}. Se traen desde Admin → Equipos →
          Importar personas.
        </p>
      )}
    </section>
  );
}

/**
 * Detalle del día de una persona: todas sus marcas (entrada, salida, las del medio, las cargadas a mano y las
 * anuladas) para corregirlas con motivo, y el historial de cambios de ese día. Nada se borra.
 */
function DayDetail({ row, date, onChange }: { row: Row; date: string; onChange(): void }) {
  const [f, setF] = useState({ in: '', out: '', note: '' });
  const [editing, setEditing] = useState<{ mark: Mark; mode: 'cambiar' | 'anular'; time: string; reason: string } | null>(null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const loadHistory = () =>
    api<AuditRow[]>(`/audit?employeeId=${row.employeeId}&date=${date}`)
      .then(setHistory)
      .catch(() => {});
  useEffect(() => {
    loadHistory();
  }, [row]);

  const marks = [
    row.in && { ...row.in, label: row.review ? 'Entrada sugerida' : 'Entrada' },
    ...row.otherMarks.map((m) => ({ ...m, label: 'Marca intermedia' })),
    row.out && { ...row.out, label: row.review ? 'Salida sugerida' : 'Salida' },
  ].filter((m): m is Mark & { label: string } => !!m);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
      loadHistory();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!f.in && !f.out) return setError('Poné la hora de entrada, de salida o las dos');
    const ok = await run(async () => {
      for (const time of [f.in, f.out].filter(Boolean)) {
        await api('/marks', { method: 'POST', body: JSON.stringify({ employeeId: row.employeeId, date, time, note: f.note }) });
      }
    });
    if (ok) setF({ in: '', out: '', note: '' });
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { mark, mode, time, reason } = editing;
    const ok = await run(() =>
      mode === 'cambiar'
        ? api(`/marks/${mark.id}`, { method: 'PUT', body: JSON.stringify({ time, reason }) })
        : api(`/marks/${mark.id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    );
    if (ok) setEditing(null);
  }

  const restore = (m: Mark) => run(() => api(`/marks/${m.id}/restore`, { method: 'POST', body: '{}' }));

  return (
    <section>
      <PageHeader
        crumbs={[
          { label: 'Asistencia', to: '/asistencia' },
          { label: shortDate(date), to: `/asistencia?fecha=${date}` },
          { label: row.name },
        ]}
      />
      <p className="muted small">
        {shortDate(date)}
        {row.expected ? ` · horario ${row.expected.start} a ${row.expected.end}` : ' · no le tocaba trabajar'}
        {row.workedMin > 0 && ` · ${dur(row.workedMin)} trabajadas`}
      </p>
      {row.review && (
        <p className="warn small">
          Tiene {row.in ? 'entrada pero no salida' : 'salida pero no entrada'}: la hora que se muestra es una sugerencia. Si
          se olvidó de marcar, cargá la que falta; si tenía permiso o cambio de horario, justificalo.
        </p>
      )}
      {error && <p className="error">{error}</p>}

      <ul className="list compact">
        {marks.length === 0 && <li className="muted">No hay marcas este día.</li>}
        {marks.map((m) => (
          <li key={m.id} className="card col mark">
            <div className="row">
              <span className="grow">
                {m.label}
                <div className="muted small">
                  {m.device}
                  {m.manual && m.note ? ` · ${m.note}` : ''}
                  {m.manual && m.by ? ` · ${m.by}` : ''}
                </div>
              </span>
              <strong className="times">{hhmm(m.time)}</strong>
            </div>
            {editing?.mark.id === m.id ? (
              <form className="mark-edit" onSubmit={saveEdit}>
                {editing.mode === 'cambiar' && (
                  <input
                    type="time"
                    value={editing.time}
                    onChange={(e) => setEditing({ ...editing, time: e.target.value })}
                    required
                    aria-label="Hora correcta"
                  />
                )}
                <input
                  value={editing.reason}
                  onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                  placeholder="Motivo"
                  required
                  minLength={3}
                  maxLength={300}
                  aria-label="Motivo"
                />
                <div className="actions">
                  <button type="submit" disabled={busy}>
                    {editing.mode === 'cambiar' ? 'Cambiar' : 'Anular'}
                  </button>
                  <button type="button" className="link" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </div>
              </form>
            ) : (
              <div className="actions mark-actions">
                <button className="link small" onClick={() => setEditing({ mark: m, mode: 'cambiar', time: hhmm(m.time), reason: '' })}>
                  Cambiar hora
                </button>
                <button className="link danger small" onClick={() => setEditing({ mark: m, mode: 'anular', time: '', reason: '' })}>
                  Anular
                </button>
              </div>
            )}
          </li>
        ))}
        {row.voidedMarks.map((m) => (
          <li key={m.id} className="card col mark voided">
            <div className="row">
              <span className="grow">
                Anulada
                <div className="muted small">
                  {m.device} · {m.voidReason} · {m.voidedBy}
                </div>
              </span>
              <s className="times muted">{hhmm(m.time)}</s>
            </div>
            <div className="actions mark-actions">
              <button className="link small" onClick={() => restore(m)} disabled={busy}>
                Restaurar
              </button>
            </div>
          </li>
        ))}
      </ul>

      <form className="form card col wide" onSubmit={add}>
        <strong>Agregar una marca que falta</strong>
        <div className="two">
          <label>
            Entrada
            <input type="time" value={f.in} onChange={set('in')} />
          </label>
          <label>
            Salida
            <input type="time" value={f.out} onChange={set('out')} />
          </label>
        </div>
        <label>
          Motivo
          <input value={f.note} onChange={set('note')} placeholder="Ej.: se olvidó de marcar la salida" required minLength={3} maxLength={300} />
        </label>
        <div className="actions">
          <button type="submit" disabled={busy}>
            {busy ? 'Guardando…' : 'Agregar'}
          </button>
          <Link className="button secondary" to={`/novedades?empleado=${row.employeeId}&fecha=${date}`}>
            Justificar
          </Link>
        </div>
      </form>

      <h2>Historial de cambios del día</h2>
      {history.length === 0 ? (
        <p className="muted small">Sin cambios: todo lo que se ve viene de los lectores.</p>
      ) : (
        <ul className="list compact history-list">
          {history.map((h) => (
            <li key={h.id} className="small">
              <span className="muted">
                {new Date(h.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', hour12: false })} · {h.userName}
              </span>
              <div>{h.summary}</div>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Las marcas no se borran: lo anulado queda guardado y se puede restaurar.</p>
    </section>
  );
}

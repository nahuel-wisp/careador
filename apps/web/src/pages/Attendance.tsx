import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { KIND_SHORT, shortDate, type AbsenceKind, type DaySchedule } from '../lib/schedules';

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

/** Asistencia de un día: quién vino (y si llegó tarde o se fue antes), quién faltó y quién estaba justificado. */
export function AttendancePage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Attendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sites, setSites] = useState<{ id: number; name: string }[]>([]);
  const [detail, setDetail] = useState<number | null>(null);

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

  const by = (s: Row['status']) => data?.employees.filter((e) => e.status === s) ?? [];
  const present = by('presente');
  const absent = by('ausente');
  const justified = by('novedad');
  const pending = by('pendiente');
  const off = by('libre');
  const late = present.filter((e) => e.lateMin > 0).length;
  const expectedCount = (data?.employees.length ?? 0) - off.length;
  const toReview = present.filter((e) => e.review).length;
  const open = data?.employees.find((e) => e.employeeId === detail);

  if (open) {
    return <DayDetail row={open} date={date} onChange={() => load()} onClose={() => setDetail(null)} />;
  }

  return (
    <section>
      <div className="row">
        <h1>Asistencia</h1>
        <button className="secondary" onClick={refresh} disabled={busy}>
          {busy ? 'Leyendo…' : 'Actualizar'}
        </button>
      </div>
      <input type="date" className="search" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
      {error && <p className="error">{error}</p>}
      {data && (
        <p className="muted small">
          {present.length} de {expectedCount} vinieron
          {late > 0 && ` · ${late} tarde`}
          {absent.length > 0 && ` · ${absent.length} faltaron`}
          {toReview > 0 && ` · ${toReview} a revisar`}
          {data.syncedUntil ? ` · leído de los equipos a las ${hhmm(data.syncedUntil)}` : ' · todavía no se leyeron los equipos'}
        </p>
      )}

      <ul className="list compact">
        {present.map((e) => (
          <li key={e.employeeId} className="card attendance clickable" onClick={() => setDetail(e.employeeId)}>
            <div className="grow">
              <strong>{e.name}</strong>
              <div className="badges">
                {e.lateMin > 0 && <span className="badge bad">Llegó {dur(e.lateMin)} tarde</span>}
                {e.earlyMin > 0 && <span className="badge bad">Se fue {dur(e.earlyMin)} antes</span>}
                {e.review && <span className="badge warn-bg">A revisar: {e.in ? 'sin salida' : 'sin entrada'}</span>}
                {!e.review && e.missingOut && <span className="badge warn-bg">Sin salida</span>}
                {(e.manualMarks.length > 0 || e.voidedMarks.length > 0) && <span className="badge warn-bg">✎ Corregido a mano</span>}
                {e.absences.map((a) => (
                  <span key={a.id} className={`badge kind-${a.kind}`} title={a.note ?? ''}>
                    {KIND_SHORT[a.kind]}
                  </span>
                ))}
                {e.workedSiteId !== e.siteId && (
                  <span className="badge">En {sites.find((s) => s.id === e.workedSiteId)?.name ?? 'otra sucursal'}</span>
                )}
                {e.otherMarks.length > 0 && (
                  <span className="muted small">
                    +{e.otherMarks.length} {e.otherMarks.length === 1 ? 'marca' : 'marcas'} en el día
                  </span>
                )}
              </div>
            </div>
            <div className="times-col">
              <div className="times">
                <span title={e.in?.device} className={e.review && e.in ? 'guess' : ''}>{e.in ? hhmm(e.in.time) : '?'}</span>
                <span className="muted">→</span>
                <span title={e.out?.device} className={e.review && e.out ? 'guess' : ''}>{e.out ? hhmm(e.out.time) : '?'}</span>
              </div>
              {e.expected && (
                <div className="muted small">
                  {e.expected.start}–{e.expected.end}
                  {e.workedMin > 0 && ` · ${dur(e.workedMin)}`}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {absent.length > 0 && (
        <>
          <h2>Faltaron</h2>
          <ul className="list compact">
            {absent.map((e) => (
              <li key={e.employeeId} className="card attendance">
                <div className="grow">
                  <strong>{e.name}</strong>
                  <div className="muted small">
                    Entraba {e.expected?.start}
                    {e.absences.map((a) => ` · ${KIND_SHORT[a.kind]}`)}
                  </div>
                </div>
                <div className="actions">
                  <button className="secondary small-btn" onClick={() => setDetail(e.employeeId)}>
                    Corregir
                  </button>
                  <Link className="button secondary small-btn" to={`/novedades?empleado=${e.employeeId}&fecha=${date}`}>
                    Justificar
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {pending.length > 0 && (
        <>
          <h2>Todavía no llegaron</h2>
          <ul className="list compact">
            {pending.map((e) => (
              <li key={e.employeeId} className="card attendance muted">
                {e.name}
                <span className="small">entra {e.expected?.start}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {justified.length > 0 && (
        <>
          <h2>Con novedad</h2>
          <ul className="list compact">
            {justified.map((e) => (
              <li key={e.employeeId} className="card attendance">
                <span className="grow">{e.name}</span>
                <span className="badges">
                  {e.absences.map((a) => (
                    <span key={a.id} className={`badge kind-${a.kind}`} title={a.note ?? ''}>
                      {KIND_SHORT[a.kind]}
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {off.length > 0 && (
        <p className="muted small">
          No les tocaba trabajar: {off.map((e) => e.name).join(' · ')}
          {off.some((e) => !e.schedule) && '. Los que no tienen horario se configuran en Horarios.'}
        </p>
      )}

      <HistoryImport onDone={() => load()} />

      {data && data.unknownCodes.length > 0 && (
        <p className="warn small">
          Hay marcaciones de legajos que no están en Personal: {data.unknownCodes.join(', ')}. Usá «Importar personas» en
          Equipos para traerlos.
        </p>
      )}
    </section>
  );
}

interface ImportResult {
  days: number;
  inserted: number;
  from: string;
  to: string;
  unmatched: { name: string; days: number }[];
}

/** Sube el Excel «Registros de entradas y salidas» de HikCentral para traer el historial. */
function HistoryImport({ onDone }: { onDone(): void }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api<ImportResult>('/history/hikcentral', {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
      setResult(r);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo importar');
    }
    setBusy(false);
  }

  return (
    <div className="card col history">
      <strong>Historial de HikCentral</strong>
      <p className="muted small">
        El Excel «Registros de entradas y salidas» que exporta HikCentral, del período que quieras. Subirlo de nuevo no
        duplica nada.
      </p>
      <label className="button secondary">
        {busy ? 'Importando…' : 'Subir Excel de HikCentral'}
        <input type="file" accept=".xlsx" hidden disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
      </label>
      {error && <p className="error small">{error}</p>}
      {result && (
        <p className="small">
          <span className="ok">
            ✓ {result.days} días del {shortDate(result.from)} al {shortDate(result.to)}: {result.inserted} marcas nuevas.
          </span>
          {result.unmatched.length > 0 && (
            <span className="muted">
              {' '}
              Todavía no están en Personal: {result.unmatched.map((u) => u.name).join(', ')}. Sus marcas quedan
              guardadas y se les asignan cuando se carguen.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Detalle del día de una persona: todas sus marcas (entrada, salida, las del medio, las cargadas a mano y las
 * anuladas) para corregirlas con motivo, y el historial de cambios de ese día. Nada se borra.
 */
function DayDetail({ row, date, onChange, onClose }: { row: Row; date: string; onChange(): void; onClose(): void }) {
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
      <div className="row">
        <h1>{row.name}</h1>
      </div>
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
          <button type="button" className="link" onClick={onClose}>
            Volver
          </button>
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

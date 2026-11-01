import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { KIND_SHORT, shortDate, type AbsenceKind, type DaySchedule } from '../lib/schedules';

interface Mark {
  time: string;
  device?: string;
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
  workedMin: number;
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
          {data.syncedUntil ? ` · leído de los equipos a las ${hhmm(data.syncedUntil)}` : ' · todavía no se leyeron los equipos'}
        </p>
      )}

      <ul className="list compact">
        {present.map((e) => (
          <li key={e.employeeId} className="card attendance">
            <div className="grow">
              <strong>{e.name}</strong>
              <div className="badges">
                {e.lateMin > 0 && <span className="badge bad">Llegó {dur(e.lateMin)} tarde</span>}
                {e.earlyMin > 0 && <span className="badge bad">Se fue {dur(e.earlyMin)} antes</span>}
                {e.missingOut && <span className="badge warn-bg">Sin salida</span>}
                {e.missingIn && <span className="badge warn-bg">Sin entrada</span>}
                {e.absences.map((a) => (
                  <span key={a.id} className={`badge kind-${a.kind}`} title={a.note ?? ''}>
                    {KIND_SHORT[a.kind]}
                  </span>
                ))}
                {e.workedSiteId !== e.siteId && (
                  <span className="badge">En {sites.find((s) => s.id === e.workedSiteId)?.name ?? 'otra sucursal'}</span>
                )}
                {e.marks > 2 && <span className="muted small">{e.marks} marcas</span>}
              </div>
            </div>
            <div className="times-col">
              <div className="times">
                <span title={e.in?.device}>{e.in ? hhmm(e.in.time) : '–'}</span>
                <span className="muted">→</span>
                <span title={e.out?.device}>{e.out ? hhmm(e.out.time) : '–'}</span>
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
                <Link className="button secondary small-btn" to={`/novedades?empleado=${e.employeeId}&fecha=${date}`}>
                  Justificar
                </Link>
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
        El Excel «Registros de entradas y salidas» que exporta HikCentral (el mismo informe de siempre), del período
        que quieras. Subirlo de nuevo o con meses que se pisan no duplica nada.
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
              guardadas y se les asignan solas cuando los cargues (o los importes de un equipo).
            </span>
          )}
        </p>
      )}
    </div>
  );
}

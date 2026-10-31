import { useEffect, useState } from 'react';
import { api } from '../api';

interface Mark {
  time: string;
  device?: string;
}

interface Row {
  employeeId: number;
  code: string;
  name: string;
  marks: number;
  in: Mark | null;
  out: Mark | null;
}

interface Attendance {
  employees: Row[];
  unknownCodes: string[];
  syncedUntil: string | null;
}

const today = () => new Date().toLocaleDateString('sv'); // AAAA-MM-DD en hora local
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Asistencia de un día: quién entró y salió, y quién no marcó. */
export function AttendancePage() {
  const [date, setDate] = useState(today());
  const [data, setData] = useState<Attendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const present = data?.employees.filter((e) => e.in) ?? [];
  const absent = data?.employees.filter((e) => !e.in) ?? [];

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
          {present.length} de {data.employees.length} marcaron
          {data.syncedUntil ? ` · leído de los equipos a las ${hhmm(data.syncedUntil)}` : ' · todavía no se leyeron los equipos'}
        </p>
      )}

      <ul className="list compact">
        {present.map((e) => (
          <li key={e.employeeId} className="card attendance">
            <div className="grow">
              <strong>{e.name}</strong>
              {e.marks > 2 && <div className="muted small">{e.marks} marcaciones</div>}
            </div>
            <div className="times">
              <span title={e.in?.device}>{hhmm(e.in!.time)}</span>
              <span className="muted">→</span>
              <span title={e.out?.device}>{e.out ? hhmm(e.out.time) : <span className="warn">sin salida</span>}</span>
            </div>
          </li>
        ))}
      </ul>

      {absent.length > 0 && (
        <>
          <h2>No marcaron</h2>
          <ul className="list compact">
            {absent.map((e) => (
              <li key={e.employeeId} className="card attendance muted">
                {e.name}
              </li>
            ))}
          </ul>
        </>
      )}

      {data && data.unknownCodes.length > 0 && (
        <p className="warn small">
          Hay marcaciones de legajos que no están en Personal: {data.unknownCodes.join(', ')}. Usá «Importar personas» en
          Equipos para traerlos.
        </p>
      )}
    </section>
  );
}

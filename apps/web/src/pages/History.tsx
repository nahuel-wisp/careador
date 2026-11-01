import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';

interface AuditRow {
  id: number;
  at: string;
  userName: string;
  summary: string;
  employee: string | null;
  date: string | null;
}

/** Todo lo que se cambió en la app: quién, cuándo y qué (los últimos 200). */
export function HistoryPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<AuditRow[]>('/audit?limit=200')
      .then(setRows)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section>
      <div className="row">
        <h1>Historial de cambios</h1>
        <Link className="button secondary" to="/reportes">
          Volver
        </Link>
      </div>
      <p className="muted small">
        Correcciones de marcas, novedades, horarios, personal y equipos. No se puede editar ni borrar.
      </p>
      {error && <p className="error">{error}</p>}
      {rows?.length === 0 && <p className="muted">Todavía no hubo cambios.</p>}
      <ul className="list compact history-list">
        {rows?.map((h) => (
          <li key={h.id} className="small">
            <span className="muted">
              {new Date(h.at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', hour12: false })} · {h.userName}
            </span>
            <div>
              {h.employee && <strong>{h.employee}: </strong>}
              {h.summary}
              {h.date && <span className="muted"> (día {h.date.split('-').reverse().join('/')})</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

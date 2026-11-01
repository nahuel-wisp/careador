import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { shortDate } from '../lib/schedules';

/** Herramientas del administrador que no son del uso diario. */
export function ImportPage() {
  return (
    <section>
      <div className="row">
        <h1>Importar historial</h1>
        <Link className="button secondary" to="/cuenta">
          Volver
        </Link>
      </div>
      <HistoryImport />
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
function HistoryImport() {
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


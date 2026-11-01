import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../ui';
import { AdminHeader } from './Admin';

interface Item {
  id: number;
  at: string;
  userName: string;
  kind: 'sugerencia' | 'error';
  text: string;
  page: string | null;
  status: 'nuevo' | 'visto' | 'resuelto';
  reply: string | null;
}

const STATUS = { nuevo: 'Nuevo', visto: 'Visto', resuelto: 'Resuelto' };
const when = (iso: string) => new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short', hour12: false });

/** Mandar una sugerencia o avisar un error; abajo, lo que ya mandó uno y qué le respondieron. */
export function FeedbackPage() {
  const from = (useLocation().state as { from?: string } | null)?.from ?? null;
  const [kind, setKind] = useState<Item['kind']>('sugerencia');
  const [text, setText] = useState('');
  const [mine, setMine] = useState<Item[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => api<Item[]>('/feedback/mine').then(setMine).catch(() => {});
  useEffect(() => {
    load();
  }, []);

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api('/feedback', { method: 'POST', body: JSON.stringify({ kind, text, page: from }) });
      setText('');
      setMsg({ ok: true, text: '✓ Enviado. Gracias.' });
      load();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'No se pudo enviar' });
    }
    setBusy(false);
  }

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Sugerencias y errores' }]} />
      <form className="panel form wide" onSubmit={send} style={{ maxWidth: 640 }}>
        <div className="actions">
          <label className="check">
            <input type="radio" name="kind" checked={kind === 'sugerencia'} onChange={() => setKind('sugerencia')} />
            Sugerencia
          </label>
          <label className="check">
            <input type="radio" name="kind" checked={kind === 'error'} onChange={() => setKind('error')} />
            Algo anda mal
          </label>
        </div>
        <label>
          {kind === 'error' ? 'Qué pasó y qué esperabas que pasara' : 'Qué te gustaría que haga la app'}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} required minLength={3} />
        </label>
        {msg && <p className={msg.ok ? 'ok small' : 'error small'}>{msg.text}</p>}
        <div className="actions">
          <button type="submit" disabled={busy}>
            Enviar
          </button>
        </div>
      </form>

      {mine.length > 0 && (
        <>
          <h2>Lo que mandé</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Mensaje</th>
                  <th>Estado</th>
                  <th>Respuesta</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">{when(m.at)}</td>
                    <td>{m.kind === 'error' ? 'Error' : 'Sugerencia'}</td>
                    <td>{m.text}</td>
                    <td>
                      <span className={m.status === 'resuelto' ? 'badge good' : 'badge'}>{STATUS[m.status]}</span>
                    </td>
                    <td className="muted">{m.reply}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Bandeja del administrador: todo lo que mandaron, con estado y respuesta. */
export function InboxPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    api<Item[]>('/feedback')
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function update(i: Item, body: Partial<Pick<Item, 'status' | 'reply'>>) {
    await api(`/feedback/${i.id}`, { method: 'PATCH', body: JSON.stringify(body) }).catch((e: Error) => setError(e.message));
    load();
  }

  const visible = items?.filter((i) => showDone || i.status !== 'resuelto') ?? [];
  const done = items?.filter((i) => i.status === 'resuelto').length ?? 0;

  return (
    <section>
      <AdminHeader title="Bandeja">
        {done > 0 && (
          <button className="link" onClick={() => setShowDone(!showDone)}>
            {showDone ? 'Ocultar resueltos' : `Ver resueltos: ${done}`}
          </button>
        )}
      </AdminHeader>
      {error && <p className="error">{error}</p>}
      {items && visible.length === 0 && <p className="muted">No hay mensajes pendientes.</p>}
      {visible.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>De</th>
                <th>Tipo</th>
                <th>Mensaje</th>
                <th>Pantalla</th>
                <th>Estado</th>
                <th>Respuesta</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((i) => (
                <tr key={i.id}>
                  <td className="nowrap">{when(i.at)}</td>
                  <td className="nowrap">{i.userName}</td>
                  <td>{i.kind === 'error' ? <span className="badge bad">Error</span> : <span className="badge">Sugerencia</span>}</td>
                  <td>{i.text}</td>
                  <td className="muted small">{i.page}</td>
                  <td>
                    <select value={i.status} onChange={(e) => update(i, { status: e.target.value as Item['status'] })} aria-label="Estado">
                      <option value="nuevo">Nuevo</option>
                      <option value="visto">Visto</option>
                      <option value="resuelto">Resuelto</option>
                    </select>
                  </td>
                  <td>
                    <input
                      defaultValue={i.reply ?? ''}
                      placeholder="Responder"
                      onBlur={(e) => e.target.value !== (i.reply ?? '') && update(i, { reply: e.target.value || null })}
                      aria-label="Respuesta"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

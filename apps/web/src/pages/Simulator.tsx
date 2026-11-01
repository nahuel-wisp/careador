import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { prepareFaceJpeg } from '../lib/image';

interface SimPerson {
  id: string;
  name: string;
  enabled: boolean;
  hasFace: boolean;
}

interface SimEvent {
  deviceEventId: string;
  time: string;
  kind: 'access_granted' | 'access_denied' | 'door' | 'device' | 'other';
  personId?: string;
  personName?: string;
}

interface SimState {
  device: { id: number; name: string };
  serial: string;
  clock: string;
  persons: SimPerson[];
  recentEvents: SimEvent[];
}

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Pantalla que imita el lector: tocar una persona = pararse frente al equipo. */
export function SimulatorPage() {
  const { id } = useParams();
  const [state, setState] = useState<SimState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<SimEvent | null>(null);
  const [customTime, setCustomTime] = useState('');
  const [adding, setAdding] = useState(false);
  // Version para invalidar el caché de las fotos cuando se reemplazan.
  const [photoVersion, setPhotoVersion] = useState(0);

  const load = useCallback(
    () =>
      api<SimState>(`/simulador/${id}`)
        .then(setState)
        .catch((e: Error) => setError(e.message)),
    [id],
  );

  useEffect(() => {
    load();
    // Refresca para ver cambios que hace la app (altas, bajas, fotos).
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function mark(personId?: string) {
    const body: Record<string, string> = {};
    if (personId) body.personId = personId;
    if (customTime) body.at = new Date(customTime).toISOString();
    try {
      const ev = await api<SimEvent>(`/simulador/${id}/marcar`, { method: 'POST', body: JSON.stringify(body) });
      setFlash(ev);
      setTimeout(() => setFlash(null), 1800);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function uploadFace(personId: string, file: File) {
    try {
      const jpeg = await prepareFaceJpeg(file);
      const res = await fetch(`/api/simulador/${id}/cara/${encodeURIComponent(personId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg' },
        body: jpeg,
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Error al subir la foto');
      setPhotoVersion((v) => v + 1);
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function removePerson(p: SimPerson) {
    if (!confirm(`¿Borrar a ${p.name} del simulador?`)) return;
    await api(`/simulador/${id}/personas/${encodeURIComponent(p.id)}`, { method: 'DELETE' });
    load();
  }

  if (!state) return <section className="sim">{error ? <p className="error">{error}</p> : <p className="muted">Cargando…</p>}</section>;

  return (
    <section className="sim">
      <div className="row">
        <Link to="/equipos" className="link">
          ‹ Equipos
        </Link>
        <span className="muted">{state.serial}</span>
      </div>

      <div className="sim-screen">
        <div className="sim-clock">{new Date(state.clock).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}</div>
        <div className="sim-name">{state.device.name}</div>
        {flash ? (
          <div className={flash.kind === 'access_granted' ? 'sim-result ok-bg' : 'sim-result error-bg'}>
            {flash.kind === 'access_granted' ? `✓ ${flash.personName}` : '✗ No reconocido'}
          </div>
        ) : (
          <div className="sim-result muted">Tocá una persona para simular que se para frente al lector</div>
        )}
      </div>

      {error && (
        <p className="error" onClick={() => setError(null)}>
          {error}
        </p>
      )}

      <label className="form">
        <span className="muted">Hora de la marcación</span>
        <input type="datetime-local" value={customTime} onChange={(e) => setCustomTime(e.target.value)} />
      </label>

      <div className="sim-grid">
        {state.persons.map((p) => (
          <div key={p.id} className="sim-person">
            <button className="sim-face" onClick={() => mark(p.id)} title="Marcar">
              {p.hasFace ? (
                <img src={`/api/simulador/${id}/cara/${encodeURIComponent(p.id)}?v=${photoVersion}`} alt="" />
              ) : (
                <span>Sin foto</span>
              )}
            </button>
            <div className="sim-person-name">{p.name}</div>
            <div className="muted small">#{p.id}</div>
            <div className="actions small">
              <label className="link">
                Foto
                <input
                  type="file"
                  accept="image/*"
                  capture="user"
                  hidden
                  onChange={(e) => e.target.files?.[0] && uploadFace(p.id, e.target.files[0])}
                />
              </label>
              <button className="link danger" onClick={() => removePerson(p)}>
                Borrar
              </button>
            </div>
          </div>
        ))}
        <div className="sim-person">
          <button className="sim-face unknown" onClick={() => mark()}>
            <span>?</span>
          </button>
          <div className="sim-person-name">Cara desconocida</div>
        </div>
      </div>

      {adding ? (
        <AddPerson
          deviceId={id!}
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      ) : (
        <button className="secondary" onClick={() => setAdding(true)}>
          Enrolar persona en el lector
        </button>
      )}

      <h2>Últimos eventos</h2>
      <ul className="list compact">
        {state.recentEvents.map((e) => (
          <li key={e.deviceEventId} className="event">
            <span className={e.kind === 'access_granted' ? 'ok' : e.kind === 'access_denied' ? 'error' : 'muted'}>
              {e.kind === 'access_granted' ? '✓' : e.kind === 'access_denied' ? '✗' : '•'}
            </span>
            <span>{fmtTime(e.time)}</span>
            <span>{e.personName ?? (e.kind === 'door' ? 'Apertura remota' : 'Desconocido')}</span>
          </li>
        ))}
        {state.recentEvents.length === 0 && <li className="muted">Sin eventos todavía.</li>}
      </ul>
    </section>
  );
}

function AddPerson({ deviceId, onDone }: { deviceId: string; onDone(): void }) {
  const [personId, setPersonId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/simulador/${deviceId}/personas`, { method: 'POST', body: JSON.stringify({ id: personId, name }) });
      const file = fileRef.current?.files?.[0];
      if (file) {
        const jpeg = await prepareFaceJpeg(file);
        await fetch(`/api/simulador/${deviceId}/cara/${encodeURIComponent(personId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: jpeg,
        });
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="form card col" onSubmit={submit}>
      <p className="muted small">
        Alta directa en el lector simulado, como desde la pantalla del equipo. Las altas normales se hacen desde
        Personal.
      </p>
      <label>
        Número de empleado
        <input value={personId} onChange={(e) => setPersonId(e.target.value)} inputMode="numeric" required />
      </label>
      <label>
        Nombre
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Foto
        <input ref={fileRef} type="file" accept="image/*" capture="user" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit">Enrolar</button>
        <button type="button" className="link" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

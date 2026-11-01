import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';

interface AppUser {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'manager';
  active: boolean;
  mustChangePassword: boolean;
}

const ROLE = { admin: 'Administrador', manager: 'Encargado' };

/** Usuarios de la app (sólo administradores). Las contraseñas que se ponen acá son provisorias. */
export function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AppUser | null>(null);
  const [showInactive, setShowInactive] = useState(false);

  const load = () =>
    api<AppUser[]>('/users')
      .then(setUsers)
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  async function patch(u: AppUser, body: Partial<AppUser>, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setError(null);
    await api(`/users/${u.id}`, { method: 'PATCH', body: JSON.stringify(body) }).catch((e: Error) => setError(e.message));
    load();
  }

  function rename(u: AppUser) {
    const next = prompt(`Nuevo usuario para ${u.name} (sin espacios, ej.: ${u.name.split(' ')[0]!.toLowerCase()})`, u.username);
    if (next && next.trim().toLowerCase() !== u.username) patch(u, { username: next.trim().toLowerCase() });
  }

  const visible = users?.filter((u) => u.active !== showInactive) ?? [];
  const inactive = users?.filter((u) => !u.active).length ?? 0;

  return (
    <section>
      <div className="row">
        <h1>Usuarios</h1>
        {!adding && <button onClick={() => setAdding(true)}>Agregar</button>}
      </div>
      <p className="muted small">
        Encargado: Personal, Asistencia, Novedades, Horarios y Reportes. Administrador: además Equipos y Usuarios. La
        contraseña que pongas es provisoria: la persona la cambia al entrar.
      </p>
      {error && <p className="error">{error}</p>}
      {adding && (
        <UserForm
          onDone={() => {
            setAdding(false);
            load();
          }}
        />
      )}
      {resetting && (
        <ResetForm
          user={resetting}
          onDone={() => {
            setResetting(null);
            load();
          }}
        />
      )}
      <ul className="list">
        {visible.map((u) => (
          <li key={u.id} className="card col">
            <div>
              <strong>{u.name}</strong>
              {u.id === me?.id && <span className="muted small"> (vos)</span>}
              <div className="muted small">
                usuario «{u.username}» · {ROLE[u.role]}
              </div>
              {u.mustChangePassword && <div className="tag">Contraseña provisoria</div>}
            </div>
            <div className="actions">
              <button className="secondary small-btn" onClick={() => setResetting(u)}>
                Nueva contraseña
              </button>
              <button className="link small" onClick={() => rename(u)}>
                Cambiar usuario
              </button>
              {u.id !== me?.id && (
                <>
                  <select
                    value={u.role}
                    onChange={(e) => patch(u, { role: e.target.value as AppUser['role'] })}
                    aria-label={`Rol de ${u.name}`}
                  >
                    <option value="manager">Encargado</option>
                    <option value="admin">Administrador</option>
                  </select>
                  {u.active ? (
                    <button
                      className="link danger"
                      onClick={() => patch(u, { active: false }, `¿Desactivar a ${u.name}? No va a poder entrar y se cierran sus sesiones.`)}
                    >
                      Desactivar
                    </button>
                  ) : (
                    <button className="link" onClick={() => patch(u, { active: true })}>
                      Reactivar
                    </button>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {inactive > 0 && (
        <button className="link" onClick={() => setShowInactive(!showInactive)}>
          {showInactive ? 'Ver activos' : `Ver desactivados (${inactive})`}
        </button>
      )}
    </section>
  );
}

function UserForm({ onDone }: { onDone(): void }) {
  const [f, setF] = useState({ name: '', username: '', role: 'manager', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/users', { method: 'POST', body: JSON.stringify(f) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear');
      setBusy(false);
    }
  }

  return (
    <form className="form card col wide" onSubmit={submit}>
      <label>
        Nombre
        <input value={f.name} onChange={set('name')} required autoComplete="off" />
      </label>
      <label>
        Usuario (para entrar; sin espacios, ej.: pilar)
        <input
          value={f.username}
          onChange={set('username')}
          required
          minLength={3}
          pattern="[A-Za-z0-9._@\-]+"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label>
        Rol
        <select value={f.role} onChange={set('role')}>
          <option value="manager">Encargado (dueños)</option>
          <option value="admin">Administrador</option>
        </select>
      </label>
      <label>
        Contraseña provisoria (al menos 10 caracteres; se la pasás y la cambia al entrar)
        <input value={f.password} onChange={set('password')} minLength={10} required autoComplete="off" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Creando…' : 'Crear usuario'}
        </button>
        <button type="button" className="link" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

function ResetForm({ user, onDone }: { user: AppUser; onDone(): void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/users/${user.id}/password`, { method: 'POST', body: JSON.stringify({ password }) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar');
      setBusy(false);
    }
  }

  return (
    <form className="form card col wide" onSubmit={submit}>
      <strong>Nueva contraseña para {user.name}</strong>
      <p className="muted small">Es provisoria: se cierran sus sesiones y la tiene que cambiar al entrar.</p>
      <label>
        Contraseña provisoria
        <input value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required autoComplete="off" />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          Guardar
        </button>
        <button type="button" className="link" onClick={onDone}>
          Cancelar
        </button>
      </div>
    </form>
  );
}

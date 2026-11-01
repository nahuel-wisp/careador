import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useAuth, type User } from '../auth';

/** Cambiar la propia contraseña. Con `forced` es la única pantalla (contraseña provisoria). */
export function ChangePassword({ forced = false, onDone }: { forced?: boolean; onDone?(): void }) {
  const { setUser, logout } = useAuth();
  const [f, setF] = useState({ current: '', next: '', again: '' });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (f.next !== f.again) return setError('Las dos contraseñas nuevas no coinciden');
    setBusy(true);
    setError(null);
    try {
      const u = await api<User>('/auth/password', { method: 'POST', body: JSON.stringify({ current: f.current, next: f.next }) });
      setF({ current: '', next: '', again: '' });
      setOk(true);
      setUser(u);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar');
    }
    setBusy(false);
  }

  return (
    <form className={forced ? 'form' : 'form card col wide'} onSubmit={submit}>
      {forced ? (
        <p className="muted">
          Tu contraseña es provisoria. Elegí una nueva de al menos 10 caracteres para empezar a usar la app.
        </p>
      ) : (
        <strong>Cambiar mi contraseña</strong>
      )}
      <label>
        {forced ? 'Contraseña provisoria' : 'Contraseña actual'}
        <input type="password" autoComplete="current-password" value={f.current} onChange={set('current')} required />
      </label>
      <label>
        Contraseña nueva
        <input type="password" autoComplete="new-password" value={f.next} onChange={set('next')} minLength={10} required />
      </label>
      <label>
        Repetir la nueva
        <input type="password" autoComplete="new-password" value={f.again} onChange={set('again')} minLength={10} required />
      </label>
      {error && <p className="error">{error}</p>}
      {ok && !forced && <p className="ok">✓ Contraseña cambiada. Se cerraron tus otras sesiones.</p>}
      <div className="actions">
        <button type="submit" disabled={busy}>
          {busy ? 'Guardando…' : 'Cambiar contraseña'}
        </button>
        {forced && (
          <button type="button" className="link" onClick={logout}>
            Salir
          </button>
        )}
      </div>
    </form>
  );
}

/** Pantalla obligatoria mientras la contraseña sea provisoria. */
export function ForcedPasswordPage() {
  const { user } = useAuth();
  return (
    <main className="login">
      <img src="/icon.svg" alt="" width={72} height={72} />
      <h1>Hola, {user?.name}</h1>
      <ChangePassword forced />
    </main>
  );
}

/** Mi cuenta: datos, cambio de contraseña y (admin) accesos a Usuarios e Historial. */
export function AccountPage() {
  const { user, logout } = useAuth();
  if (!user) return null;
  return (
    <section>
      <h1>Mi cuenta</h1>
      <p className="muted">
        {user.name} · usuario «{user.username}» · {user.role === 'admin' ? 'administrador' : 'encargado'}
      </p>
      {user.role === 'admin' && (
        <div className="actions">
          <Link className="button secondary" to="/usuarios">
            Usuarios
          </Link>
          <Link className="button secondary" to="/historial">
            Historial de cambios
          </Link>
          <Link className="button secondary" to="/importar">
            Importar historial de HikCentral
          </Link>
        </div>
      )}
      <ChangePassword />
      <button className="link danger" onClick={logout}>
        Salir de la app
      </button>
    </section>
  );
}

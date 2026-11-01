import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth, type User } from '../auth';
import { PageHeader } from '../ui';

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
    <form className={forced ? 'form' : 'panel form wide'} onSubmit={submit}>
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

/** Mi cuenta: datos personales y de contacto, contraseña y salir. */
export function AccountPage() {
  const { user, logout, setUser } = useAuth();
  const [f, setF] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', contactEmail: user?.contactEmail ?? '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const u = await api<User>('/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: f.name, phone: f.phone || null, contactEmail: f.contactEmail || '' }),
      });
      setUser(u);
      setMsg({ ok: true, text: '✓ Datos guardados' });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'No se pudo guardar' });
    }
    setBusy(false);
  }

  return (
    <section>
      <PageHeader crumbs={[{ label: 'Mi cuenta' }]}>
        <button className="link danger" onClick={logout}>
          Salir de la app
        </button>
      </PageHeader>
      <div className="admin-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', alignItems: 'start' }}>
        <form className="panel form wide" onSubmit={save}>
          <strong>Mis datos</strong>
          <label>
            Nombre
            <input value={f.name} onChange={set('name')} required />
          </label>
          <label>
            Usuario
            <input value={user.username} disabled />
          </label>
          <label>
            Teléfono
            <input value={f.phone} onChange={set('phone')} inputMode="tel" />
          </label>
          <label>
            Email de contacto
            <input type="email" value={f.contactEmail} onChange={set('contactEmail')} />
          </label>
          {msg && <p className={msg.ok ? 'ok small' : 'error small'}>{msg.text}</p>}
          <div className="actions">
            <button type="submit" disabled={busy}>
              Guardar
            </button>
            <span className="muted small">{user.role === 'admin' ? 'Administrador' : 'Operador'}</span>
          </div>
        </form>
        <ChangePassword />
      </div>
    </section>
  );
}

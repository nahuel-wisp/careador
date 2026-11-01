import { Link } from 'react-router';

const SECTIONS = [
  { to: '/equipos', icon: '📟', title: 'Equipos', text: 'Lectores, conexión, sólo lectura y personas cargadas.' },
  { to: '/usuarios', icon: '👥', title: 'Usuarios', text: 'Quién entra a la app, con qué rol y contraseña.' },
  { to: '/importar', icon: '📥', title: 'Importar historial', text: 'Marcaciones viejas desde el Excel de HikCentral.' },
  { to: '/historial', icon: '🧾', title: 'Historial de cambios', text: 'Quién cambió qué y cuándo.' },
];

/** Administración: lo que no es del uso diario de los encargados. */
export function AdminPage() {
  return (
    <section>
      <h1>Administración</h1>
      <ul className="list">
        {SECTIONS.map((s) => (
          <li key={s.to}>
            <Link className="card person admin-link" to={s.to}>
              <span className="admin-icon" aria-hidden>
                {s.icon}
              </span>
              <div className="grow">
                <strong>{s.title}</strong>
                <div className="muted small">{s.text}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Título de una página de Administración con su vuelta. */
export function AdminHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="row">
      <h1>{title}</h1>
      <div className="actions">
        {children}
        <Link className="link" to="/admin">
          Volver
        </Link>
      </div>
    </div>
  );
}

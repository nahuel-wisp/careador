import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageHeader } from '../ui';

const SECTIONS = [
  { to: '/equipos', icon: '📟', title: 'Equipos', text: 'Lectores, conexión, sólo lectura y personas cargadas.' },
  { to: '/usuarios', icon: '👥', title: 'Usuarios', text: 'Quién entra a la app, con qué rol y contraseña.' },
  { to: '/importar', icon: '📥', title: 'Importar historial', text: 'Marcaciones viejas desde el Excel de HikCentral.' },
  { to: '/historial', icon: '🧾', title: 'Historial de cambios', text: 'Quién cambió qué y cuándo.' },
  { to: '/bandeja', icon: '📬', title: 'Bandeja', text: 'Sugerencias y errores que mandan los usuarios.' },
];

/** Administración: lo que no es del uso diario de los operadores. */
export function AdminPage() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    api<{ status: string }[]>('/feedback')
      .then((r) => setPending(r.filter((i) => i.status === 'nuevo').length))
      .catch(() => {});
  }, []);
  return (
    <section>
      <PageHeader crumbs={[{ label: 'Admin' }]} />
      <div className="admin-grid">
        {SECTIONS.map((s) => (
          <Link key={s.to} className="card admin-link" to={s.to}>
            <span className="admin-icon" aria-hidden>
              {s.icon}
            </span>
            <div className="grow">
              <strong>
                {s.title}
                {s.to === '/bandeja' && pending > 0 && <span className="badge bad"> {pending} nuevos</span>}
              </strong>
              <div className="muted small">{s.text}</div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Encabezado de una pantalla de Admin: «Admin › Título» y sus acciones. */
export function AdminHeader({ title, children }: { title: string; children?: ReactNode }) {
  return <PageHeader crumbs={[{ label: 'Admin', to: '/admin' }, { label: title }]}>{children}</PageHeader>;
}

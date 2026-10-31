import { NavLink, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { DevicesPage } from './pages/Devices';
import { LoginPage } from './pages/Login';
import { Placeholder } from './pages/Placeholder';

const tabs = [
  { to: '/', label: 'Personal', icon: '👤' },
  { to: '/horarios', label: 'Horarios', icon: '🕒' },
  { to: '/reportes', label: 'Reportes', icon: '📊' },
  { to: '/equipos', label: 'Equipos', icon: '📟' },
];

export function App() {
  const { user, loading, logout } = useAuth();
  if (loading) return null;
  if (!user) return <LoginPage />;

  return (
    <div className="app">
      <header className="topbar">
        <span className="muted">{user.name}</span>
        <button className="link" onClick={logout}>
          Salir
        </button>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<Placeholder title="Personal" text="Altas, bajas y foto facial desde el celular." />} />
          <Route path="/horarios" element={<Placeholder title="Horarios" text="Turnos por sucursal y por empleado." />} />
          <Route path="/reportes" element={<Placeholder title="Reportes" text="Asistencia y horas en Excel." />} />
          <Route path="/equipos" element={<DevicesPage />} />
        </Routes>
      </main>
      <nav className="tabbar">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
            <span aria-hidden>{t.icon}</span>
            <span>{t.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

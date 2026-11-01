import { NavLink, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { EntornoBanner, EntornoProvider, useEntorno } from './entorno';
import { AbsencesPage } from './pages/Absences';
import { AttendancePage } from './pages/Attendance';
import { DevicesPage } from './pages/Devices';
import { LoginPage } from './pages/Login';
import { PersonalPage } from './pages/Personal';
import { SchedulesPage } from './pages/Schedules';
import { SimulatorPage } from './pages/Simulator';

const tabs = [
  { to: '/', label: 'Personal', icon: '👤' },
  { to: '/asistencia', label: 'Asistencia', icon: '📋' },
  { to: '/novedades', label: 'Novedades', icon: '🗓️' },
  { to: '/horarios', label: 'Horarios', icon: '🕒' },
  { to: '/equipos', label: 'Equipos', icon: '📟' },
];

export function App() {
  const { user, loading, logout } = useAuth();
  if (loading) return null;
  if (!user) return <LoginPage />;

  return (
    <EntornoProvider>
    <div className="app">
      <EntornoBanner />
      <header className="topbar">
        <Brand />
        <span className="muted small">{user.name}</span>
        <button className="link small" onClick={logout}>
          Salir
        </button>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<PersonalPage />} />
          <Route path="/horarios" element={<SchedulesPage />} />
          <Route path="/novedades" element={<AbsencesPage />} />
          <Route path="/asistencia" element={<AttendancePage />} />
          <Route path="/equipos" element={<DevicesPage />} />
          <Route path="/simulador/:id" element={<SimulatorPage />} />
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
    </EntornoProvider>
  );
}

function Brand() {
  const empresa = useEntorno()?.empresa;
  return <span className="brand">Fichada{empresa ? ` · ${empresa}` : ''}</span>;
}

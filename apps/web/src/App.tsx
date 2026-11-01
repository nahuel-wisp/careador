import { Link, NavLink, Route, Routes } from 'react-router';
import { useAuth } from './auth';
import { EntornoBanner, EntornoProvider, useEntorno } from './entorno';
import { AbsencesPage } from './pages/Absences';
import { AccountPage, ForcedPasswordPage } from './pages/Account';
import { AttendancePage } from './pages/Attendance';
import { DevicesPage } from './pages/Devices';
import { HistoryPage } from './pages/History';
import { LoginPage } from './pages/Login';
import { PersonalPage } from './pages/Personal';
import { ReportsPage } from './pages/Reports';
import { SchedulesPage } from './pages/Schedules';
import { SimulatorPage } from './pages/Simulator';
import { UsersPage } from './pages/Users';

const tabs = [
  { to: '/', label: 'Personal', icon: '👤' },
  { to: '/asistencia', label: 'Asistencia', icon: '📋' },
  { to: '/reportes', label: 'Reportes', icon: '📊' },
  { to: '/novedades', label: 'Novedades', icon: '🗓️' },
  { to: '/horarios', label: 'Horarios', icon: '🕒' },
  { to: '/equipos', label: 'Equipos', icon: '📟', admin: true },
];

export function App() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ForcedPasswordPage />;
  const isAdmin = user.role === 'admin';
  const visibleTabs = tabs.filter((t) => !t.admin || isAdmin);

  return (
    <EntornoProvider>
    <div className="app">
      <EntornoBanner />
      <header className="topbar">
        <Brand />
        <Link className="link small" to="/cuenta" title="Mi cuenta">
          {user.name}
        </Link>
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<PersonalPage />} />
          <Route path="/horarios" element={<SchedulesPage />} />
          <Route path="/novedades" element={<AbsencesPage />} />
          <Route path="/reportes" element={<ReportsPage />} />
          <Route path="/historial" element={<HistoryPage />} />
          <Route path="/asistencia" element={<AttendancePage />} />
          <Route path="/cuenta" element={<AccountPage />} />
          {isAdmin && <Route path="/equipos" element={<DevicesPage />} />}
          {isAdmin && <Route path="/usuarios" element={<UsersPage />} />}
          {isAdmin && <Route path="/simulador/:id" element={<SimulatorPage />} />}
        </Routes>
      </main>
      <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)` }}>
        {visibleTabs.map((t) => (
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
  return <span className="brand">Control Horario{empresa ? ` · ${empresa}` : ''}</span>;
}

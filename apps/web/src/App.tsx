import { Link, NavLink, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth';
import { EntornoBanner, EntornoProvider, useEntorno } from './entorno';
import { AbsencesPage } from './pages/Absences';
import { AdminPage } from './pages/Admin';
import { AccountPage, ForcedPasswordPage } from './pages/Account';
import { AttendancePage } from './pages/Attendance';
import { DevicesPage } from './pages/Devices';
import { HistoryPage } from './pages/History';
import { ImportPage } from './pages/Import';
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
  { to: '/admin', label: 'Admin', icon: '⚙️', admin: true },
];

/** Páginas que se abren desde Administración: la pestaña queda marcada. */
const ADMIN_PATHS = ['/equipos', '/usuarios', '/importar', '/historial', '/simulador'];

export function App() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
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
          {isAdmin && <Route path="/historial" element={<HistoryPage />} />}
          <Route path="/asistencia" element={<AttendancePage />} />
          <Route path="/cuenta" element={<AccountPage />} />
          {isAdmin && <Route path="/admin" element={<AdminPage />} />}
          {isAdmin && <Route path="/equipos" element={<DevicesPage />} />}
          {isAdmin && <Route path="/usuarios" element={<UsersPage />} />}
          {isAdmin && <Route path="/importar" element={<ImportPage />} />}
          {isAdmin && <Route path="/simulador/:id" element={<SimulatorPage />} />}
        </Routes>
      </main>
      <nav className="tabbar" style={{ gridTemplateColumns: `repeat(${visibleTabs.length}, 1fr)` }}>
        {visibleTabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end
            className={({ isActive }) => (isActive || (t.admin && ADMIN_PATHS.some((p) => pathname.startsWith(p))) ? 'tab active' : 'tab')}
          >
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

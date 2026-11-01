import { Link, Navigate, NavLink, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth';
import { EntornoBanner, EntornoProvider, useEntorno } from './entorno';
import { AbsencesPage } from './pages/Absences';
import { AccountPage, ForcedPasswordPage } from './pages/Account';
import { AdminPage } from './pages/Admin';
import { AttendancePage } from './pages/Attendance';
import { DevicesPage } from './pages/Devices';
import { FeedbackPage, InboxPage } from './pages/Feedback';
import { HelpPage, VersionNotice } from './pages/Help';
import { HistoryPage } from './pages/History';
import { ImportPage } from './pages/Import';
import { LoginPage } from './pages/Login';
import { EmployeePage, PersonalPage } from './pages/Personal';
import { ReportsPage } from './pages/Reports';
import { SitesPage } from './pages/Schedules';
import { SimulatorPage } from './pages/Simulator';
import { UsersPage } from './pages/Users';
import { useVista } from './ui';

const tabs = [
  { to: '/personal', label: 'Personal', icon: '👤' },
  { to: '/asistencia', label: 'Asistencia', icon: '📋' },
  { to: '/reportes', label: 'Reportes', icon: '📊' },
  { to: '/novedades', label: 'Novedades', icon: '🗓️' },
  { to: '/sucursales', label: 'Sucursales y horarios', icon: '🕒' },
  { to: '/admin', label: 'Admin', icon: '⚙️', admin: true },
];

/** Páginas que se abren desde Admin: la pestaña queda marcada. */
const ADMIN_PATHS = ['/admin', '/equipos', '/usuarios', '/importar', '/historial', '/bandeja', '/simulador'];

export function App() {
  const { user, loading } = useAuth();
  const [vista, setVista] = useVista();
  const { pathname } = useLocation();
  if (loading) return null;
  if (!user) return <LoginPage />;
  if (user.mustChangePassword) return <ForcedPasswordPage />;
  const isAdmin = user.role === 'admin';
  const celular = vista === 'celular';

  return (
    <EntornoProvider>
      <div className="app">
        <EntornoBanner />
        <header className="topnav">
          <Brand />
          <nav className="navtabs">
            {tabs
              .filter((t) => !t.admin || isAdmin)
              .map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  className={({ isActive }) => (isActive || (t.admin && ADMIN_PATHS.some((p) => pathname.startsWith(p))) ? 'active' : '')}
                >
                  <span className="ico" aria-hidden>
                    {t.icon}
                  </span>
                  <span>{t.label}</span>
                </NavLink>
              ))}
          </nav>
          <div className="user">
            <Link to="/ayuda">
              <span className="ico" aria-hidden>
                ❓
              </span>
              <span>Ayuda</span>
            </Link>
            <a href="#" onClick={(e) => (e.preventDefault(), setVista(celular ? 'pc' : 'celular'))}>
              <span className="ico" aria-hidden>
                {celular ? '💻' : '📱'}
              </span>
              <span>{celular ? 'Versión PC' : 'Versión celular'}</span>
            </a>
            <Link to="/sugerencias" state={{ from: pathname }}>
              <span className="ico" aria-hidden>
                💬
              </span>
              <span>Sugerencias</span>
            </Link>
            <Link to="/cuenta">
              <span className="ico" aria-hidden>
                🔑
              </span>
              <span>{user.name}</span>
            </Link>
          </div>
        </header>
        <main className="content">
          {celular ? (
            // En el celular: sólo cargar y ver personal con fotos.
            <Routes>
              <Route path="/personal" element={<PersonalPage />} />
              <Route path="/personal/:id" element={<EmployeePage />} />
              <Route path="/cuenta" element={<AccountPage />} />
              <Route path="/sugerencias" element={<FeedbackPage />} />
              <Route path="/ayuda/:tab?" element={<HelpPage />} />
              <Route path="*" element={<Navigate to="/personal" replace />} />
            </Routes>
          ) : (
            <Routes>
              <Route path="/" element={<Navigate to="/personal" replace />} />
              <Route path="/personal" element={<PersonalPage />} />
              <Route path="/personal/:id" element={<EmployeePage />} />
              <Route path="/asistencia" element={<AttendancePage />} />
              <Route path="/reportes" element={<ReportsPage />} />
              <Route path="/novedades" element={<AbsencesPage />} />
              <Route path="/sucursales" element={<SitesPage />} />
              <Route path="/cuenta" element={<AccountPage />} />
              <Route path="/sugerencias" element={<FeedbackPage />} />
              <Route path="/ayuda/:tab?" element={<HelpPage />} />
              {isAdmin && <Route path="/admin" element={<AdminPage />} />}
              {isAdmin && <Route path="/bandeja" element={<InboxPage />} />}
              {isAdmin && <Route path="/equipos" element={<DevicesPage />} />}
              {isAdmin && <Route path="/usuarios" element={<UsersPage />} />}
              {isAdmin && <Route path="/importar" element={<ImportPage />} />}
              {isAdmin && <Route path="/historial" element={<HistoryPage />} />}
              {isAdmin && <Route path="/simulador/:id" element={<SimulatorPage />} />}
              <Route path="*" element={<Navigate to="/personal" replace />} />
            </Routes>
          )}
        </main>
        <VersionNotice />
      </div>
    </EntornoProvider>
  );
}

function Brand() {
  const empresa = useEntorno()?.empresa;
  return (
    <span className="brand">
      Control Horario{empresa && <small> · {empresa}</small>}
    </span>
  );
}

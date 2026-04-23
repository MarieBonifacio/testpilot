import { useState, useEffect, useCallback, useRef } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, Link } from 'react-router-dom';
import { ProjectProvider, AuthProvider, useAuth } from './lib/hooks';
import { Redaction } from './pages/Redaction';
import { Dashboard } from './pages/Dashboard';
import { Campagne } from './pages/Campagne';
import { Export } from './pages/Export';
import { Import } from './pages/Import';
import { Historique } from './pages/Historique';
import { Tracabilite } from './pages/Tracabilite';
import { ClickUp } from './pages/ClickUp';
import { Comep } from './pages/Comep';
import { Login } from './pages/Login';
import { Users } from './pages/Users';
import { ProductionBugs } from './pages/ProductionBugs';
import { ApiTokens } from './pages/ApiTokens';
import { CiCdDocs } from './pages/CiCdDocs';
import { ProjectSettings } from './pages/ProjectSettings';
import { AuditLogs } from './pages/AuditLogs';
import { LlmSettings } from './pages/LlmSettings';
import { ProjectSelector } from './components/ProjectSelector';
import { NotificationBell } from './components/NotificationBell';
import {
  Plane, Sun, Moon, LogOut, FileSpreadsheet,
  History, GitBranch, ExternalLink, ShieldCheck, Users as UsersIcon, Bug, Key, BookOpen, Settings, AlertTriangle, X, Cpu,
} from 'lucide-react';

// ── Bandeau avertissement token CI/CD expirant ────────
function TokenExpiresBanner() {
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const handleEvent = useCallback((e: Event) => {
    const detail = (e as CustomEvent<{ expires_at: string }>).detail;
    setExpiresAt(detail.expires_at);
  }, []);

  useEffect(() => {
    window.addEventListener('tokenExpiresSoon', handleEvent);
    return () => window.removeEventListener('tokenExpiresSoon', handleEvent);
  }, [handleEvent]);

  if (!expiresAt) return null;

  const daysLeft = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / (1000 * 86400));
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium"
      style={{ background: 'var(--warning-bg, #fff8e1)', borderBottom: '1px solid var(--warning)', color: 'var(--warning)' }}>
      <AlertTriangle size={13} />
      <span>
        Un token API expire dans <strong>{daysLeft} jour{daysLeft > 1 ? 's' : ''}</strong> ({new Date(expiresAt).toLocaleDateString('fr-FR')}).{' '}
        <Link to="/api-tokens" className="underline font-bold">Faire tourner le token →</Link>
      </span>
      <button
        className="ml-auto"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--warning)' }}
        onClick={() => setExpiresAt(null)}
        title="Fermer"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ── Garde de route ─────────────────────────────────────
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: string[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

// ── Navigation principale ──────────────────────────────
function Navigation() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Fermer le menu au clic extérieur (onBlur ne fonctionne pas sur un div non focusable)
  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [menuOpen]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-4 text-sm font-medium no-underline transition-all border-b-2 whitespace-nowrap ${
      isActive
        ? 'border-[var(--accent)] text-[var(--accent)]'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]'
    }`;

  return (
    <nav
      style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}
      className="px-4 flex items-center justify-between h-14 sticky top-0 z-50"
    >
      {/* Logo */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Plane size={17} style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '15px' }}>
          Test<span style={{ color: 'var(--accent)' }}>Pilot</span>
        </span>
      </div>

      {/* Nav links */}
      <div className="flex items-stretch h-full overflow-x-auto hide-scrollbar flex-1 mx-4">
        <NavLink to="/"              className={navLinkClass} end>Rédaction</NavLink>
        <NavLink to="/dashboard"     className={navLinkClass}>Dashboard</NavLink>
        <NavLink to="/campagne"      className={navLinkClass}>Campagne</NavLink>
        <NavLink to="/import"        className={navLinkClass}>
          <span className="flex items-center gap-1"><FileSpreadsheet size={13} />Import</span>
        </NavLink>
        <NavLink to="/historique"    className={navLinkClass}>
          <span className="flex items-center gap-1"><History size={13} />Historique</span>
        </NavLink>
        <NavLink to="/tracabilite"   className={navLinkClass}>
          <span className="flex items-center gap-1"><GitBranch size={13} />Traçabilité</span>
        </NavLink>
        <NavLink to="/clickup"       className={navLinkClass}>
          <span className="flex items-center gap-1"><ExternalLink size={13} />ClickUp</span>
        </NavLink>
        <NavLink to="/comep"         className={navLinkClass}>
          <span className="flex items-center gap-1"><ShieldCheck size={13} />COMEP</span>
        </NavLink>
        <NavLink to="/production-bugs" className={navLinkClass}>
          <span className="flex items-center gap-1"><Bug size={13} />Fuites prod.</span>
        </NavLink>
        {(['key_user', 'cp', 'admin'] as string[]).includes(user?.role ?? '') && (
          <NavLink to="/api-tokens" className={navLinkClass}>
            <span className="flex items-center gap-1"><Key size={13} />API Tokens</span>
          </NavLink>
        )}
        {(['key_user', 'cp', 'admin'] as string[]).includes(user?.role ?? '') && (
          <NavLink to="/cicd-docs" className={navLinkClass}>
            <span className="flex items-center gap-1"><BookOpen size={13} />CI/CD</span>
          </NavLink>
        )}
        <NavLink to="/export" className={navLinkClass}>Export</NavLink>
        <NavLink to="/settings/llm" className={navLinkClass}>
          <span className="flex items-center gap-1"><Cpu size={13} />LLM</span>
        </NavLink>
        {(user?.role === 'cp' || user?.role === 'admin') && (
          <NavLink to="/settings" className={navLinkClass}>
            <span className="flex items-center gap-1"><Settings size={13} />Paramètres</span>
          </NavLink>
        )}
        {(user?.role === 'cp' || user?.role === 'admin') && (
          <NavLink to="/users" className={navLinkClass}>
            <span className="flex items-center gap-1"><UsersIcon size={13} />Utilisateurs</span>
          </NavLink>
        )}
        {user?.role === 'admin' && (
          <NavLink to="/audit-logs" className={navLinkClass}>
            <span className="flex items-center gap-1"><ShieldCheck size={13} />Audit</span>
          </NavLink>
        )}
      </div>

      {/* Right: project + notifs + user */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <ProjectSelector />
        <NotificationBell />
        <button className="btn-icon" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')} title="Changer de thème">
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        {/* User menu */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(v => !v)}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold transition-all"
            style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[0.65rem] font-bold flex-shrink-0"
              style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {user?.display_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <span className="hidden sm:inline max-w-[80px] truncate">{user?.display_name}</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 w-48 rounded-lg overflow-hidden z-50"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}>
              <div className="px-4 py-2.5" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="text-xs font-semibold">{user?.display_name}</div>
                <div className="text-[0.68rem]" style={{ color: 'var(--text-dim)' }}>@{user?.username}</div>
                <div className="text-[0.68rem] mt-0.5" style={{ color: 'var(--accent)' }}>{user?.role}</div>
              </div>
              <button
                className="flex items-center gap-2 w-full px-4 py-2.5 text-xs font-semibold transition-colors"
                style={{ color: 'var(--danger)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => { setMenuOpen(false); logout(); }}
              >
                <LogOut size={13} />
                Se déconnecter
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

// ── App ────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <ProjectProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/*" element={
          <RequireAuth>
            <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
              <Navigation />
              <TokenExpiresBanner />
              <main style={{ maxWidth: '1100px', margin: '0 auto', padding: '24px 20px' }}>
                  <Routes>
                    <Route path="/"               element={<Redaction />} />
                    <Route path="/dashboard"      element={<Dashboard />} />
                    <Route path="/campagne"       element={<Campagne />} />
                    <Route path="/import"         element={<Import />} />
                    <Route path="/historique"     element={<Historique />} />
                    <Route path="/tracabilite"    element={<Tracabilite />} />
                    <Route path="/clickup"        element={<ClickUp />} />
                    <Route path="/comep"          element={<Comep />} />
                    <Route path="/export"         element={<Export />} />
                    <Route path="/production-bugs" element={<ProductionBugs />} />
                    {/* Routes restreintes par rôle */}
                    <Route path="/api-tokens"     element={<RequireRole roles={['key_user', 'cp', 'admin']}><ApiTokens /></RequireRole>} />
                    <Route path="/cicd-docs"      element={<RequireRole roles={['key_user', 'cp', 'admin']}><CiCdDocs /></RequireRole>} />
                    <Route path="/settings"       element={<RequireRole roles={['cp', 'admin']}><ProjectSettings /></RequireRole>} />
                    <Route path="/settings/llm"   element={<LlmSettings />} />
                    <Route path="/users"          element={<RequireRole roles={['cp', 'admin']}><Users /></RequireRole>} />
                    <Route path="/audit-logs"     element={<RequireRole roles={['admin']}><AuditLogs /></RequireRole>} />
                    <Route path="*"               element={<Navigate to="/" replace />} />
                  </Routes>
                </main>
              </div>
            </RequireAuth>
          } />
        </Routes>
      </ProjectProvider>
    </AuthProvider>
  );
}

// Page login enveloppée (sans RequireAuth ni nav)
function LoginPage() {
  const { user } = useAuth();
  if (user) return <Navigate to="/" replace />;
  return <Login />;
}

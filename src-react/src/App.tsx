import { useState, useEffect } from 'react';
import { Routes, Route, NavLink } from 'react-router-dom';
import { ProjectProvider } from './lib/hooks';
import { Redaction } from './pages/Redaction';
import { Dashboard } from './pages/Dashboard';
import { Campagne } from './pages/Campagne';
import { Export } from './pages/Export';
import { ProjectSelector } from './components/ProjectSelector';
import { Plane, Sun, Moon } from 'lucide-react';

function Navigation() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-4 text-sm font-medium no-underline transition-all border-b-2 ${
      isActive
        ? 'border-[var(--accent)] text-[var(--accent)]'
        : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-strong)]'
    }`;

  return (
    <nav
      style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}
      className="px-6 flex items-center justify-between h-14 sticky top-0 z-50"
    >
      {/* Logo */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <Plane size={18} style={{ color: 'var(--accent)' }} />
        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: '15px' }}>
          Test<span style={{ color: 'var(--accent)' }}>Pilot</span>
        </span>
      </div>

      {/* Nav links */}
      <div className="flex items-stretch h-full">
        <NavLink to="/" className={navLinkClass} end>Rédaction</NavLink>
        <NavLink to="/dashboard" className={navLinkClass}>Dashboard</NavLink>
        <NavLink to="/campagne" className={navLinkClass}>Campagne</NavLink>
        <NavLink to="/export" className={navLinkClass}>Export</NavLink>
      </div>

      {/* Right: project selector + theme toggle */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <ProjectSelector />
        <button className="btn-icon" onClick={toggleTheme} title="Changer de thème">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <ProjectProvider>
      <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
        <Navigation />
        <main style={{ maxWidth: '960px', margin: '0 auto', padding: '24px 20px' }}>
          <Routes>
            <Route path="/" element={<Redaction />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/campagne" element={<Campagne />} />
            <Route path="/export" element={<Export />} />
          </Routes>
        </main>
      </div>
    </ProjectProvider>
  );
}

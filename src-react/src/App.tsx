import { Routes, Route, NavLink } from 'react-router-dom';
import { ProjectProvider } from './lib/hooks';
import { Redaction } from './pages/Redaction';
import { Dashboard } from './pages/Dashboard';
import { Campagne } from './pages/Campagne';
import { Export } from './pages/Export';
import { ProjectSelector } from './components/ProjectSelector';
import { Plane } from 'lucide-react';

function Navigation() {
  return (
    <nav className="bg-white border-b-2 border-[var(--primary)] px-6 py-0 flex items-center justify-between h-14 sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <Plane className="text-[var(--primary)]" size={20} />
        <span className="text-[var(--primary)] font-bold text-lg">TestPilot</span>
      </div>
      
      <ProjectSelector />
      
      <div className="flex gap-1">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `px-4 py-2 rounded-md text-sm font-medium no-underline transition-all ${
              isActive
                ? 'bg-[rgba(59,109,17,0.1)] text-[var(--primary)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-alt)] hover:text-[var(--text)]'
            }`
          }
        >
          Rédaction
        </NavLink>
        <NavLink
          to="/dashboard"
          className={({ isActive }) =>
            `px-4 py-2 rounded-md text-sm font-medium no-underline transition-all ${
              isActive
                ? 'bg-[rgba(59,109,17,0.1)] text-[var(--primary)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-alt)] hover:text-[var(--text)]'
            }`
          }
        >
          Dashboard
        </NavLink>
        <NavLink
          to="/campagne"
          className={({ isActive }) =>
            `px-4 py-2 rounded-md text-sm font-medium no-underline transition-all ${
              isActive
                ? 'bg-[rgba(59,109,17,0.1)] text-[var(--primary)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-alt)] hover:text-[var(--text)]'
            }`
          }
        >
          Campagne
        </NavLink>
        <NavLink
          to="/export"
          className={({ isActive }) =>
            `px-4 py-2 rounded-md text-sm font-medium no-underline transition-all ${
              isActive
                ? 'bg-[rgba(59,109,17,0.1)] text-[var(--primary)]'
                : 'text-[var(--text-muted)] hover:bg-[var(--bg-alt)] hover:text-[var(--text)]'
            }`
          }
        >
          Export
        </NavLink>
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <ProjectProvider>
      <div className="min-h-screen bg-[var(--bg)]">
        <Navigation />
        <main className="max-w-5xl mx-auto p-5">
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
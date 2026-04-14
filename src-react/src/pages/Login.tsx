import { useState } from 'react';
import { useAuth } from '../lib/hooks';
import { Plane } from 'lucide-react';

export function Login() {
  const { login, loading } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login(username, password);
      // La redirection est gérée dans App.tsx
    } catch (err) {
      setError((err as Error).message || 'Identifiants incorrects');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Plane size={22} style={{ color: 'var(--accent)' }} />
            <span className="text-2xl font-bold" style={{ color: 'var(--text)' }}>
              Test<span style={{ color: 'var(--accent)' }}>Pilot</span>
            </span>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Connexion à votre espace</p>
        </div>

        <form onSubmit={handleSubmit} className="panel space-y-4">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Nom d'utilisateur
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ex : marie.b"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button type="submit" className="btn btn-primary w-full justify-center" disabled={loading}>
            {loading ? (
              <><div className="spinner" /><span>Connexion…</span></>
            ) : 'Se connecter'}
          </button>
        </form>

        <p className="text-center text-xs mt-4" style={{ color: 'var(--text-dim)' }}>
          Pas encore de compte ? Demandez à votre administrateur TestPilot.
        </p>
      </div>
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Key, Plus, Trash2, Copy, Check, AlertTriangle, Clock, Shield, ExternalLink, RefreshCw, History, GitBranch } from 'lucide-react';
import { apiTokensApi, projectsApi } from '../lib/api';
import type { ApiToken, ApiTokenCreated, Project, TriggerHistory } from '../types';

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function isExpired(expires_at: string | null) {
  if (!expires_at) return false;
  return new Date(expires_at) < new Date();
}

function isExpiringSoon(expires_at: string | null) {
  if (!expires_at) return false;
  const msLeft = new Date(expires_at).getTime() - Date.now();
  return msLeft > 0 && msLeft < 7 * 24 * 3600 * 1000;
}

const SCOPE_LABELS: Record<string, string> = {
  trigger: 'Déclencher campagnes',
  read:    'Lire résultats',
  write:   'Écrire résultats',
};

const TRIGGER_SOURCE_LABELS: Record<string, string> = {
  'github-actions': 'GitHub Actions',
  'gitlab-ci':      'GitLab CI',
  'azure-devops':   'Azure DevOps',
  'api':            'API directe',
};

// ── Composant principal ────────────────────────────────────────────────────────
export function ApiTokens() {
  const [tokens, setTokens]       = useState<ApiToken[]>([]);
  const [projects, setProjects]   = useState<Project[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [showForm, setShowForm]   = useState(false);
  const [newToken, setNewToken]   = useState<ApiTokenCreated | null>(null);
  const [copied, setCopied]       = useState(false);
  const [deleting, setDeleting]   = useState<number | null>(null);
  const [rotating, setRotating]   = useState<number | null>(null);

  // Historique triggers
  const [history, setHistory]         = useState<TriggerHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Form state
  const [fname, setFname]             = useState('');
  const [fscopes, setFscopes]         = useState<string[]>(['trigger']);
  const [fProjectIds, setFProjectIds] = useState<number[]>([]);
  const [fAllProjects, setFAllProjects] = useState(true);
  const [fExpiry, setFExpiry]         = useState<string>('');
  const [fCreating, setFCreating]     = useState(false);
  const [fError, setFError]           = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [tokData, projData] = await Promise.all([
        apiTokensApi.list(),
        projectsApi.list(),
      ]);
      setTokens(tokData);
      setProjects(projData);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const data = await apiTokensApi.triggerHistory(50);
      setHistory(data);
      setShowHistory(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleScope = (s: string) => {
    setFscopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const toggleProject = (id: number) => {
    setFProjectIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const createToken = async () => {
    if (!fname.trim()) { setFError('Le nom est requis.'); return; }
    if (fscopes.length === 0) { setFError('Sélectionnez au moins un scope.'); return; }
    setFCreating(true);
    setFError(null);
    try {
      const created = await apiTokensApi.create({
        name:            fname.trim(),
        scopes:          fscopes,
        project_ids:     fAllProjects ? null : fProjectIds,
        expires_in_days: fExpiry ? parseInt(fExpiry) : null,
      });
      setNewToken(created);
      setShowForm(false);
      resetForm();
      await load();
    } catch (e) {
      setFError((e as Error).message);
    } finally {
      setFCreating(false);
    }
  };

  const resetForm = () => {
    setFname('');
    setFscopes(['trigger']);
    setFProjectIds([]);
    setFAllProjects(true);
    setFExpiry('');
    setFError(null);
  };

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const deleteToken = async (id: number) => {
    if (!confirm('Supprimer ce token ? Les pipelines qui l\'utilisent seront bloqués.')) return;
    setDeleting(id);
    try {
      await apiTokensApi.delete(id);
      setTokens(prev => prev.filter(t => t.id !== id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(null);
    }
  };

  const rotateToken = async (id: number) => {
    if (!confirm('Faire tourner ce token ? L\'ancien sera immédiatement invalidé.')) return;
    setRotating(id);
    setNewToken(null);
    try {
      const rotated = await apiTokensApi.rotate(id);
      setNewToken(rotated);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRotating(null);
    }
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Tokens API</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Gérez les tokens d'accès pour vos pipelines CI/CD
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            className="btn btn-secondary"
            onClick={showHistory ? () => setShowHistory(false) : loadHistory}
            disabled={historyLoading}
          >
            {historyLoading ? <div className="spinner" /> : <History size={14} />}
            {showHistory ? 'Masquer l\'historique' : 'Historique triggers'}
          </button>
          <button className="btn btn-primary" onClick={() => { setShowForm(true); setNewToken(null); }}>
            <Plus size={14} /> Nouveau token
          </button>
        </div>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {/* Modal token créé/tourné — affiché une seule fois */}
      {newToken && (
        <div className="rounded-lg p-5 mb-6"
          style={{ background: 'var(--warning-bg, #fff8e1)', border: '2px solid var(--warning)' }}>
          <div className="flex items-center gap-2 mb-3 font-semibold" style={{ color: 'var(--warning)' }}>
            <AlertTriangle size={16} />
            Copiez ce token maintenant — il ne sera plus jamais affiché.
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <code
              className="flex-1 text-xs px-3 py-2 rounded font-mono break-all select-all"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              {newToken.token}
            </code>
            <button
              className="btn btn-secondary flex-shrink-0"
              onClick={() => copyToken(newToken.token)}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copié !' : 'Copier'}
            </button>
          </div>
          <button
            className="mt-3 text-xs underline"
            style={{ color: 'var(--text-dim)', background: 'none', border: 'none', cursor: 'pointer' }}
            onClick={() => setNewToken(null)}
          >
            J'ai sauvegardé le token, fermer
          </button>
        </div>
      )}

      {/* Formulaire de création */}
      {showForm && (
        <div className="panel mb-6">
          <div className="text-sm font-bold mb-4" style={{ color: 'var(--accent)' }}>Créer un token</div>

          {fError && <div className="error-msg mb-3">{fError}</div>}

          <div className="space-y-4">
            {/* Nom */}
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-dim)' }}>
                Nom du token *
              </label>
              <input
                type="text"
                className="input w-full"
                placeholder="ex : GitHub Actions ATHENA"
                value={fname}
                onChange={e => setFname(e.target.value)}
              />
            </div>

            {/* Scopes */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-dim)' }}>
                Permissions (scopes)
              </div>
              <div className="flex gap-3 flex-wrap">
                {Object.entries(SCOPE_LABELS).map(([scope, label]) => (
                  <label key={scope} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={fscopes.includes(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    <span><code className="font-mono">{scope}</code> — {label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Projets autorisés */}
            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-dim)' }}>
                Projets autorisés
              </div>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer mb-2">
                <input
                  type="checkbox"
                  checked={fAllProjects}
                  onChange={e => setFAllProjects(e.target.checked)}
                />
                Tous les projets
              </label>
              {!fAllProjects && (
                <div className="flex gap-2 flex-wrap mt-1">
                  {projects.map(p => (
                    <label key={p.id} className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={fProjectIds.includes(p.id)}
                        onChange={() => toggleProject(p.id)}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Expiration */}
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-dim)' }}>
                Expiration (en jours, laisser vide = jamais)
              </label>
              <input
                type="number"
                className="input"
                placeholder="ex : 90"
                style={{ width: '120px' }}
                value={fExpiry}
                min={1}
                onChange={e => setFExpiry(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={createToken} disabled={fCreating}>
                {fCreating ? <div className="spinner" /> : <Key size={14} />}
                {fCreating ? 'Création…' : 'Créer le token'}
              </button>
              <button className="btn btn-secondary" onClick={() => { setShowForm(false); resetForm(); }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Liste des tokens */}
      {loading ? (
        <div className="loader"><div className="spinner" /><span>Chargement…</span></div>
      ) : tokens.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <Key size={40} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-muted)' }}>
            Aucun token créé. Créez-en un pour connecter vos pipelines CI/CD.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {tokens.map(tok => {
            const expired     = isExpired(tok.expires_at);
            const expireSoon  = isExpiringSoon(tok.expires_at);
            const neverUsed   = !tok.last_used_at;
            return (
              <div
                key={tok.id}
                className="rounded-lg p-4 flex items-start gap-3"
                style={{
                  background: 'var(--bg-elevated)',
                  border: `1px solid ${expired ? 'var(--danger)' : expireSoon ? 'var(--warning)' : 'var(--border)'}`,
                  opacity: expired ? 0.6 : 1,
                }}
              >
                <Key size={16} style={{ color: expired ? 'var(--danger)' : expireSoon ? 'var(--warning)' : 'var(--accent)', flexShrink: 0, marginTop: 2 }} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm">{tok.name}</span>
                    {expired && (
                      <span className="text-[0.65rem] px-1.5 py-0.5 rounded font-bold"
                        style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
                        EXPIRÉ
                      </span>
                    )}
                    {expireSoon && !expired && (
                      <span className="text-[0.65rem] px-1.5 py-0.5 rounded font-bold"
                        style={{ background: 'var(--warning-bg, #fff8e1)', color: 'var(--warning)' }}>
                        EXPIRE BIENTÔT
                      </span>
                    )}
                    {neverUsed && !expired && (
                      <span className="text-[0.65rem] px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--bg-hover)', color: 'var(--text-dim)' }}>
                        Jamais utilisé
                      </span>
                    )}
                  </div>

                  <div className="flex gap-4 flex-wrap text-xs" style={{ color: 'var(--text-dim)' }}>
                    <span className="font-mono">{tok.token_prefix}…</span>
                    <span className="flex items-center gap-1">
                      <Shield size={11} />
                      {tok.scopes.join(', ')}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={11} />
                      {tok.last_used_at ? `Utilisé le ${formatDate(tok.last_used_at)}` : 'Jamais utilisé'}
                    </span>
                    {tok.expires_at && (
                      <span style={{ color: expired ? 'var(--danger)' : expireSoon ? 'var(--warning)' : 'inherit' }}>
                        Expire le {formatDate(tok.expires_at)}
                      </span>
                    )}
                    <span>Créé le {formatDate(tok.created_at)}</span>
                    {tok.project_ids && (
                      <span>
                        Projets : {tok.project_ids.map(id =>
                          projects.find(p => p.id === id)?.name ?? `#${id}`
                        ).join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-1 flex-shrink-0">
                  <button
                    className="btn-icon"
                    style={{ color: 'var(--accent)' }}
                    onClick={() => rotateToken(tok.id)}
                    disabled={rotating === tok.id}
                    title="Faire tourner ce token (invalide l'ancien)"
                  >
                    {rotating === tok.id ? <div className="spinner" /> : <RefreshCw size={14} />}
                  </button>
                  <button
                    className="btn-icon"
                    style={{ color: 'var(--danger)' }}
                    onClick={() => deleteToken(tok.id)}
                    disabled={deleting === tok.id}
                    title="Révoquer ce token"
                  >
                    {deleting === tok.id ? <div className="spinner" /> : <Trash2 size={15} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Historique des déclenchements CI/CD */}
      {showHistory && (
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch size={16} style={{ color: 'var(--accent)' }} />
            <h2 className="text-base font-bold" style={{ color: 'var(--text)' }}>
              Historique des déclenchements CI/CD
            </h2>
          </div>
          {history.length === 0 ? (
            <div className="rounded-lg p-6 text-center text-sm"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
              Aucun déclenchement enregistré.
            </div>
          ) : (
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Date</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Projet</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Session</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Source</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Branche</th>
                    <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Token</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={h.id} style={{
                      borderBottom: i < history.length - 1 ? '1px solid var(--border)' : 'none',
                      background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg-elevated)',
                    }}>
                      <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-dim)' }}>
                        {formatDate(h.triggered_at)}
                      </td>
                      <td className="px-3 py-2">{h.project_name}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{h.session_name}</td>
                      <td className="px-3 py-2">
                        <span className="px-1.5 py-0.5 rounded text-[0.65rem] font-bold"
                          style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                          {h.trigger_source ? (TRIGGER_SOURCE_LABELS[h.trigger_source] ?? h.trigger_source) : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-dim)' }}>
                        {h.branch ?? '—'}
                      </td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                        {h.token_name ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Lien vers doc */}
      <div className="mt-8 rounded-lg p-4 flex items-center gap-3"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <ExternalLink size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Consultez la{' '}
          <Link to="/cicd-docs" className="underline" style={{ color: 'var(--accent)' }}>
            documentation CI/CD
          </Link>{' '}
          pour les exemples d'intégration GitHub Actions, Azure DevOps et GitLab CI.
        </div>
      </div>
    </div>
  );
}

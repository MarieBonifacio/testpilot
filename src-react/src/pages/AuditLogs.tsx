import { useState, useEffect } from 'react';
import { Shield, RefreshCw, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { auditApi } from '../lib/api';
import type { AuditLog } from '../types';

const ACTION_LABELS: Record<string, string> = {
  login:            'Connexion',
  logout:           'Déconnexion',
  register:         'Création compte',
  delete_user:      'Suppression utilisateur',
  update_user:      'Modification utilisateur',
  validate_scenario:'Validation scénario',
  reject_scenario:  'Rejet scénario',
  submit_scenario:  'Soumission scénario',
  create_token:     'Création token API',
  revoke_token:     'Révocation token API',
  trigger_session:  'Déclenchement session',
};

const ACTION_COLORS: Record<string, string> = {
  login:            'var(--success)',
  logout:           'var(--text-muted)',
  register:         'var(--accent)',
  delete_user:      'var(--danger)',
  revoke_token:     'var(--danger)',
  validate_scenario:'var(--success)',
  reject_scenario:  'var(--danger)',
  trigger_session:  'var(--accent)',
};

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const LIMIT = 50;

export function AuditLogs() {
  const [logs, setLogs]       = useState<AuditLog[]>([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [page, setPage]       = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

  const pages = Math.max(1, Math.ceil(total / LIMIT));

  const load = async (p = page, action = filterAction) => {
    setLoading(true);
    setError(null);
    try {
      const data = await auditApi.list({
        action:  action || undefined,
        limit:   LIMIT,
        offset:  (p - 1) * LIMIT,
      });
      setLogs(data.logs);
      setTotal(data.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(page, filterAction); }, [page, filterAction]);

  const handleActionFilter = (v: string) => {
    setFilterAction(v);
    setPage(1);
  };

  const filtered = filterSearch
    ? logs.filter(l =>
        (l.username ?? '').toLowerCase().includes(filterSearch.toLowerCase()) ||
        (l.entity_id ?? '').includes(filterSearch) ||
        (l.ip_address ?? '').includes(filterSearch)
      )
    : logs;

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--accent)' }}>
            <Shield size={18} />
            Journal d'audit
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Traçabilité des actions sensibles — {total} événements au total
          </p>
        </div>
        <button className="btn btn-secondary" onClick={() => load(page, filterAction)} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Rafraîchir
        </button>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {/* Filtres */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          className="input"
          value={filterAction}
          onChange={e => handleActionFilter(e.target.value)}
          style={{ width: '220px' }}
        >
          <option value="">Toutes les actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <div className="flex items-center gap-2 flex-1" style={{ minWidth: '200px', maxWidth: '340px' }}>
          <Search size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            type="text"
            className="input flex-1"
            placeholder="Filtrer par utilisateur, IP…"
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="loader"><div className="spinner" /><span>Chargement…</span></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg p-8 text-center text-sm"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Aucun événement d'audit trouvé.
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Date</th>
                <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Action</th>
                <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Utilisateur</th>
                <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Entité</th>
                <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>Détails</th>
                <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--text-dim)' }}>IP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((log, i) => (
                <tr key={log.id} style={{
                  borderBottom: i < filtered.length - 1 ? '1px solid var(--border)' : 'none',
                  background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg-elevated)',
                }}>
                  <td className="px-3 py-2 font-mono whitespace-nowrap" style={{ color: 'var(--text-dim)' }}>
                    {formatDate(log.created_at)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className="px-1.5 py-0.5 rounded text-[0.65rem] font-bold"
                      style={{
                        background: 'var(--bg-hover)',
                        color: ACTION_COLORS[log.action] ?? 'var(--text)',
                      }}>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-semibold">{log.username ?? '—'}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>
                    {log.entity_type && log.entity_id
                      ? `${log.entity_type} #${log.entity_id}`
                      : log.entity_type ?? '—'}
                  </td>
                  <td className="px-3 py-2 max-w-[200px] truncate" style={{ color: 'var(--text-dim)' }}
                    title={log.details ?? undefined}>
                    {log.details ?? '—'}
                  </td>
                  <td className="px-3 py-2 font-mono" style={{ color: 'var(--text-dim)' }}>
                    {log.ip_address ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button className="btn-icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ color: 'var(--text-muted)' }}>
            Page {page} / {pages}
          </span>
          <button className="btn-icon" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { traceabilityApi, scenariosApi } from '../lib/api';
import type { CoverageMatrixRow } from '../types';
import { GitBranch, Download, Pencil, Check, X } from 'lucide-react';

export function Tracabilite() {
  const { projectId } = useProject();
  const [matrix, setMatrix] = useState<CoverageMatrixRow[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    if (!projectId) return;
    load();
  }, [projectId]);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const res = await traceabilityApi.getCoverageMatrix(projectId);
      setMatrix(res.matrix);
      setStats(res.stats);
    } catch (err) {
      console.error('Erreur traçabilité:', err);
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (id: number, currentRef: string) => {
    setEditingId(id);
    setEditValue(currentRef || '');
  };

  const saveRef = async (id: number) => {
    try {
      await scenariosApi.updateReference(id, editValue.trim());
      setEditingId(null);
      await load();
    } catch (err) {
      console.error('Erreur mise à jour référence:', err);
    }
  };

  const exportCSV = () => {
    const BOM = '\uFEFF';
    const rows: string[][] = [['Référence exigence', 'ID scénario', 'Titre', 'Priorité', 'Accepté', 'TNR', 'Type']];
    matrix.forEach(group => {
      group.scenarios.forEach(sc => {
        rows.push([
          group.source_reference || '(sans référence)',
          sc.scenario_id,
          sc.title,
          sc.priority,
          sc.accepted ? 'Oui' : 'Non',
          sc.is_tnr ? 'Oui' : 'Non',
          sc.scenario_type || '',
        ]);
      });
    });
    const csv = BOM + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tracabilite-projet-${projectId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!projectId) {
    return (
      <div className="empty-state">
        <GitBranch size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour voir la traçabilité.</p>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6 pb-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Matrice de traçabilité</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Exigences ↔ Scénarios — couverture et liens</p>
        </div>
        <button className="btn btn-secondary" onClick={exportCSV} disabled={matrix.length === 0}>
          <Download size={14} />
          Exporter CSV
        </button>
      </header>

      {/* Stats */}
      {(stats.allScenarios ?? 0) > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Scénarios total',   value: stats.allScenarios,  color: 'var(--text)' },
            { label: 'Avec référence',    value: stats.withRef,       color: 'var(--success)' },
            { label: 'Sans référence',    value: stats.withoutRef,    color: 'var(--warning)' },
            { label: 'Références uniques',value: stats.uniqueRefs,    color: 'var(--accent)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="text-[0.72rem] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>{label}</div>
              <div className="text-xl font-bold" style={{ color }}>{value ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="loader"><div className="spinner" /><span>Chargement…</span></div>}

      {!loading && matrix.length === 0 && (
        <div className="empty-state">
          <GitBranch size={40} className="mx-auto mb-3 opacity-20" />
          <p>Aucun scénario pour ce projet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Générez des scénarios depuis la page Rédaction.</p>
        </div>
      )}

      <div className="space-y-4">
        {matrix.map((group) => {
          const hasRef = !!group.source_reference;
          return (
            <div key={group.source_reference || '__none__'} className="rounded-lg overflow-hidden"
              style={{ background: 'var(--bg-elevated)', border: `1px solid ${hasRef ? 'var(--border)' : 'var(--warning)'}` }}>

              {/* En-tête groupe */}
              <div className="flex items-center justify-between px-4 py-3"
                style={{ borderBottom: '1px solid var(--border)', background: hasRef ? 'var(--bg-hover)' : 'var(--warning-bg)' }}>
                <div className="flex items-center gap-2">
                  <GitBranch size={13} style={{ color: hasRef ? 'var(--accent)' : 'var(--warning)' }} />
                  <span className="font-semibold text-sm">
                    {hasRef ? group.source_reference : <em style={{ color: 'var(--warning)' }}>Sans référence exigence</em>}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-1 rounded-full overflow-hidden" style={{ background: 'var(--bg)' }}>
                    <div className="h-full rounded-full" style={{
                      width: `${group.coverage_pct}%`,
                      background: group.coverage_pct === 100 ? 'var(--success)' : group.coverage_pct > 0 ? 'var(--warning)' : 'var(--danger)',
                    }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                    {group.accepted}/{group.total}
                  </span>
                </div>
              </div>

              {/* Scénarios */}
              {group.scenarios.map((sc) => (
                <div key={sc.id} className="flex items-start gap-3 px-4 py-3 text-sm"
                  style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                  <div className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full"
                    style={{ background: sc.accepted ? 'var(--success)' : 'var(--border-strong)' }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-xs" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>{sc.scenario_id}</code>
                      <span className="font-medium">{sc.title}</span>
                    </div>
                    <div className="flex gap-1.5 mt-1 flex-wrap">
                      <span className={`badge badge-priority ${sc.priority}`}>{sc.priority}</span>
                      {sc.is_tnr && <span className="badge-tnr">TNR</span>}
                      {sc.validation_status && sc.validation_status !== 'draft' && (
                        <span className="text-[0.68rem] px-1.5 py-0.5 rounded font-semibold"
                          style={
                            sc.validation_status === 'validated' ? { background: 'var(--success-bg)', color: 'var(--success)' }
                            : sc.validation_status === 'rejected'  ? { background: 'var(--danger-bg)',  color: 'var(--danger)' }
                            : { background: 'var(--warning-bg)', color: 'var(--warning)' }
                          }>
                          {sc.validation_status === 'submitted' ? 'soumis' : sc.validation_status === 'validated' ? 'validé' : 'rejeté'}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Édition référence */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {editingId === sc.id ? (
                      <>
                        <input
                          className="text-xs px-2 py-1 rounded"
                          style={{ width: 140, background: 'var(--bg)', border: '1px solid var(--accent)' }}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRef(sc.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          placeholder="REQ-001"
                        />
                        <button className="btn-icon" onClick={() => saveRef(sc.id)}><Check size={13} style={{ color: 'var(--success)' }} /></button>
                        <button className="btn-icon" onClick={() => setEditingId(null)}><X size={13} style={{ color: 'var(--danger)' }} /></button>
                      </>
                    ) : (
                      <button className="btn-icon" onClick={() => startEdit(sc.id, group.source_reference || '')} title="Modifier la référence">
                        <Pencil size={12} style={{ color: 'var(--text-dim)' }} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}


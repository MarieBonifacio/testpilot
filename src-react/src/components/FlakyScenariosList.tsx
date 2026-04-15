import { useState, useEffect } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Activity, RefreshCw } from 'lucide-react';
import { kpisApi } from '../lib/api';
import type { FlakinessKPI, FlakinessHistory } from '../types';

interface Props {
  projectId: number;
}

const FLAKY_THRESHOLD = 10; // % au-dessus duquel on considère un scénario flaky

function FlakinessRateBadge({ rate }: { rate: number }) {
  const color = rate >= 40 ? 'var(--danger)' : rate >= 20 ? 'var(--warning)' : 'var(--warning)';
  const bg    = rate >= 40 ? 'var(--danger-bg)' : 'var(--warning-bg, #fff8e1)';
  return (
    <span
      className="text-[0.7rem] font-bold px-2 py-0.5 rounded"
      style={{ background: bg, color, border: `1px solid ${color}` }}
    >
      {rate.toFixed(1)}% flaky
    </span>
  );
}

function ScenarioHistoryRow({ scenarioId }: { scenarioId: number }) {
  const [history, setHistory] = useState<FlakinessHistory | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    kpisApi.getFlakinessHistory(scenarioId)
      .then(setHistory)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [scenarioId]);

  if (loading) return <div className="text-xs py-2" style={{ color: 'var(--text-dim)' }}>Chargement…</div>;
  if (error)   return <div className="text-xs py-2" style={{ color: 'var(--danger)' }}>Erreur : {error}</div>;
  if (!history || history.history.length === 0)
    return <div className="text-xs py-2" style={{ color: 'var(--text-dim)' }}>Aucun historique disponible.</div>;

  const recent = history.history.slice(0, 8);
  return (
    <div className="mt-2 space-y-1">
      {recent.map(ev => {
        const isFlaky  = ev.is_flaky_change === 1;
        const dateStr  = new Date(ev.detected_at).toLocaleDateString('fr-FR', {
          day: '2-digit', month: '2-digit', year: '2-digit',
          hour: '2-digit', minute: '2-digit',
        });
        return (
          <div
            key={ev.id}
            className="flex items-center gap-2 text-xs px-2 py-1 rounded"
            style={{
              background: isFlaky ? 'var(--warning-bg, #fff8e1)' : 'var(--bg-elevated)',
              border: `1px solid ${isFlaky ? 'var(--warning)' : 'var(--border)'}`,
            }}
          >
            {isFlaky && <AlertTriangle size={11} style={{ color: 'var(--warning)', flexShrink: 0 }} />}
            <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{dateStr}</span>
            <span style={{ color: 'var(--text-muted)' }}>{ev.session_name}</span>
            <span className="ml-auto font-mono" style={{ color: 'var(--text-dim)' }}>
              {ev.previous_status ?? '—'} → {ev.new_status}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function FlakyScenariosList({ projectId }: Props) {
  const [kpi, setKpi]           = useState<FlakinessKPI | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [ignored, setIgnored]   = useState<Set<number>>(new Set());

  const load = () => {
    setLoading(true);
    setError(null);
    kpisApi.getFlakiness(projectId)
      .then(setKpi)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]);

  const toggleExpand = (id: number) => {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleIgnore = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setIgnored(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  if (loading) return (
    <div className="flex items-center gap-2 text-sm py-4" style={{ color: 'var(--text-dim)' }}>
      <div className="spinner" /> Chargement flakiness…
    </div>
  );

  if (error) return (
    <div className="text-sm py-2" style={{ color: 'var(--danger)' }}>Erreur : {error}</div>
  );

  if (!kpi) return null;

  const flaky = kpi.most_flaky.filter(s => s.flakiness_rate >= FLAKY_THRESHOLD);

  return (
    <div>
      {/* En-tête récap */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: 'var(--warning)' }} />
          <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>
            Scénarios instables ({flaky.length})
          </span>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded"
          style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)' }}
          title="Rafraîchir"
        >
          <RefreshCw size={11} /> Rafraîchir
        </button>
      </div>

      {flaky.length === 0 ? (
        <div className="text-sm text-center py-4" style={{ color: 'var(--text-dim)' }}>
          Aucun scénario avec un taux de flakiness &gt; {FLAKY_THRESHOLD}%.
        </div>
      ) : (
        <div className="space-y-2">
          {flaky.map(sc => {
            const isIgnored  = ignored.has(sc.scenario_id);
            const isExpanded = expanded[sc.scenario_id] ?? false;
            return (
              <div
                key={sc.scenario_id}
                className="rounded-lg overflow-hidden"
                style={{
                  border: `1px solid ${isIgnored ? 'var(--border)' : 'var(--warning)'}`,
                  opacity: isIgnored ? 0.5 : 1,
                }}
              >
                {/* Ligne principale — clic pour expand */}
                <div
                  className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
                  style={{ background: isIgnored ? 'var(--bg-elevated)' : 'var(--warning-bg, #fff8e1)' }}
                  onClick={() => toggleExpand(sc.scenario_id)}
                >
                  {isExpanded
                    ? <ChevronDown size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                    : <ChevronRight size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}

                  <AlertTriangle size={13} style={{ color: 'var(--warning)', flexShrink: 0 }} />

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{sc.title}</div>
                    <div className="text-xs" style={{ color: 'var(--text-dim)' }}>
                      {sc.scenario_ref}
                      {sc.feature && <> · {sc.feature}</>}
                      {' · '}
                      {sc.total_executions} exéc. · {sc.flaky_changes} changement{sc.flaky_changes > 1 ? 's' : ''}
                    </div>
                  </div>

                  <FlakinessRateBadge rate={sc.flakiness_rate} />

                  <button
                    onClick={e => toggleIgnore(sc.scenario_id, e)}
                    className="text-[0.68rem] px-2 py-1 rounded ml-1 flex-shrink-0"
                    style={isIgnored
                      ? { border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)' }
                      : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)' }}
                    title={isIgnored ? 'Réactiver' : 'Marquer comme connu (ignorer)'}
                  >
                    {isIgnored ? 'Réactiver' : 'Ignorer'}
                  </button>
                </div>

                {/* Détail — historique inline */}
                {isExpanded && (
                  <div className="px-3 pb-3 pt-1" style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border)' }}>
                    <div className="text-[0.68rem] font-bold uppercase mb-1" style={{ color: 'var(--text-dim)' }}>
                      Derniers changements de statut
                    </div>
                    <ScenarioHistoryRow scenarioId={sc.scenario_id} />

                    {sc.last_change && (
                      <div className="mt-2 text-xs" style={{ color: 'var(--text-dim)' }}>
                        Dernier changement : {new Date(sc.last_change).toLocaleDateString('fr-FR')}
                        {sc.last_from && sc.last_to && <> · {sc.last_from} → {sc.last_to}</>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { projectsApi, scenariosApi } from '../lib/api';
import type { Scenario } from '../types';
import { CheckCircle, Circle, ChevronDown, ChevronRight, BarChart3 } from 'lucide-react';

interface FeatureStats {
  name: string;
  total: number;
  accepted: number;
  scenarios: Scenario[];
}

export function Dashboard() {
  const { projectId } = useProject();
  const [features, setFeatures] = useState<FeatureStats[]>([]);
  const [stats, setStats] = useState({ total: 0, accepted: 0, tnr: 0 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [projectId]);

  const loadData = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [scenarios, projectStats] = await Promise.all([
        scenariosApi.list(projectId),
        projectsApi.getStats(projectId).catch(() => ({ total: 0, accepted: 0, tnr_count: 0, critical: 0, features: [] })),
      ]);

      setStats({
        total: projectStats.total || scenarios.length,
        accepted: projectStats.accepted || scenarios.filter(s => s.accepted).length,
        tnr: projectStats.tnr_count ?? scenarios.filter(s => s.is_tnr).length,
      });

      // Group by feature
      const featureMap = new Map<string, Scenario[]>();
      scenarios.forEach(s => {
        const key = s.feature_name || 'Autre';
        if (!featureMap.has(key)) featureMap.set(key, []);
        featureMap.get(key)!.push(s);
      });

      const featureStats: FeatureStats[] = Array.from(featureMap.entries()).map(([name, scs]) => ({
        name,
        total: scs.length,
        accepted: scs.filter(s => s.accepted).length,
        scenarios: scs,
      }));

      setFeatures(featureStats.sort((a, b) => b.total - a.total));
    } catch (err) {
      console.error('Error loading dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (name: string) => {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setExpanded(next);
  };

  const getStatus = (accepted: number, total: number) => {
    if (total === 0) return 'none';
    if (accepted >= total) return 'covered';
    if (accepted > 0) return 'partial';
    return 'none';
  };

  if (!projectId) {
    return (
      <div className="empty-state">
        <BarChart3 size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour voir le dashboard.</p>
      </div>
    );
  }

  const globalPct = stats.total > 0 ? Math.round((stats.accepted / stats.total) * 100) : 0;

  const statusStyle = (status: string) => {
    if (status === 'covered') return { color: 'var(--success)' };
    if (status === 'partial') return { color: 'var(--warning)' };
    return { color: 'var(--danger)' };
  };

  const statusBg = (status: string) => {
    if (status === 'covered') return { background: 'var(--success-bg)', color: 'var(--success)' };
    if (status === 'partial') return { background: 'var(--warning-bg)', color: 'var(--warning)' };
    return { background: 'var(--danger-bg)', color: 'var(--danger)' };
  };

  const typeStyle = (type: string) => {
    if (type === 'functional') return { background: 'var(--success-bg)', color: 'var(--success)' };
    if (type === 'negative') return { background: 'var(--danger-bg)', color: 'var(--danger)' };
    if (type === 'edge-case') return { background: 'var(--info-bg)', color: 'var(--info)' };
    return { background: 'var(--purple-bg)', color: 'var(--purple)' }; // boundary
  };

  const priorityStyle = (priority: string) => {
    if (priority === 'high') return { background: 'var(--danger-bg)', color: 'var(--danger)' };
    if (priority === 'medium') return { background: 'var(--warning-bg)', color: 'var(--warning)' };
    return { background: 'var(--success-bg)', color: 'var(--success)' };
  };

  return (
    <div>
      <header className="mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Vue d'ensemble des scénarios de test</p>
      </header>

      {/* Metrics */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total', value: stats.total, color: 'var(--text)' },
          { label: 'Acceptés', value: stats.accepted, color: 'var(--success)' },
          { label: 'TNR', value: stats.tnr, color: 'var(--purple)' },
          { label: 'En attente', value: stats.total - stats.accepted, color: 'var(--warning)' },
          { label: 'Features', value: features.length, color: 'var(--text-muted)' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="text-[0.72rem] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-dim)' }}>{label}</div>
            <div className="text-2xl font-bold" style={{ color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Global Progress */}
      <div className="rounded-lg p-5 mb-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="flex justify-between items-center mb-3">
          <div className="text-[0.8rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Progression globale</div>
          <div className="text-lg font-bold" style={{ color: 'var(--accent)' }}>{globalPct}%</div>
        </div>
        <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
          <div
            className="h-full rounded-full transition-all duration-400"
            style={{
              width: `${globalPct}%`,
              background: globalPct >= 100 ? 'var(--success)' : globalPct >= 50 ? 'var(--warning)' : 'var(--danger)',
            }}
          />
        </div>
      </div>

      {/* Features */}
      <div className="text-[0.72rem] font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Par feature</div>
      <div className="space-y-2 mb-7">
        {features.map((f) => {
          const status = getStatus(f.accepted, f.total);
          const pct = f.total > 0 ? Math.round((f.accepted / f.total) * 100) : 0;
          return (
            <div key={f.name} className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => toggleExpand(f.name)}>
                <div className="w-2 h-2 rounded-full flex-shrink-0" style={statusStyle(status)} />
                <div className="flex-1 font-semibold text-sm">{f.name}</div>
                <div className="w-36 h-1.5 rounded-full overflow-hidden flex-shrink-0" style={{ background: 'var(--bg-hover)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: statusStyle(status).color }} />
                </div>
                <div className="text-[0.78rem] min-w-[52px] text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {f.accepted}/{f.total}
                </div>
                <div className="text-[0.7rem] px-2 py-0.5 rounded font-semibold flex-shrink-0" style={statusBg(status)}>
                  {status === 'covered' ? 'OK' : status === 'partial' ? 'Partiel' : 'À faire'}
                </div>
                {expanded.has(f.name)
                  ? <ChevronDown size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                  : <ChevronRight size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />}
              </div>
              {expanded.has(f.name) && f.scenarios.length > 0 && (
                <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                  {f.scenarios.map((sc) => (
                    <div key={sc.id} className="flex items-start gap-2.5 py-2 text-sm" style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                      {sc.accepted
                        ? <CheckCircle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--success)' }} />
                        : <Circle size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--text-dim)' }} />}
                      <div className="flex-1">
                        <div className="text-[0.7rem] mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{sc.scenario_id}</div>
                        <div className="font-medium">{sc.title}</div>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <span className="text-[0.68rem] px-1.5 py-0.5 rounded font-semibold" style={typeStyle(sc.scenario_type)}>{sc.scenario_type}</span>
                          <span className="text-[0.68rem] px-1.5 py-0.5 rounded font-semibold" style={priorityStyle(sc.priority)}>{sc.priority}</span>
                          {sc.is_tnr && <span className="text-[0.68rem] px-1.5 py-0.5 rounded font-semibold" style={{ background: 'var(--purple-bg)', color: 'var(--purple)' }}>TNR</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {features.length === 0 && !loading && (
        <div className="empty-state">
          <p>Aucun scénario généré pour ce projet.</p>
        </div>
      )}
    </div>
  );
}

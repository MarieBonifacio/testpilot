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
      <div className="text-center py-10 text-[var(--text-muted)]">
        <BarChart3 size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour voir le dashboard.</p>
      </div>
    );
  }

  const globalPct = stats.total > 0 ? Math.round((stats.accepted / stats.total) * 100) : 0;

  return (
    <div>
      <header className="mb-6 pb-4 border-b border-[var(--border)]">
        <h1 className="text-xl font-bold text-[var(--primary)]">Dashboard</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Vue d'ensemble des scénarios de test</p>
      </header>

      {/* Metrics */}
      <div className="grid grid-cols-5 gap-3.5 mb-7">
        <div className="bg-white border border-[var(--border)] rounded-lg p-4">
          <div className="text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Total</div>
          <div className="text-2xl font-bold text-[var(--primary)]">{stats.total}</div>
        </div>
        <div className="bg-white border border-[var(--border)] rounded-lg p-4">
          <div className="text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Acceptés</div>
          <div className="text-2xl font-bold text-[#28a745]">{stats.accepted}</div>
        </div>
        <div className="bg-white border border-[var(--border)] rounded-lg p-4">
          <div className="text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">TNR</div>
          <div className="text-2xl font-bold text-[#6f42c1]">{stats.tnr}</div>
        </div>
        <div className="bg-white border border-[var(--border)] rounded-lg p-4">
          <div className="text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">En attente</div>
          <div className="text-2xl font-bold text-[var(--warning)]">{stats.total - stats.accepted}</div>
        </div>
        <div className="bg-white border border-[var(--border)] rounded-lg p-4">
          <div className="text-[0.75rem] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Features</div>
          <div className="text-2xl font-bold text-[var(--text-muted)]">{features.length}</div>
        </div>
      </div>

      {/* Global Progress */}
      <div className="bg-white border border-[var(--border)] rounded-lg p-5 mb-7">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[0.85rem] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Progression globale</div>
          <div className="text-lg font-bold text-[var(--primary)]">{globalPct}%</div>
        </div>
        <div className="h-2.5 bg-[var(--bg-alt)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-400 ${
              globalPct >= 100 ? 'bg-[#28a745]' : globalPct >= 50 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'
            }`}
            style={{ width: `${globalPct}%` }}
          />
        </div>
      </div>

      {/* Features */}
      <div className="text-[0.75rem] font-bold text-[var(--text-muted)] uppercase tracking-wide mb-3.5">Par feature</div>
      <div className="space-y-3 mb-7">
        {features.map((f) => {
          const status = getStatus(f.accepted, f.total);
          const pct = f.total > 0 ? Math.round((f.accepted / f.total) * 100) : 0;
          return (
            <div key={f.name} className="bg-white border border-[var(--border)] rounded-lg p-4">
              <div
                className="flex items-center gap-3.5 cursor-pointer"
                onClick={() => toggleExpand(f.name)}
              >
                <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                  status === 'covered' ? 'bg-[#28a745]' : status === 'partial' ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'
                }`} />
                <div className="flex-1 font-semibold text-sm">{f.name}</div>
                <div className="w-44 h-2 bg-[var(--bg-alt)] rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className={`h-full rounded-full transition-all ${
                      status === 'covered' ? 'bg-[#28a745]' : status === 'partial' ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-[0.8rem] text-[var(--text-muted)] min-w-[64px] text-right flex-shrink-0">
                  {f.accepted}/{f.total}
                </div>
                <div className={`text-[0.72rem] px-2.5 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                  status === 'covered' ? 'bg-[#d4edda] text-[#155724]' : status === 'partial' ? 'bg-[#fff3cd] text-[#856404]' : 'bg-[#f8d7da] text-[#721c24]'
                }`}>
                  {status === 'covered' ? 'OK' : status === 'partial' ? 'Partiel' : 'À faire'}
                </div>
                {expanded.has(f.name) ? <ChevronDown size={16} className="text-[var(--text-muted)]" /> : <ChevronRight size={16} className="text-[var(--text-muted)]" />}
              </div>
              {expanded.has(f.name) && f.scenarios.length > 0 && (
                <div className="mt-3.5 pt-3.5 border-t border-[var(--border)]">
                  {f.scenarios.map((sc) => (
                    <div key={sc.id} className="flex items-start gap-2.5 py-2 border-b border-[var(--bg-alt)] text-sm last:border-0">
                      {sc.accepted ? <CheckCircle size={16} className="text-[#28a745] mt-1 flex-shrink-0" /> : <Circle size={16} className="text-[var(--text-muted)] mt-1 flex-shrink-0" />}
                      <div className="flex-1">
                        <div className="text-[0.72rem] font-mono text-[var(--text-muted)]">{sc.scenario_id}</div>
                        <div className="font-medium">{sc.title}</div>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <span className={`text-[0.68rem] px-1.5 py-0.5 rounded-full font-semibold ${
                            sc.scenario_type === 'functional' ? 'bg-[#d4edda] text-[#155724]' :
                            sc.scenario_type === 'negative' ? 'bg-[#f8d7da] text-[#721c24]' :
                            sc.scenario_type === 'edge-case' ? 'bg-[#d1ecf1] text-[#0c5460]' :
                            'bg-[#EEEDFE] text-[#534AB7]'
                          }`}>{sc.scenario_type}</span>
                          <span className={`text-[0.68rem] px-1.5 py-0.5 rounded-full font-semibold ${
                            sc.priority === 'high' ? 'bg-[#f8d7da] text-[#721c24]' :
                            sc.priority === 'medium' ? 'bg-[#fff3cd] text-[#856404]' :
                            'bg-[#d4edda] text-[#155724]'
                          }`}>{sc.priority}</span>
                          {sc.is_tnr && <span className="text-[0.68rem] px-1.5 py-0.5 rounded-full font-semibold bg-[#6f42c1] text-white">TNR</span>}
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
        <div className="text-center py-10 text-[var(--text-muted)]">
          <p>Aucun scénario généré pour ce projet.</p>
        </div>
      )}
    </div>
  );
}
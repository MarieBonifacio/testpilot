import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { scenariosApi, sessionsApi } from '../lib/api';
import type { Scenario } from '../types';
import { CheckCircle, XCircle, Ban, Clock, FlaskConical, Plus } from 'lucide-react';

type DisplayStatus = 'pass' | 'fail' | 'blocked';
interface LocalResult { id: number; scenario_id: number; status: DisplayStatus; }

export function Campagne() {
  const { projectId } = useProject();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [results, setResults] = useState<Record<number, LocalResult>>({});
  const [currentSession, setCurrentSession] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [projectId]);

  const loadData = async () => {
    if (!projectId) return;
    try {
      const scenariosData = await scenariosApi.list(projectId);
      setScenarios(scenariosData.filter(s => s.accepted));
    } catch (err) {
      console.error('Error loading campagne:', err);
    }
  };

  const startSession = async () => {
    if (!projectId) return;
    try {
      const session = await sessionsApi.create(projectId, { name: `Session ${new Date().toLocaleDateString()}` });
      setCurrentSession(session.id);
      setResults({});
    } catch (err) {
      console.error('Error starting session:', err);
    }
  };

  const setResult = async (scenarioId: number, status: DisplayStatus) => {
    if (!currentSession) return;
    try {
      await sessionsApi.addResult(currentSession, { scenario_id: scenarioId, status, notes: '' });
      setResults(prev => ({ ...prev, [scenarioId]: { id: Date.now(), scenario_id: scenarioId, status } }));
    } catch (err) {
      console.error('Error setting result:', err);
    }
  };

  const acceptedScenarios = scenarios;
  const passedCount   = Object.values(results).filter(r => r.status === 'pass').length;
  const failedCount   = Object.values(results).filter(r => r.status === 'fail').length;
  const blockedCount  = Object.values(results).filter(r => r.status === 'blocked').length;
  const pendingCount  = acceptedScenarios.length - passedCount - failedCount - blockedCount;
  const progress = acceptedScenarios.length > 0
    ? Math.round(((passedCount + failedCount + blockedCount) / acceptedScenarios.length) * 100)
    : 0;

  if (!projectId) {
    return (
      <div className="empty-state">
        <FlaskConical size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour gérer les campagnes.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Campagne de test</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Exécutez et suivez vos scénarios</p>
        </div>
        <button className="btn btn-primary" onClick={startSession}>
          <Plus size={14} />
          Nouvelle session
        </button>
      </div>

      {!currentSession && (
        <div className="rounded-lg p-4 mb-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Cliquez sur "Nouvelle session" pour démarrer une campagne.
          </p>
        </div>
      )}

      {acceptedScenarios.length === 0 ? (
        <div className="rounded-lg p-8 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <FlaskConical size={40} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-muted)' }}>Aucun scénario accepté. Générez et acceptez des scénarios dans la page Rédaction.</p>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="rounded-lg p-5 mb-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[0.78rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Progression</div>
              <div className="font-bold">{progress}%</div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: 'var(--bg-hover)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
            </div>
            <div className="flex gap-5 text-xs flex-wrap">
              <span className="flex items-center gap-1.5">
                <CheckCircle size={13} style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--success)' }}>{passedCount} passés</span>
              </span>
              <span className="flex items-center gap-1.5">
                <XCircle size={13} style={{ color: 'var(--danger)' }} />
                <span style={{ color: 'var(--danger)' }}>{failedCount} échoués</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Ban size={13} style={{ color: 'var(--purple)' }} />
                <span style={{ color: 'var(--purple)' }}>{blockedCount} bloqués</span>
              </span>
              <span className="flex items-center gap-1.5">
                <Clock size={13} style={{ color: 'var(--text-muted)' }} />
                <span style={{ color: 'var(--text-muted)' }}>{pendingCount} en attente</span>
              </span>
            </div>
          </div>

          {/* Scenarios */}
          <div className="space-y-4">
            {acceptedScenarios.map((sc) => {
              const result = results[sc.id ?? 0];
              return (
                <div key={sc.id} className="rounded-xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-[0.7rem] mb-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{sc.scenario_id}</div>
                      <div className="text-base font-bold">{sc.title}</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap flex-shrink-0">
                      <span className={`badge badge-type ${sc.scenario_type}`}>{sc.scenario_type}</span>
                      <span className={`badge badge-priority ${sc.priority}`}>{sc.priority}</span>
                      {sc.is_tnr && <span className="badge-tnr">TNR</span>}
                    </div>
                  </div>

                  <div className="grid gap-2.5 mb-5">
                    {[
                      { label: 'Given', text: sc.given_text, color: 'var(--info)' },
                      { label: 'When',  text: sc.when_text,  color: 'var(--warning)' },
                      { label: 'Then',  text: sc.then_text,  color: 'var(--accent)' },
                    ].map(({ label, text, color }) => (
                      <div key={label} className="pl-3" style={{ borderLeft: `2px solid ${color}` }}>
                        <div className="text-[0.68rem] font-bold uppercase mb-0.5" style={{ color: 'var(--text-dim)' }}>{label}</div>
                        <div className="text-sm">{text}</div>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-4 flex-wrap" style={{ borderTop: '1px solid var(--border)' }}>
                    {!currentSession && (
                      <p className="text-xs w-full" style={{ color: 'var(--text-dim)' }}>Démarrez une session pour saisir les résultats.</p>
                    )}
                    {([
                      { status: 'pass'    as DisplayStatus, label: 'Pass',    icon: <CheckCircle size={13} />, activeColor: 'var(--success)', activeBg: 'var(--success-bg)' },
                      { status: 'fail'    as DisplayStatus, label: 'Fail',    icon: <XCircle size={13} />,     activeColor: 'var(--danger)',  activeBg: 'var(--danger-bg)' },
                      { status: 'blocked' as DisplayStatus, label: 'Bloqué',  icon: <Ban size={13} />,         activeColor: 'var(--purple)',  activeBg: 'var(--purple-bg)' },
                    ]).map(({ status, label, icon, activeColor, activeBg }) => {
                      const active = result?.status === status;
                      return (
                        <button
                          key={status}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all"
                          style={active
                            ? { border: `1px solid ${activeColor}`, background: activeBg, color: activeColor }
                            : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }
                          }
                          onClick={() => sc.id != null && setResult(sc.id, status)}
                          disabled={!currentSession || sc.id == null}
                        >
                          {icon} {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

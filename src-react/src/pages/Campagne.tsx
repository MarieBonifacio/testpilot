import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { scenariosApi, sessionsApi } from '../lib/api';
import type { Scenario, Session } from '../types';
import { CheckCircle, XCircle, Ban, Clock, FlaskConical, Plus } from 'lucide-react';

/** Local display status (lowercase) — distinct from the DB status sent to API */
type DisplayStatus = 'pass' | 'fail' | 'blocked';
interface LocalResult { id: number; scenario_id: number; status: DisplayStatus; }

export function Campagne() {
  const { projectId } = useProject();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [results, setResults] = useState<Record<number, LocalResult>>({});
  const [currentSession, setCurrentSession] = useState<number | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [projectId]);

  const loadData = async () => {
    if (!projectId) return;
    try {
      const [scenariosData, sessionsData] = await Promise.all([
        scenariosApi.list(projectId),
        sessionsApi.list(projectId).catch(() => []),
      ]);
      setScenarios(scenariosData.filter(s => s.accepted));
      setSessions(sessionsData);
    } catch (err) {
      console.error('Error loading campagne:', err);
    }
  };

  const startSession = async () => {
    if (!projectId) return;
    try {
      const session = await sessionsApi.create(projectId, { name: `Session ${new Date().toLocaleDateString()}` });
      setSessions([...sessions, session]);
      setCurrentSession(session.id);
    } catch (err) {
      console.error('Error starting session:', err);
    }
  };

  const setResult = async (scenarioId: number, status: DisplayStatus) => {
    if (!currentSession) return;
    try {
      await sessionsApi.addResult(currentSession, { scenario_id: scenarioId, status, notes: '' });
      setResults({ ...results, [scenarioId]: { id: Date.now(), scenario_id: scenarioId, status } });
    } catch (err) {
      console.error('Error setting result:', err);
    }
  };

  const acceptedScenarios = scenarios.filter(s => s.accepted);
  const passedCount = Object.values(results).filter(r => r.status === 'pass').length;
  const failedCount = Object.values(results).filter(r => r.status === 'fail').length;
  const blockedCount = Object.values(results).filter(r => r.status === 'blocked').length;
  const progress = acceptedScenarios.length > 0 ? Math.round(((passedCount + failedCount + blockedCount) / acceptedScenarios.length) * 100) : 0;

  if (!projectId) {
    return (
      <div className="text-center py-10 text-[var(--text-muted)]">
        <FlaskConical size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour gérer les campagnes.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--primary)]">Campagne de test</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Exécutez et suivez vos scénarios</p>
        </div>
        <button className="btn btn-primary flex items-center gap-2" onClick={startSession}>
          <Plus size={16} />
          Nouvelle session
        </button>
      </div>

      {acceptedScenarios.length === 0 ? (
        <div className="bg-white border border-[var(--border)] rounded-lg p-8 text-center">
          <FlaskConical size={48} className="mx-auto mb-4 text-[var(--text-muted)] opacity-30" />
          <p className="text-[var(--text-muted)]">Aucun scénario accepté. Générez et acceptez des scénarios dans la page Rédaction.</p>
        </div>
      ) : (
        <>
          {/* Progress */}
          <div className="bg-white border border-[var(--border)] rounded-lg p-5 mb-6">
            <div className="flex justify-between items-center mb-2.5">
              <div className="text-[0.85rem] font-semibold text-[var(--text-muted)] uppercase">Progression</div>
              <div className="font-bold">{progress}%</div>
            </div>
            <div className="h-2 bg-[var(--bg-alt)] rounded-full overflow-hidden mb-3">
              <div className="h-full bg-[var(--primary)] rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex gap-4 text-sm">
              <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-[#28a745]" /> {passedCount} passés</span>
              <span className="flex items-center gap-1.5"><XCircle size={14} className="text-[var(--danger)]" /> {failedCount} échoués</span>
              <span className="flex items-center gap-1.5"><Ban size={14} className="text-[#534AB7]" /> {blockedCount} bloqués</span>
              <span className="flex items-center gap-1.5"><Clock size={14} className="text-[var(--text-muted)]" /> {acceptedScenarios.length - passedCount - failedCount - blockedCount} en attente</span>
            </div>
          </div>

          {/* Scenarios */}
          <div className="space-y-4">
            {acceptedScenarios.map((sc) => {
              const result = results[sc.id || 0];
              return (
                <div key={sc.id} className="bg-white border border-[var(--border)] rounded-xl p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-[0.75rem] font-mono text-[var(--text-muted)] mb-1">{sc.scenario_id}</div>
                      <div className="text-lg font-bold">{sc.title}</div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap flex-shrink-0">
                      <span className={`badge badge-type ${sc.scenario_type}`}>{sc.scenario_type}</span>
                      <span className={`badge badge-priority ${sc.priority}`}>{sc.priority}</span>
                      {sc.is_tnr && <span className="bg-[#6f42c1] text-white text-[0.65rem] font-bold px-1.5 py-0.5 rounded uppercase">TNR</span>}
                    </div>
                  </div>

                  <div className="grid gap-3 mb-5">
                    <div className="border-l-3 border-l-[#17a2b8] pl-3.5">
                      <div className="text-[0.72rem] font-bold text-[var(--text-muted)] uppercase mb-0.5">Given</div>
                      <div className="text-sm">{sc.given_text}</div>
                    </div>
                    <div className="border-l-3 border-l-[var(--warning)] pl-3.5">
                      <div className="text-[0.72rem] font-bold text-[var(--text-muted)] uppercase mb-0.5">When</div>
                      <div className="text-sm">{sc.when_text}</div>
                    </div>
                    <div className="border-l-3 border-l-[var(--primary)] pl-3.5">
                      <div className="text-[0.72rem] font-bold text-[var(--text-muted)] uppercase mb-0.5">Then</div>
                      <div className="text-sm">{sc.then_text}</div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-4 border-t border-[var(--border)]">
                    <button
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold border transition-all ${
                        result?.status === 'pass'
                          ? 'bg-[#28a745] border-transparent text-white'
                          : 'bg-white border-[#28a745] text-[#28a745] hover:bg-[#28a745] hover:text-white'
                      }`}
                      onClick={() => sc.id != null && setResult(sc.id, 'pass')}
                      disabled={!currentSession || sc.id == null}
                    >
                      <CheckCircle size={14} /> Pass
                    </button>
                    <button
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold border transition-all ${
                        result?.status === 'fail'
                          ? 'bg-[var(--danger)] border-transparent text-white'
                          : 'bg-white border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white'
                      }`}
                      onClick={() => sc.id != null && setResult(sc.id, 'fail')}
                      disabled={!currentSession || sc.id == null}
                    >
                      <XCircle size={14} /> Fail
                    </button>
                    <button
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold border transition-all ${
                        result?.status === 'blocked'
                          ? 'bg-[#534AB7] border-transparent text-white'
                          : 'bg-white border-[#534AB7] text-[#534AB7] hover:bg-[#534AB7] hover:text-white'
                      }`}
                      onClick={() => sc.id != null && setResult(sc.id, 'blocked')}
                      disabled={!currentSession || sc.id == null}
                    >
                      <Ban size={14} /> Bloqué
                    </button>
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
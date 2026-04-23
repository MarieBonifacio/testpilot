import { useState, useEffect, useRef } from 'react';
import { useProject } from '../lib/hooks';
import { scenariosApi, sessionsApi, campaignsApi, llmApi, kpisApi } from '../lib/api';
import type { Scenario, Session, FlakinessKPI } from '../types';
import { CheckCircle, XCircle, Ban, Clock, FlaskConical, Plus, Archive, RotateCcw, MessageSquare, Brain, Timer, AlertTriangle, ShieldCheck } from 'lucide-react';
import { formatDuration } from '../lib/duration';
import { OllamaStatusBadge } from '../components/OllamaStatusBadge';

type DisplayStatus = 'pass' | 'fail' | 'blocked';

interface LocalResult {
  id: number;
  scenario_id: number;
  status: DisplayStatus;
  comment: string;
}

export function Campagne() {
  const { projectId } = useProject();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [results, setResults] = useState<Record<number, LocalResult>>({});
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [pendingSessions, setPendingSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState<number | null>(null);
  const [filterTNR, setFilterTNR] = useState(false);
  const [isTNRSession, setIsTNRSession] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiAnalysing, setAiAnalysing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  // Timer session
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Durée archivée
  const [lastDurationSeconds, setLastDurationSeconds] = useState<number | null>(null);
  // Flakiness
  const [flakinessKpi, setFlakinessKpi] = useState<FlakinessKPI | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadData();
  }, [projectId]);

  // Nettoyage timer au démontage
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const loadData = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const [scenariosData, sessions] = await Promise.all([
        scenariosApi.list(projectId),
        sessionsApi.list(projectId),
      ]);
      setScenarios(scenariosData.filter(s => s.accepted));

      // Sessions ouvertes (sans finished_at)
      const open = sessions.filter((s: Session) => !s.finished_at);
      setPendingSessions(open);

      // Charger flakiness en arrière-plan (non bloquant)
      kpisApi.getFlakiness(projectId).then(setFlakinessKpi).catch(() => null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const startSession = async () => {
    if (!projectId) return;
    setError(null);
    try {
      const now = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const session = await sessionsApi.create(projectId, { name: `Campagne ${now}`, is_tnr: isTNRSession });
      setCurrentSession(session);
      setResults({});
      setArchived(false);
      setLastDurationSeconds(null);
      startTimer(session.started_at);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const resumeSession = (session: Session) => {
    setCurrentSession(session);
    setResults({});
    setArchived(false);
    setLastDurationSeconds(null);
    startTimer(session.started_at);
  };

  const startTimer = (startedAt: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    const startMs = new Date(startedAt).getTime();
    const tick = () => setElapsed(Math.floor((Date.now() - startMs) / 1000));
    tick();
    timerRef.current = setInterval(tick, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setElapsed(0);
  };

  const setResult = async (scenarioId: number, status: DisplayStatus) => {
    if (!currentSession) return;
    const existing = results[scenarioId];
    // Désélectionner si on reclique sur le même statut
    if (existing?.status === status) return;
    const comment = existing?.comment ?? '';
    try {
      await sessionsApi.addResult(currentSession.id, { scenario_id: scenarioId, status, notes: comment });
      setResults(prev => ({ ...prev, [scenarioId]: { id: Date.now(), scenario_id: scenarioId, status, comment } }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const updateComment = (scenarioId: number, comment: string) => {
    setResults(prev => {
      const existing = prev[scenarioId];
      if (!existing) return prev;
      return { ...prev, [scenarioId]: { ...existing, comment } };
    });
  };

  const finishAndArchive = async () => {
    if (!currentSession || !projectId) return;
    const resultList = Object.values(results);
    if (resultList.length === 0) {
      setError('Aucun résultat saisi — exécutez au moins un scénario avant d\'archiver.');
      return;
    }
    setArchiving(true);
    setError(null);
    try {
      // 1. Terminer la session
      const finishResult = await sessionsApi.finish(currentSession.id);
      stopTimer();
      if (finishResult.duration_seconds != null) {
        setLastDurationSeconds(finishResult.duration_seconds);
      }

      // 2. Calculer les KPIs
      const passCount    = resultList.filter(r => r.status === 'pass').length;
      const failCount    = resultList.filter(r => r.status === 'fail').length;
      const blockedCount = resultList.filter(r => r.status === 'blocked').length;
      const total        = displayedScenarios.length;
      const skipped      = total - resultList.length;

      // 3. Construire les résultats enrichis pour le stockage JSON
      const resultsJson = resultList.map(r => {
        const sc = scenarios.find(s => s.id === r.scenario_id);
        return {
          id:       sc?.scenario_id,
          title:    sc?.title,
          feature:  sc?.feature_name,
          status:   r.status,
          comment:  r.comment || null,
          priority: sc?.priority,
          is_tnr:   sc?.is_tnr,
          source_reference: sc?.source_reference,
          given:    sc?.given_text,
          when:     sc?.when_text,
          then:     sc?.then_text,
        };
      });

      // 4. Archiver la campagne
      await campaignsApi.archive(projectId, {
        name:        currentSession.session_name,
        type:        filterTNR ? 'TNR' : 'ALL',
        started_at:  currentSession.started_at,
        finished_at: new Date().toISOString(),
        total,
        pass:        passCount,
        fail:        failCount,
        blocked:     blockedCount,
        skipped,
        results:     resultsJson,
      } as Parameters<typeof campaignsApi.archive>[1] & { results?: unknown[] });

      setArchived(true);
      setCurrentSession(null);
      await loadData();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setArchiving(false);
    }
  };

  const analyseFailures = async () => {
    const failed = Object.values(results).filter(r => r.status === 'fail' || r.status === 'blocked');
    if (failed.length === 0) { setAiError('Aucun échec ou blocage à analyser.'); return; }
    setAiAnalysing(true);
    setAiError(null);
    setAiAnalysis(null);
    const failLines = failed.map(r => {
      const sc = scenarios.find(s => s.id === r.scenario_id);
      const statusLabel = r.status === 'fail' ? 'FAIL' : 'BLOQUÉ';
      return `- [${statusLabel}] ${sc?.title ?? r.scenario_id} (${sc?.feature_name ?? ''}) : ${r.comment || 'pas de commentaire'}`.trim();
    }).join('\n');
    const prompt = `Tu es un expert QA senior. Analyse les échecs et blocages suivants issus d'une campagne de recette :\n\n${failLines}\n\nPour chaque échec :\n1. Identifie la cause probable (bug, donnée de test, environnement, spécification ambigüe).\n2. Propose une action corrective concrète.\n3. Indique le niveau de risque résiduel (FAIBLE / MOY EN / ÉLEVÉ).\n\nRéponds en français, de façon structurée et concise.`;
    try {
      const analysis = await llmApi.call(prompt, { maxTokens: 1500 });
      setAiAnalysis(analysis);
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiAnalysing(false);
    }
  };

  const displayedScenarios = filterTNR
    ? scenarios.filter(s => s.is_tnr)
    : scenarios;

  const passedCount   = Object.values(results).filter(r => r.status === 'pass').length;
  const failedCount   = Object.values(results).filter(r => r.status === 'fail').length;
  const blockedCount  = Object.values(results).filter(r => r.status === 'blocked').length;
  const pendingCount  = displayedScenarios.length - passedCount - failedCount - blockedCount;
  const progress      = displayedScenarios.length > 0
    ? Math.round(((passedCount + failedCount + blockedCount) / displayedScenarios.length) * 100)
    : 0;
  const tnrCount = scenarios.filter(s => s.is_tnr).length;

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
      <OllamaStatusBadge />
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Campagne de test</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Exécutez et suivez vos scénarios</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* Filtre TNR */}
          {tnrCount > 0 && (
            <button
              onClick={() => setFilterTNR(f => !f)}
              className="px-3 py-1.5 rounded text-sm font-semibold"
              style={filterTNR
                ? { border: '1px solid var(--purple)', background: 'var(--purple-bg)', color: 'var(--purple)' }
                : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
            >
              TNR uniquement ({tnrCount})
            </button>
          )}
          <button className="btn btn-primary" onClick={startSession} disabled={!!currentSession}>
            <Plus size={14} />
            Nouvelle session
          </button>
          {!currentSession && (
            <button
              onClick={() => setIsTNRSession(f => !f)}
              className="px-3 py-1.5 rounded text-sm font-semibold flex items-center gap-1.5"
              style={isTNRSession
                ? { border: '1px solid var(--purple)', background: 'var(--purple-bg)', color: 'var(--purple)' }
                : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
              title="Marquer la prochaine session comme Campagne TNR"
            >
              <ShieldCheck size={13} />
              Campagne TNR
            </button>
          )}
          {currentSession && (
            <button
              className="btn btn-success"
              onClick={finishAndArchive}
              disabled={archiving || Object.keys(results).length === 0}
            >
              {archiving ? <div className="spinner" /> : <Archive size={14} />}
              {archiving ? 'Archivage…' : 'Terminer et archiver'}
            </button>
          )}
          {Object.values(results).some(r => r.status === 'fail' || r.status === 'blocked') && (
            <button
              className="btn btn-secondary"
              onClick={analyseFailures}
              disabled={aiAnalysing}
              title="Analyser les échecs avec l'IA"
            >
              {aiAnalysing ? <div className="spinner" /> : <Brain size={14} />}
              {aiAnalysing ? 'Analyse en cours…' : 'Analyser échecs IA'}
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {archived && (
        <div className="rounded p-3 mb-4" style={{ background: 'var(--success-bg)', border: '1px solid var(--success)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--success)' }}>
            <CheckCircle size={15} />
            Campagne archivée avec succès — visible dans Historique et COMEP.
            {lastDurationSeconds != null && (
              <span className="ml-auto font-normal text-xs flex items-center gap-1" style={{ color: 'var(--success)' }}>
                <Timer size={12} /> Durée : {formatDuration(lastDurationSeconds)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* AI failure analysis result */}
      {aiError && <div className="error-msg mb-4">{aiError}</div>}
      {aiAnalysis && (
        <div className="panel mb-5">
          <div className="flex items-center gap-2 mb-3">
            <Brain size={14} style={{ color: 'var(--accent)' }} />
            <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Analyse IA des échecs</span>
            <span className="text-[0.65rem] px-1.5 py-0.5 rounded ml-auto" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
              {llmApi.getActiveProviderLabel()}
            </span>
          </div>
          <pre className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-muted)', fontFamily: 'inherit', margin: 0 }}>{aiAnalysis}</pre>
        </div>
      )}

      {/* Sessions en cours non reprises */}
      {!currentSession && pendingSessions.length > 0 && (
        <div className="panel mb-5">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>
            Sessions en cours
          </div>
          <div className="space-y-2">
            {pendingSessions.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-3 text-sm">
                <div>
                  <span className="font-medium">{s.session_name}</span>
                  <span className="text-xs ml-2" style={{ color: 'var(--text-dim)' }}>
                    {new Date(s.started_at).toLocaleDateString('fr-FR')}
                  </span>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => resumeSession(s)}
                  style={{ padding: '4px 10px', fontSize: '0.75rem' }}
                >
                  <RotateCcw size={12} /> Reprendre
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bandeau session active */}
      {currentSession && (
        <div className="rounded-lg px-4 py-2.5 mb-5 flex items-center gap-3"
          style={{ background: 'var(--accent-bg)', border: '1px solid var(--accent)' }}>
          <FlaskConical size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
            Session active : <strong>{currentSession.session_name}</strong>
          </span>
          {isTNRSession && (
            <span className="text-[0.68rem] font-bold px-1.5 py-0.5 rounded"
              style={{ background: 'var(--purple-bg)', color: 'var(--purple)', border: '1px solid var(--purple)' }}>
              TNR
            </span>
          )}
          <span className="flex items-center gap-1 text-xs ml-auto" style={{ color: 'var(--text-dim)' }}>
            <Timer size={12} />
            {formatDuration(elapsed)}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
            {progress}% complété
          </span>
        </div>
      )}

      {!currentSession && !loading && pendingSessions.length === 0 && (
        <div className="rounded-lg p-4 mb-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Cliquez sur "Nouvelle session" pour démarrer une campagne.
          </p>
        </div>
      )}

      {loading && <div className="loader"><div className="spinner" /><span>Chargement…</span></div>}

      {displayedScenarios.length === 0 && !loading ? (
        <div className="rounded-lg p-8 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <FlaskConical size={40} className="mx-auto mb-3 opacity-20" style={{ color: 'var(--text-muted)' }} />
          <p style={{ color: 'var(--text-muted)' }}>
            {filterTNR ? 'Aucun scénario TNR accepté.' : 'Aucun scénario accepté. Générez et acceptez des scénarios dans la page Rédaction.'}
          </p>
        </div>
      ) : (
        <>
          {/* Barre de progression */}
          <div className="rounded-lg p-5 mb-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[0.78rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Progression</div>
              <div className="font-bold">{progress}%</div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden mb-4" style={{ background: 'var(--bg-hover)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'var(--accent)' }} />
            </div>
            <div className="flex gap-5 text-xs flex-wrap">
              {[
                { icon: <CheckCircle size={13} />, count: passedCount,  label: 'passés',   color: 'var(--success)' },
                { icon: <XCircle size={13} />,     count: failedCount,  label: 'échoués',  color: 'var(--danger)' },
                { icon: <Ban size={13} />,          count: blockedCount, label: 'bloqués',  color: 'var(--purple)' },
                { icon: <Clock size={13} />,        count: pendingCount, label: 'en attente', color: 'var(--text-muted)' },
              ].map(({ icon, count, label, color }) => (
                <span key={label} className="flex items-center gap-1.5">
                  <span style={{ color }}>{icon}</span>
                  <span style={{ color }}>{count} {label}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Liste des scénarios */}
          <div className="space-y-4">
            {displayedScenarios.map((sc) => {
              const result = results[sc.id ?? 0];
              const isCommentOpen = commentOpen === sc.id;
              return (
                <div key={sc.id} className="rounded-xl p-5"
                  style={{
                    background: 'var(--bg-elevated)',
                    border: `1px solid ${result?.status === 'pass' ? 'var(--success)' : result?.status === 'fail' ? 'var(--danger)' : result?.status === 'blocked' ? 'var(--purple)' : 'var(--border)'}`,
                  }}>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-[0.7rem] mb-1" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{sc.scenario_id}</div>
                      <div className="text-base font-bold">{sc.title}</div>
                      {sc.feature_name && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>{sc.feature_name}</div>
                      )}
                    </div>
                    <div className="flex gap-1.5 flex-wrap flex-shrink-0">
                      <span className={`badge badge-type ${sc.scenario_type}`}>{sc.scenario_type}</span>
                      <span className={`badge badge-priority ${sc.priority}`}>{sc.priority}</span>
                      {sc.is_tnr && <span className="badge-tnr">TNR</span>}
                      {sc.id != null && flakinessKpi && (() => {
                        const f = flakinessKpi.most_flaky.find(f => f.scenario_id === sc.id);
                        if (!f || f.flakiness_rate < 10) return null;
                        return (
                          <span
                            className="text-[0.65rem] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5"
                            style={{ background: 'var(--warning-bg, #fff8e1)', color: 'var(--warning)', border: '1px solid var(--warning)' }}
                            title={`Flakiness : ${f.flakiness_rate.toFixed(1)}%`}
                          >
                            <AlertTriangle size={10} />{f.flakiness_rate.toFixed(0)}%
                          </span>
                        );
                      })()}
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

                  {/* Actions Pass / Fail / Bloqué */}
                  <div className="flex gap-2 pt-4 flex-wrap items-center" style={{ borderTop: '1px solid var(--border)' }}>
                    {!currentSession && (
                      <p className="text-xs w-full" style={{ color: 'var(--text-dim)' }}>Démarrez une session pour saisir les résultats.</p>
                    )}
                    {([
                      { status: 'pass'    as DisplayStatus, label: 'Pass',   icon: <CheckCircle size={13} />, color: 'var(--success)', bg: 'var(--success-bg)' },
                      { status: 'fail'    as DisplayStatus, label: 'Fail',   icon: <XCircle size={13} />,    color: 'var(--danger)',  bg: 'var(--danger-bg)' },
                      { status: 'blocked' as DisplayStatus, label: 'Bloqué', icon: <Ban size={13} />,        color: 'var(--purple)',  bg: 'var(--purple-bg)' },
                    ]).map(({ status, label, icon, color, bg }) => {
                      const active = result?.status === status;
                      return (
                        <button
                          key={status}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all"
                          style={active
                            ? { border: `1px solid ${color}`, background: bg, color }
                            : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }
                          }
                          onClick={() => sc.id != null && setResult(sc.id, status)}
                          disabled={!currentSession || sc.id == null}
                        >
                          {icon} {label}
                        </button>
                      );
                    })}

                    {/* Bouton commentaire (visible uniquement si résultat saisi) */}
                    {result && sc.id != null && (
                      <button
                        className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-semibold ml-auto transition-all"
                        style={isCommentOpen
                          ? { border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)' }
                          : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-dim)' }}
                        onClick={() => setCommentOpen(isCommentOpen ? null : sc.id!)}
                      >
                        <MessageSquare size={12} />
                        {result.comment ? 'Commentaire' : 'Ajouter commentaire'}
                      </button>
                    )}
                  </div>

                  {/* Zone commentaire */}
                  {isCommentOpen && result && sc.id != null && (
                    <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                      <textarea
                        className="w-full text-xs rounded resize-none"
                        rows={2}
                        placeholder="Commentaire du testeur (optionnel)…"
                        value={result.comment}
                        onChange={e => updateComment(sc.id!, e.target.value)}
                        style={{ background: 'var(--bg)', border: '1px solid var(--border)', padding: '6px 8px', color: 'var(--text)' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bouton archiver en bas également */}
          {currentSession && Object.keys(results).length > 0 && (
            <div className="mt-6 flex justify-end">
              <button
                className="btn btn-success"
                onClick={finishAndArchive}
                disabled={archiving}
              >
                {archiving ? <div className="spinner" /> : <Archive size={14} />}
                {archiving ? 'Archivage en cours…' : `Terminer et archiver (${Object.keys(results).length}/${displayedScenarios.length} saisis)`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

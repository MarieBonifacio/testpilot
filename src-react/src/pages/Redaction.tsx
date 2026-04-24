import { useState, useEffect, useCallback } from 'react';
import { useProject, useAuth } from '../lib/hooks';
import { scenariosApi, analysesApi, usersApi, llmApi, userStoriesApi } from '../lib/api';
import type { Scenario, Analysis, User, ProviderKey, ProviderSettings, OllamaStatus, UserStory } from '../types';
import { Play, CheckCircle, Download, Trash2, UserCheck, ShieldCheck, XCircle, Send } from 'lucide-react';
import { PROVIDERS, ProviderFields } from '../components/ProviderFields';

type SourceType = 'user-story' | 'spec' | 'oral' | 'rule';

export function Redaction() {
  const { projectId, context } = useProject();
  const { user } = useAuth();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [userStories, setUserStories] = useState<UserStory[]>([]);
  const [selectedUserStoryId, setSelectedUserStoryId] = useState<number | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>('user-story');
  const [sourceText, setSourceText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentProvider, setCurrentProvider] = useState<ProviderKey>(() => {
    try {
      const stored = localStorage.getItem('testpilot_provider');
      if (!stored) return 'anthropic';
      const parsed = JSON.parse(stored) as Record<string, unknown>;
      const current = parsed._current as ProviderKey | undefined;
      return (current && ['anthropic','openai','mistral','ollama'].includes(current)) ? current : 'anthropic';
    } catch { return 'anthropic'; }
  });
  const [providerSettings, setProviderSettings] = useState<Record<ProviderKey, ProviderSettings>>(() => {
    const stored = localStorage.getItem('testpilot_provider');
    const parsed = stored ? JSON.parse(stored) : {};
    const result: Record<ProviderKey, ProviderSettings> = {} as Record<ProviderKey, ProviderSettings>;
    for (const [id, cfg] of Object.entries(PROVIDERS)) {
      const saved = parsed[id] as ProviderSettings | undefined;
      result[id as ProviderKey] = {
        key:      saved?.key      ?? '',
        model:    saved?.model    ?? cfg.models[0],
        endpoint: saved?.endpoint ?? cfg.endpoint ?? '',
        host:     saved?.host     ?? (id === 'ollama' ? 'http://localhost:11434' : ''),
      };
    }
    return result;
  });

  // Ollama dynamic models and status
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('unknown');
  const [ollamaChecking, setOllamaChecking] = useState(false);

  const isCP = user?.role === 'cp' || user?.role === 'admin';

  const loadScenarios = useCallback(async () => {
    if (!projectId) { setScenarios([]); setAnalysis(null); return; }
    try {
      const data = await scenariosApi.list(projectId);
      setScenarios(data);
      const anal = await analysesApi.get(projectId).catch(() => null);
      setAnalysis(anal);
    } catch (err) {
      console.error('Erreur chargement scénarios:', err);
    }
  }, [projectId]);

  useEffect(() => { loadScenarios(); }, [loadScenarios]);

  // Charger les User Stories pour le dropdown
  useEffect(() => {
    if (!projectId) {
      setUserStories([]);
      setSelectedUserStoryId(null);
      return;
    }
    userStoriesApi.list(projectId, { status: 'ready' })
      .then(stories => setUserStories(stories))
      .catch(() => setUserStories([]));
  }, [projectId]);

  // Charger les utilisateurs pour l'assignation (CP/admin uniquement)
  useEffect(() => {
    if (!isCP) return;
    usersApi.list().then(setUsers).catch(() => {});
  }, [isCP]);

  // Persist provider settings + _current so vanilla pages see the correct active provider
  useEffect(() => {
    const stored = localStorage.getItem('testpilot_provider');
    const existing = stored ? JSON.parse(stored) as Record<string, unknown> : {};
    const toSave = { ...existing, ...providerSettings, _current: currentProvider };
    localStorage.setItem('testpilot_provider', JSON.stringify(toSave));
  }, [providerSettings, currentProvider]);

  // Check Ollama health and fetch installed models — délégué à llmApi (pas de duplication)
  const checkOllama = useCallback(async () => {
    const host = providerSettings.ollama.host || 'http://localhost:11434';
    setOllamaChecking(true);
    setOllamaStatus('unknown');
    try {
      const health = await llmApi.checkOllamaHealth(host);
      if (health.ok) {
        setOllamaStatus('ok');
        const models = await llmApi.getOllamaModels(host).catch(() => [] as string[]);
        if (models.length > 0) {
          setOllamaModels(models);
          const curModel = providerSettings.ollama.model;
          if (!models.includes(curModel) && curModel !== '__custom__') {
            setProviderSettings(prev => ({ ...prev, ollama: { ...prev.ollama, model: models[0] } }));
          }
        }
      } else {
        setOllamaStatus('error');
      }
    } catch {
      setOllamaStatus('error');
    } finally {
      setOllamaChecking(false);
    }
  }, [providerSettings.ollama.host, providerSettings.ollama.model]);

  useEffect(() => {
    if (currentProvider === 'ollama') checkOllama();
  }, [currentProvider, checkOllama]);

  const buildPrompt = () => {
    const typeLabels: Record<SourceType, string> = {
      'user-story': 'User Story agile',
      spec: 'Spécification fonctionnelle',
      oral: 'Description orale retranscrite',
      rule: 'Règle de gestion métier',
    };
    const ctx = context;
    const contextBlock = (ctx?.adjacent_features || ctx?.global_constraints) ? `
CONTEXTE DU PROJET :
${ctx?.adjacent_features ? `- Features adjacentes à risque : ${ctx.adjacent_features}` : ''}
${ctx?.global_constraints ? `- Contraintes globales : ${ctx.global_constraints}` : ''}
` : '';

    // Détection de petits modèles Ollama qui nécessitent un prompt simplifié
    const settings = providerSettings[currentProvider];
    const model = settings.model === '__custom__' ? (settings.modelCustom || '') : settings.model;
    const isSmallModel = currentProvider === 'ollama' && (
      model.includes(':1b') || model.includes(':3b') || 
      model.startsWith('llama3.2:1b') || model.startsWith('phi')
    );

    if (isSmallModel) {
      // Version simplifiée pour petits modèles locaux
      return `Tu es un testeur QA. Génère des scénarios de test au format Given/When/Then pour cette source :

${sourceText}

Génère 3 à 5 scénarios de test. Pour chaque scénario, écris :
- "given" : l'état initial du système
- "when" : l'action effectuée par l'utilisateur
- "then" : le résultat attendu

Réponds en JSON (sans markdown) :
{
  "feature": "nom court de la fonctionnalité testée",
  "complexity": "simple",
  "ambiguities": [],
  "regressionRisks": [],
  "scenarios": [
    {
      "id": "SC-001",
      "type": "functional",
      "priority": "high",
      "title": "titre du scénario",
      "given": "état initial",
      "when": "action utilisateur",
      "then": "résultat attendu"
    }
  ]
}`;
    }

    // Version complète pour gros modèles (Claude, GPT, gros Ollama)
    return `Tu es un expert QA senior avec 15 ans d'expérience sur des projets de transformation SI.
Analyse la source suivante et génère des scénarios de tests structurés, précis et exploitables directement en campagne de recette.
${contextBlock}
SOURCE (type : ${typeLabels[sourceType]}) :
${sourceText}

INSTRUCTIONS DE GÉNÉRATION :
1. Détecte la feature principale testée (libellé court, max 5 mots).
2. Évalue la complexité : simple (1-2 chemins), moyenne (3-5), complexe (6+).
3. Identifie les préconditions implicites manquantes ou ambiguës dans la source (max 4).
4. Identifie les risques de régression sur d'autres features (max 3, sois spécifique).
5. Génère les scénarios selon la complexité :
   - simple   → 3-4 scénarios (1 nominal, 1-2 edge cases, 1 dégradé)
   - moyenne  → 5-6 scénarios (2 nominaux, 2-3 edge cases, 1-2 dégradés)
   - complexe → 7-8 scénarios (2 nominaux, 3-4 edge cases, 2 dégradés)
6. Pour chaque scénario :
   - Le "given" décrit l'état initial précis et les préconditions nécessaires
   - Le "when" décrit une action unique et atomique
   - Le "then" décrit le résultat vérifiable de manière objective

Réponds UNIQUEMENT en JSON valide, sans markdown, sans backticks, sans commentaires :
{
  "feature": "string",
  "complexity": "simple|moyenne|complexe",
  "ambiguities": ["string"],
  "regressionRisks": ["string"],
  "scenarios": [
    {
      "id": "SC-001",
      "type": "functional|negative|edge-case|boundary",
      "priority": "high|medium|low",
      "title": "string",
      "given": "string",
      "when": "string",
      "then": "string"
    }
  ]
}`;
  };

  const generate = async () => {
    setError(null);
    if (!projectId) { setError('Veuillez sélectionner un projet.'); return; }
    if (!sourceText.trim()) { setError('Veuillez entrer une description.'); return; }
    setLoading(true);
    // Timeout 90s via AbortController
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);
    try {
      const settings = providerSettings[currentProvider];
      const model = settings.model === '__custom__' ? (settings.modelCustom || '') : settings.model;
      // llmApi.call avec providerOverride pour utiliser les settings du state React
      const raw = await llmApi.call(buildPrompt(), {
        signal: controller.signal,
        providerOverride: { provider: currentProvider, ...settings, model },
      });
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Réponse IA invalide — JSON introuvable.');
      const parsed = JSON.parse(match[0]) as {
        feature?: string; complexity?: string;
        ambiguities?: string[]; regressionRisks?: string[];
        scenarios?: { id?: string; title?: string; type?: string; priority?: string; given?: string; when?: string; then?: string }[];
      };
      if (!Array.isArray(parsed.scenarios)) throw new Error('Format invalide — tableau de scénarios manquant.');

      await analysesApi.save(projectId, {
        feature_detected: parsed.feature ?? '',
        complexity: (parsed.complexity as Analysis['complexity']) ?? 'simple',
        ambiguities: parsed.ambiguities ?? [],
        regression_risks: parsed.regressionRisks ?? [],
      });

      const now = Date.now();
      const scenariosData = parsed.scenarios.map((s, i) => ({
        scenario_id: s.id ? `${s.id}-${now}` : `SC-${String(i + 1).padStart(3, '0')}-${now}`,
        title: s.title || `Scénario ${i + 1}`,
        scenario_type: (s.type as Scenario['scenario_type']) || 'functional',
        priority: (s.priority as Scenario['priority']) || 'medium',
        given_text: String(s.given || ''),
        when_text: String(s.when || ''),
        then_text: String(s.then || ''),
        feature_name: parsed.feature ?? '',
        accepted: false,
      }));

      const createdScenarios = await scenariosApi.create(projectId, scenariosData);

      // Si une User Story est sélectionnée, lier les scénarios créés à cette US
      if (selectedUserStoryId && Array.isArray(createdScenarios)) {
        for (const scenario of createdScenarios) {
          if (scenario.id) {
            try {
              await userStoriesApi.linkScenario(selectedUserStoryId, scenario.id);
            } catch (linkErr) {
              console.error('Erreur liaison scénario → US:', linkErr);
              // Continue même si le lien échoue
            }
          }
        }
      }

      await loadScenarios();
      setSourceText('');
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de la génération.');
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const toggleAccept   = async (sc: Scenario) => { if (!sc.id) return; await scenariosApi.toggleAccept(sc.id); await loadScenarios(); };
  const toggleTNR      = async (sc: Scenario) => { if (!sc.id) return; await scenariosApi.toggleTNR(sc.id);    await loadScenarios(); };
  const deleteScenario = async (sc: Scenario) => { if (!sc.id || !confirm('Supprimer ce scénario ?')) return;  await scenariosApi.delete(sc.id); await loadScenarios(); };
  const acceptAll      = async () => { if (!projectId) return; await scenariosApi.acceptAll(projectId); await loadScenarios(); };
  const clearAll       = async () => { if (!projectId || !confirm('Effacer tous les scénarios de ce projet ?')) return; await scenariosApi.deleteAll(projectId); await loadScenarios(); };

  const submitScenario   = async (sc: Scenario) => { if (!sc.id) return; try { await scenariosApi.submit(sc.id);              await loadScenarios(); } catch (e) { setError((e as Error).message); } };
  const validateScenario = async (sc: Scenario) => { if (!sc.id) return; try { await scenariosApi.validate(sc.id);            await loadScenarios(); } catch (e) { setError((e as Error).message); } };
  const rejectScenario   = async (sc: Scenario, reason: string) => { if (!sc.id) return; try { await scenariosApi.reject(sc.id, reason); await loadScenarios(); } catch (e) { setError((e as Error).message); } };
  const assignScenario   = async (sc: Scenario, userId: number | null) => { if (!sc.id) return; try { await scenariosApi.assign(sc.id, userId); await loadScenarios(); } catch (e) { setError((e as Error).message); } };

  const exportJSON = () => {
    const accepted = scenarios.filter(s => s.accepted);
    if (!accepted.length) { setError('Aucun scénario accepté.'); return; }
    const blob = new Blob([JSON.stringify(accepted, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `testpilot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 100);
  };

  const acceptedCount = scenarios.filter(s => s.accepted).length;

  return (
    <div>
      <header className="mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Rédaction</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Générateur de scénarios de tests assisté par IA</p>
      </header>

      {!projectId && (
        <div className="rounded-lg p-4 mb-6 flex items-center gap-3" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)' }}>
          <span style={{ color: 'var(--warning)', fontSize: '1.1rem' }}>⚠</span>
          <p className="text-sm font-medium m-0" style={{ color: 'var(--warning)' }}>Veuillez sélectionner un projet pour commencer.</p>
        </div>
      )}

      {/* Provider */}
      <div className="panel">
        <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Modèle IA</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(PROVIDERS).map(([id, cfg]) => (
            <button key={id} onClick={() => setCurrentProvider(id as ProviderKey)}
              className="px-3 py-1.5 rounded text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-all"
              style={currentProvider === id
                ? { border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)' }
                : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: currentProvider === id ? 'var(--accent)' : 'var(--border)' }} />
              {cfg.label}
              {cfg.offline && <span className="text-[0.65rem] font-bold px-1.5 rounded ml-1" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>offline</span>}
              {id === 'ollama' && currentProvider === 'ollama' && (
                <span className="w-1.5 h-1.5 rounded-full ml-1" style={{
                  background: ollamaStatus === 'ok' ? 'var(--success)' : ollamaStatus === 'error' ? 'var(--danger)' : 'var(--warning)',
                }} />
              )}
            </button>
          ))}
        </div>
        <ProviderFields
          provider={currentProvider}
          settings={providerSettings[currentProvider]}
          ollamaModels={ollamaModels}
          ollamaStatus={ollamaStatus}
          ollamaChecking={ollamaChecking}
          onCheckOllama={checkOllama}
          onChange={s => setProviderSettings(prev => ({ ...prev, [currentProvider]: s }))} />
      </div>

      {/* User Story Selection (optional) */}
      {userStories.length > 0 && (
        <div className="panel">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>User Story (optionnel)</div>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            Vous pouvez sélectionner une User Story existante. Les scénarios générés seront automatiquement liés à cette US.
          </p>
          <select
            className="w-full rounded text-sm"
            style={{ border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', padding: '0.5rem' }}
            value={selectedUserStoryId ?? ''}
            onChange={(e) => setSelectedUserStoryId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Aucune User Story (génération standalone)</option>
            {userStories.map(us => (
              <option key={us.id} value={us.id}>
                {us.title} {us.epic ? `[${us.epic}]` : ''} — {us.story_points || '?'} pts
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Source */}
      <div className="panel">
        <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Source</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['user-story', 'spec', 'oral', 'rule'] as SourceType[]).map(type => (
            <label key={type}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded cursor-pointer transition-all text-sm font-medium"
              style={sourceType === type
                ? { border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)' }
                : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>
              <input type="radio" name="sourceType" value={type} checked={sourceType === type} onChange={() => setSourceType(type)} className="hidden" />
              {type === 'user-story' && 'User Story'}{type === 'spec' && 'Spécification'}
              {type === 'oral' && 'Description orale'}{type === 'rule' && 'Règle de gestion'}
            </label>
          ))}
        </div>
        <textarea className="w-full rounded text-sm resize-y min-h-[140px]"
          placeholder="Colle ici ta user story, ta spec ou ta description fonctionnelle…"
          value={sourceText} onChange={e => setSourceText(e.target.value)} />
      </div>

      <div className="flex flex-wrap gap-2.5 mb-6">
        <button className="btn btn-primary" onClick={generate} disabled={loading || !projectId}><Play size={15} />Analyser et générer</button>
        <button className="btn btn-success" onClick={acceptAll} disabled={!projectId || scenarios.length === 0 || acceptedCount === scenarios.length}><CheckCircle size={15} />Tout accepter</button>
        <button className="btn btn-secondary" onClick={exportJSON} disabled={acceptedCount === 0}><Download size={15} />Exporter JSON</button>
        <button className="btn btn-secondary" onClick={clearAll} disabled={!projectId || scenarios.length === 0}><Trash2 size={15} />Effacer tout</button>
      </div>

      {loading && <div className="loader"><div className="spinner" /><span>Analyse en cours…</span></div>}
      {error && <div className="error-msg">{error}</div>}

      {/* Analyse */}
      {analysis && (
        <div className="panel">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Analyse de la source</div>
          <div className="grid grid-cols-3 gap-2.5 mb-3">
            <div className="rounded px-3 py-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              <div className="text-[0.72rem] mb-1" style={{ color: 'var(--text-muted)' }}>Feature détectée</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{analysis.feature_detected}</div>
            </div>
            <div className="rounded px-3 py-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              <div className="text-[0.72rem] mb-1" style={{ color: 'var(--text-muted)' }}>Complexité estimée</div>
              <span className="inline-block px-2 py-0.5 rounded text-xs font-semibold" style={
                analysis.complexity === 'simple' ? { background: 'var(--success-bg)', color: 'var(--success)' }
                : analysis.complexity === 'moyenne' ? { background: 'var(--warning-bg)', color: 'var(--warning)' }
                : { background: 'var(--danger-bg)', color: 'var(--danger)' }
              }>{analysis.complexity}</span>
            </div>
            <div className="rounded px-3 py-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
              <div className="text-[0.72rem] mb-1" style={{ color: 'var(--text-muted)' }}>Ambiguïtés</div>
              <div className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>{analysis.ambiguities?.length || 0}</div>
            </div>
          </div>
          {analysis.ambiguities?.length > 0 && (
            <div className="callout callout-amber">
              <div className="text-xs font-bold mb-1">Préconditions ambiguës</div>
              <ul className="text-[0.83rem] m-0 pl-4">{analysis.ambiguities.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
          )}
          {analysis.regression_risks?.length > 0 && (
            <div className="callout callout-purple mt-2">
              <div className="text-xs font-bold mb-1">Risques de régression</div>
              <ul className="text-[0.83rem] m-0 pl-4">{analysis.regression_risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {scenarios.length > 0 && (
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <h2 className="text-base font-bold">Scénarios générés</h2>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{acceptedCount} accepté / {scenarios.length} total</span>
        </div>
      )}

      <div className="space-y-4">
        {scenarios.map((sc, i) => (
          <ScenarioCard key={sc.id || i} scenario={sc} users={users} isCP={isCP}
            onToggleAccept={() => toggleAccept(sc)} onToggleTNR={() => toggleTNR(sc)}
            onDelete={() => deleteScenario(sc)} onSubmit={() => submitScenario(sc)}
            onValidate={() => validateScenario(sc)}
            onReject={reason => rejectScenario(sc, reason)}
            onAssign={userId => assignScenario(sc, userId)} />
        ))}
      </div>

      {scenarios.length === 0 && projectId && (
        <div className="empty-state">
          <p>Aucun scénario généré pour l'instant.</p>
          <p>Colle une source ci-dessus et clique sur "Analyser et générer".</p>
        </div>
      )}
    </div>
  );
}

// ── Statuts workflow ──────────────────────────────────────────────────────────
const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  draft:     { bg: 'var(--bg-hover)',    color: 'var(--text-dim)', label: 'Brouillon' },
  submitted: { bg: 'var(--warning-bg)', color: 'var(--warning)',   label: 'Soumis' },
  validated: { bg: 'var(--success-bg)', color: 'var(--success)',   label: 'Validé' },
  rejected:  { bg: 'var(--danger-bg)',  color: 'var(--danger)',    label: 'Rejeté' },
};

// ── ScenarioCard ──────────────────────────────────────────────────────────────
function ScenarioCard({
  scenario, users, isCP,
  onToggleAccept, onToggleTNR, onDelete,
  onSubmit, onValidate, onReject, onAssign,
}: {
  scenario: Scenario;
  users: User[];
  isCP: boolean;
  onToggleAccept: () => void;
  onToggleTNR: () => void;
  onDelete: () => void;
  onSubmit: () => void;
  onValidate: () => void;
  onReject: (reason: string) => void;
  onAssign: (userId: number | null) => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const status = scenario.validation_status ?? 'draft';
  const style = STATUS_STYLE[status] ?? STATUS_STYLE.draft;

  const handleReject = () => {
    onReject(rejectReason.trim());
    setRejectOpen(false);
    setRejectReason('');
  };

  return (
    <div className={`scenario-card ${scenario.accepted ? 'accepted' : ''}`}>
      {/* En-tête */}
      <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-[0.72rem] mb-0.5" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>{scenario.scenario_id}</div>
          <div className="font-semibold text-sm">{scenario.title}</div>
          {scenario.assignee_name && (
            <div className="text-[0.68rem] mt-0.5" style={{ color: 'var(--text-dim)' }}>
              Assigné à : <strong>{scenario.assignee_name}</strong>
            </div>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap flex-shrink-0 items-center">
          <span className={`badge badge-type ${scenario.scenario_type}`}>{scenario.scenario_type}</span>
          <span className={`badge badge-priority ${scenario.priority}`}>{scenario.priority}</span>
          {scenario.is_tnr && <span className="badge-tnr">TNR</span>}
          <span className="text-[0.67rem] px-1.5 py-0.5 rounded font-semibold"
            style={{ background: style.bg, color: style.color }}>{style.label}</span>
        </div>
      </div>

      {/* Given / When / Then */}
      <div className="mb-2"><div className="text-[0.72rem] font-bold uppercase mb-0.5" style={{ color: 'var(--text-dim)' }}>Given</div><div className="text-sm">{scenario.given_text}</div></div>
      <div className="mb-2"><div className="text-[0.72rem] font-bold uppercase mb-0.5" style={{ color: 'var(--text-dim)' }}>When</div><div className="text-sm">{scenario.when_text}</div></div>
      <div className="mb-3"><div className="text-[0.72rem] font-bold uppercase mb-0.5" style={{ color: 'var(--text-dim)' }}>Then</div><div className="text-sm">{scenario.then_text}</div></div>

      {/* Raison de rejet */}
      {status === 'rejected' && (scenario as Scenario & { rejection_reason?: string }).rejection_reason && (
        <div className="mb-3 px-3 py-2 rounded text-xs" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
          Rejet : {(scenario as Scenario & { rejection_reason?: string }).rejection_reason}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-1.5 pt-3 flex-wrap items-center" style={{ borderTop: '1px solid var(--border)' }}>
        {/* Accepter / TNR */}
        <button className="px-3 py-1 text-xs font-semibold rounded cursor-pointer transition-all"
          style={scenario.accepted
            ? { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }
            : { border: '1px solid var(--success)', background: 'var(--success-bg)', color: 'var(--success)' }}
          onClick={onToggleAccept}>
          {scenario.accepted ? '✓ Accepté — Retirer' : 'Accepter'}
        </button>
        <button className="px-2 py-1 text-xs font-semibold rounded cursor-pointer transition-all"
          style={scenario.is_tnr
            ? { border: '1px solid var(--purple)', background: 'var(--purple-bg)', color: 'var(--purple)' }
            : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
          onClick={onToggleTNR}>TNR</button>

        {/* Soumettre (brouillon ou rejeté → tous les rôles) */}
        {(status === 'draft' || status === 'rejected') && (
          <button className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded cursor-pointer"
            style={{ border: '1px solid var(--warning)', background: 'var(--warning-bg)', color: 'var(--warning)' }}
            onClick={onSubmit}>
            <Send size={11} /> Soumettre
          </button>
        )}

        {/* Valider / Rejeter (CP/admin si soumis) */}
        {isCP && status === 'submitted' && (
          <>
            <button className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded cursor-pointer"
              style={{ border: '1px solid var(--success)', background: 'var(--success-bg)', color: 'var(--success)' }}
              onClick={onValidate}>
              <ShieldCheck size={11} /> Valider
            </button>
            <button className="flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded cursor-pointer"
              style={{ border: '1px solid var(--danger)', background: 'var(--danger-bg)', color: 'var(--danger)' }}
              onClick={() => setRejectOpen(r => !r)}>
              <XCircle size={11} /> Rejeter
            </button>
          </>
        )}

        {/* Assignation (CP/admin) */}
        {isCP && (
          <div className="flex items-center gap-1 ml-auto">
            <UserCheck size={12} style={{ color: 'var(--text-dim)' }} />
            <select className="text-xs rounded"
              style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)', padding: '2px 6px' }}
              value={scenario.assigned_to ?? ''}
              onChange={e => onAssign(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Non assigné</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.role})</option>)}
            </select>
          </div>
        )}

        <button className="px-2 py-1 text-xs font-semibold rounded cursor-pointer"
          style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--danger)', marginLeft: isCP ? 0 : 'auto' }}
          onClick={onDelete}>Supprimer</button>
      </div>

      {/* Zone rejet */}
      {rejectOpen && (
        <div className="mt-3 pt-3 space-y-2" style={{ borderTop: '1px solid var(--border)' }}>
          <textarea className="w-full text-xs rounded resize-none" rows={2}
            placeholder="Raison du rejet (optionnel)…" value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            style={{ background: 'var(--bg)', border: '1px solid var(--danger)', padding: '6px 8px', color: 'var(--text)' }} />
          <div className="flex gap-2">
            <button className="px-3 py-1 text-xs font-semibold rounded"
              style={{ background: 'var(--danger)', color: 'var(--bg)', border: 'none', cursor: 'pointer' }}
              onClick={handleReject}>Confirmer le rejet</button>
            <button className="px-3 py-1 text-xs font-semibold rounded"
              style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
              onClick={() => setRejectOpen(false)}>Annuler</button>
          </div>
        </div>
      )}
    </div>
  );
}

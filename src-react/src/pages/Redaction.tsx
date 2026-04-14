import { useState, useEffect, useCallback } from 'react';
import { useProject } from '../lib/hooks';
import { scenariosApi, analysesApi } from '../lib/api';
import type { Scenario, Analysis } from '../types';
import { Play, CheckCircle, Download, Trash2 } from 'lucide-react';

type SourceType = 'user-story' | 'spec' | 'oral' | 'rule';
type ProviderKey = 'anthropic' | 'openai' | 'mistral' | 'ollama';

interface ProviderConfig {
  label: string;
  needsKey: boolean;
  endpoint?: string;
  keyPlaceholder?: string;
  endpointEditable?: boolean;
  offline?: boolean;
  models: string[];
}

interface ProviderSettings {
  key: string;
  model: string;
  endpoint: string;
  modelCustom?: string;
}

const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  anthropic: {
    label: 'Anthropic Claude',
    needsKey: true,
    endpoint: 'https://api.anthropic.com/v1/messages',
    keyPlaceholder: 'sk-ant-api03-...',
    models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514'],
  },
  openai: {
    label: 'OpenAI / Azure',
    needsKey: true,
    endpointEditable: true,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    keyPlaceholder: 'sk-...',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
  },
  mistral: {
    label: 'Mistral AI',
    needsKey: true,
    endpoint: 'https://api.mistral.ai/v1/chat/completions',
    keyPlaceholder: 'Clé API Mistral...',
    models: ['mistral-large-latest', 'mistral-small-latest', 'open-mistral-nemo'],
  },
  ollama: {
    label: 'Ollama (local)',
    needsKey: false,
    endpointEditable: true,
    offline: true,
    endpoint: 'http://localhost:11434/v1/chat/completions',
    models: ['llama3.2', 'mistral', 'qwen2.5-coder', 'phi4', 'deepseek-r1'],
  },
};

export function Redaction() {
  const { projectId, context } = useProject();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [sourceType, setSourceType] = useState<SourceType>('user-story');
  const [sourceText, setSourceText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentProvider, setCurrentProvider] = useState<ProviderKey>('anthropic');
  const [providerSettings, setProviderSettings] = useState<Record<ProviderKey, ProviderSettings>>(() => {
    const stored = localStorage.getItem('testpilot_provider');
    const parsed = stored ? JSON.parse(stored) : {};
    const result: Record<ProviderKey, ProviderSettings> = {} as Record<ProviderKey, ProviderSettings>;
    for (const [id, cfg] of Object.entries(PROVIDERS)) {
      result[id as ProviderKey] = parsed[id] || { key: '', model: cfg.models[0], endpoint: cfg.endpoint || '' };
    }
    return result;
  });

  const loadScenarios = useCallback(async () => {
    if (!projectId) {
      setScenarios([]);
      setAnalysis(null);
      return;
    }
    try {
      const data = await scenariosApi.list(projectId);
      setScenarios(data);
      const anal = await analysesApi.get(projectId).catch(() => null);
      setAnalysis(anal);
    } catch (err) {
      console.error('Erreur chargement scénarios:', err);
    }
  }, [projectId]);

  useEffect(() => {
    loadScenarios();
  }, [loadScenarios]);

  useEffect(() => {
    localStorage.setItem('testpilot_provider', JSON.stringify(providerSettings));
  }, [providerSettings]);

  const buildPrompt = () => {
    const typeLabels: Record<SourceType, string> = {
      'user-story': 'User Story agile',
      spec: 'Spécification fonctionnelle',
      oral: 'Description orale retranscrite',
      rule: 'Règle de gestion métier',
    };

    const ctx = context;
    const contextBlock = (ctx?.adjacent_features || ctx?.global_constraints)
      ? `
CONTEXTE DU PROJET :
${ctx?.adjacent_features ? `- Features adjacentes à risque : ${ctx.adjacent_features}` : ''}
${ctx?.global_constraints ? `- Contraintes globales : ${ctx.global_constraints}` : ''}
`
      : '';

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
   - Les edge cases doivent couvrir : valeurs nulles/vides, limites numériques, états concurrents, rôles utilisateur distincts
   - Les cas dégradés doivent couvrir : erreurs réseau, données incohérentes, indisponibilité de service tiers

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

  const callLLM = async (prompt: string) => {
    const provider = PROVIDERS[currentProvider];
    const settings = providerSettings[currentProvider];
    const model = settings.model === '__custom__' ? (settings.modelCustom || '') : settings.model;

    if (provider.needsKey && !settings.key) throw new Error(`Clé API ${provider.label} manquante.`);
    if (!model) throw new Error('Aucun modèle sélectionné.');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60_000);

    try {
      if (currentProvider === 'anthropic') {
        const res = await fetch(settings.endpoint, {
          signal: controller.signal,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': settings.key, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }),
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error?.message || `Erreur Anthropic ${res.status}`);
        }
        const data = await res.json();
        return data.content.filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
      }

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider.needsKey) headers['Authorization'] = `Bearer ${settings.key}`;
      const res = await fetch(settings.endpoint, {
        signal: controller.signal,
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.2 }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error?.message || `Erreur ${provider.label} ${res.status}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Délai dépassé — pas de réponse de l\'API après 60 secondes.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  const generate = async () => {
    setError(null);
    if (!projectId) {
      setError('Veuillez sélectionner un projet.');
      return;
    }
    if (!sourceText.trim()) {
      setError('Veuillez entrer une description.');
      return;
    }

    setLoading(true);
    try {
      const raw = await callLLM(buildPrompt());
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Réponse IA invalide — JSON introuvable.');
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed.scenarios)) throw new Error('Format invalide — tableau de scénarios manquant.');

      const analysisData: Omit<Analysis, 'id'> = {
        feature_detected: parsed.feature,
        complexity: parsed.complexity,
        ambiguities: parsed.ambiguities || [],
        regression_risks: parsed.regressionRisks || [],
      };

      await analysesApi.save(projectId, analysisData);

      const scenariosData = parsed.scenarios.map((s: { id?: string; title?: string; type?: string; priority?: string; given?: string; when?: string; then?: string }, i: number) => ({
        scenario_id: s.id || `SC-${String(i + 1).padStart(3, '0')}`,
        title: s.title || '',
        scenario_type: (s.type as Scenario['scenario_type']) || 'functional',
        priority: (s.priority as Scenario['priority']) || 'medium',
        given_text: s.given || '',
        when_text: s.when || '',
        then_text: s.then || '',
        feature_name: parsed.feature,
        accepted: false,
      }));

      await scenariosApi.create(projectId, scenariosData);
      await loadScenarios();
      setSourceText('');
    } catch (err) {
      setError((err as Error).message || 'Erreur lors de la génération.');
    } finally {
      setLoading(false);
    }
  };

  const toggleAccept = async (scenario: Scenario) => {
    if (!scenario.id) return;
    try {
      await scenariosApi.toggleAccept(scenario.id);
      await loadScenarios();
    } catch (err) {
      setError('Erreur: ' + (err as Error).message);
    }
  };

  const toggleTNR = async (scenario: Scenario) => {
    if (!scenario.id) return;
    try {
      await scenariosApi.toggleTNR(scenario.id);
      await loadScenarios();
    } catch (err) {
      setError('Erreur: ' + (err as Error).message);
    }
  };

  const deleteScenario = async (scenario: Scenario) => {
    if (!scenario.id || !confirm('Supprimer ce scénario ?')) return;
    try {
      await scenariosApi.delete(scenario.id);
      await loadScenarios();
    } catch (err) {
      setError('Erreur: ' + (err as Error).message);
    }
  };

  const acceptAll = async () => {
    if (!projectId) return;
    try {
      await scenariosApi.acceptAll(projectId);
      await loadScenarios();
    } catch (err) {
      setError('Erreur: ' + (err as Error).message);
    }
  };

  const clearAll = async () => {
    if (!projectId || !confirm('Effacer tous les scénarios de ce projet ?')) return;
    try {
      await scenariosApi.deleteAll(projectId);
      await loadScenarios();
    } catch (err) {
      setError('Erreur: ' + (err as Error).message);
    }
  };

  const exportJSON = () => {
    const accepted = scenarios.filter((s) => s.accepted);
    if (!accepted.length) {
      setError('Aucun scénario accepté.');
      return;
    }
    const data = JSON.stringify(accepted, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `testpilot-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const acceptedCount = scenarios.filter((s) => s.accepted).length;

  return (
    <div>
      <header className="mb-6 pb-4 border-b border-[var(--border)]">
        <h1 className="text-xl font-bold text-[var(--primary)]">TestPilot</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Générateur de scénarios de tests assisté par IA</p>
      </header>

      {!projectId && (
        <div className="bg-[#fff3cd] border border-[#ffc107] rounded-lg p-5 mb-6 flex items-center gap-4">
          <span className="text-2xl">⚠️</span>
          <p className="text-[#856404] font-medium m-0">Veuillez sélectionner un projet pour commencer.</p>
        </div>
      )}

      {/* Provider */}
      <div className="panel">
        <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-3">Modèle IA</div>
        <div className="flex flex-wrap gap-2 mb-4">
          {Object.entries(PROVIDERS).map(([id, cfg]) => (
            <button
              key={id}
              onClick={() => setCurrentProvider(id as ProviderKey)}
              className={`px-3 py-1.5 border rounded-md text-sm font-semibold cursor-pointer flex items-center gap-1.5 transition-all ${
                currentProvider === id
                  ? 'border-[var(--primary)] bg-[rgba(59,109,17,0.08)] text-[var(--primary)]'
                  : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)]'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${currentProvider === id ? 'bg-[var(--primary)]' : 'bg-[var(--border)]'}`} />
              {cfg.label}
              {cfg.offline && <span className="bg-[#d4edda] text-[#155724] text-[0.65rem] font-bold px-1.5 rounded-full ml-1">offline</span>}
            </button>
          ))}
        </div>
        <ProviderFields provider={currentProvider} settings={providerSettings[currentProvider]} onChange={(s) => setProviderSettings({ ...providerSettings, [currentProvider]: s })} />
      </div>

      {/* Source */}
      <div className="panel">
        <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-3">Source</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {(['user-story', 'spec', 'oral', 'rule'] as SourceType[]).map((type) => (
            <label key={type} className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border)] rounded-md cursor-pointer transition-all">
              <input
                type="radio"
                name="sourceType"
                value={type}
                checked={sourceType === type}
                onChange={() => setSourceType(type)}
                className="hidden"
              />
              <span className={`text-sm font-medium ${sourceType === type ? 'text-[var(--primary)]' : 'text-[var(--text-muted)]'}`}>
                {type === 'user-story' && 'User Story'}
                {type === 'spec' && 'Spécification'}
                {type === 'oral' && 'Description orale'}
                {type === 'rule' && 'Règle de gestion'}
              </span>
            </label>
          ))}
        </div>
        <textarea
          className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm bg-white min-h-[140px] resize-y" style={{ fontFamily: 'inherit' }}
          placeholder="Colle ici ta user story, ta spec ou ta description fonctionnelle…"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2.5 mb-6">
        <button className="btn btn-primary flex items-center gap-2" onClick={generate} disabled={loading || !projectId}>
          <Play size={16} />
          Analyser et générer
        </button>
        <button className="btn btn-success" onClick={acceptAll} disabled={!projectId || scenarios.length === 0 || acceptedCount === scenarios.length}>
          <CheckCircle size={16} />
          Tout accepter
        </button>
        <button className="btn btn-secondary" onClick={exportJSON} disabled={acceptedCount === 0}>
          <Download size={16} />
          Exporter JSON
        </button>
        <button className="btn btn-secondary" onClick={clearAll} disabled={!projectId || scenarios.length === 0}>
          <Trash2 size={16} />
          Effacer tout
        </button>
      </div>

      {loading && (
        <div className="loader">
          <div className="spinner" />
          <span>Analyse en cours…</span>
        </div>
      )}

      {error && <div className="error-msg flex items-center gap-2">{error}</div>}

      {/* Analysis */}
      {analysis && (
        <div className="panel">
          <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-3">Analyse de la source</div>
          <div className="grid grid-cols-3 gap-2.5 mb-3">
            <div className="bg-white border border-[var(--border)] rounded-md px-3 py-2">
              <div className="text-[0.72rem] text-[var(--text-muted)] mb-1">Feature détectée</div>
              <div className="text-sm font-semibold text-[var(--primary)]">{analysis.feature_detected}</div>
            </div>
            <div className="bg-white border border-[var(--border)] rounded-md px-3 py-2">
              <div className="text-[0.72rem] text-[var(--text-muted)] mb-1">Complexité estimée</div>
              <div className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${
                analysis.complexity === 'simple' ? 'bg-[#d4edda] text-[#155724]' :
                analysis.complexity === 'moyenne' ? 'bg-[#fff3cd] text-[#856404]' :
                'bg-[#f8d7da] text-[#721c24]'
              }`}>
                {analysis.complexity}
              </div>
            </div>
            <div className="bg-white border border-[var(--border)] rounded-md px-3 py-2">
              <div className="text-[0.72rem] text-[var(--text-muted)] mb-1">Ambiguïtés</div>
              <div className="text-sm font-semibold text-[var(--primary)]">{analysis.ambiguities?.length || 0}</div>
            </div>
          </div>
          {analysis.ambiguities?.length > 0 && (
            <div className="callout callout-amber">
              <div className="text-xs font-bold mb-1 text-[#854F0B]">Préconditions ambiguës</div>
              <ul className="text-[0.83rem] text-[#633806] m-0 pl-4">
                {analysis.ambiguities.map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
          {analysis.regression_risks?.length > 0 && (
            <div className="callout callout-purple mt-2">
              <div className="text-xs font-bold mb-1 text-[#3C3489]">Risques de régression</div>
              <ul className="text-[0.83rem] text-[#534AB7] m-0 pl-4">
                {analysis.regression_risks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {scenarios.length > 0 && (
        <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
          <h2 className="text-base font-bold">Scénarios générés</h2>
          <span className="text-sm text-[var(--text-muted)]">{acceptedCount} accepté / {scenarios.length} total</span>
        </div>
      )}

      <div className="space-y-4">
        {scenarios.map((sc, i) => (
          <ScenarioCard
            key={sc.id || i}
            scenario={sc}
            onToggleAccept={() => toggleAccept(sc)}
            onToggleTNR={() => toggleTNR(sc)}
            onDelete={() => deleteScenario(sc)}
          />
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

function ProviderFields({ provider, settings, onChange }: { provider: ProviderKey; settings: ProviderSettings; onChange: (s: ProviderSettings) => void }) {
  const cfg = PROVIDERS[provider];

  return (
    <div className="space-y-3">
      {cfg.needsKey && (
        <div>
          <div className="text-xs font-semibold text-[var(--text-muted)] mb-1">Clé API</div>
          <input
            type="password"
            className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm"
            placeholder={cfg.keyPlaceholder}
            value={settings.key}
            onChange={(e) => onChange({ ...settings, key: e.target.value })}
          />
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold text-[var(--text-muted)] mb-1">Modèle</div>
          <select
            className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm bg-white"
            value={settings.model}
            onChange={(e) => onChange({ ...settings, model: e.target.value })}
          >
            {cfg.models.map((m) => <option key={m} value={m}>{m}</option>)}
            <option value="__custom__">Autre (saisir)…</option>
          </select>
          {settings.model === '__custom__' && (
            <input
              type="text"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm mt-2"
              placeholder="ex : llama3.2:latest"
              value={settings.modelCustom || ''}
              onChange={(e) => onChange({ ...settings, modelCustom: e.target.value })}
            />
          )}
        </div>
        {cfg.endpointEditable && (
          <div>
            <div className="text-xs font-semibold text-[var(--text-muted)] mb-1">Endpoint URL</div>
            <input
              type="text"
              className="w-full px-3 py-2 border border-[var(--border)] rounded-md text-sm"
              value={settings.endpoint}
              onChange={(e) => onChange({ ...settings, endpoint: e.target.value })}
            />
          </div>
        )}
      </div>
      {cfg.offline && (
        <div className="text-xs text-[var(--text-muted)]">
          Ollama doit tourner localement — <a href="https://ollama.ai" target="_blank" rel="noopener" className="text-[var(--primary)]">ollama.ai</a>
          puis <code className="bg-[var(--bg-alt)] px-1 rounded">ollama serve</code>
        </div>
      )}
    </div>
  );
}

function ScenarioCard({ scenario, onToggleAccept, onToggleTNR, onDelete }: { scenario: Scenario; onToggleAccept: () => void; onToggleTNR: () => void; onDelete: () => void }) {
  return (
    <div className={`scenario-card ${scenario.accepted ? 'accepted' : ''}`}>
      <div className="flex justify-between items-start mb-3 gap-3 flex-wrap">
        <div>
          <div className="text-[0.72rem] font-mono text-[var(--text-muted)]">{scenario.scenario_id}</div>
          <div className="font-semibold text-sm">{scenario.title}</div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <span className={`badge badge-type ${scenario.scenario_type}`}>{scenario.scenario_type}</span>
          <span className={`badge badge-priority ${scenario.priority}`}>{scenario.priority}</span>
          {scenario.is_tnr && <span className="bg-[#6f42c1] text-white text-[0.65rem] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">TNR</span>}
        </div>
      </div>
      <div className="mb-2">
        <div className="text-[0.72rem] font-bold text-[var(--text-muted)] uppercase mb-0.5">Given</div>
        <div className="text-sm">{scenario.given_text}</div>
      </div>
      <div className="mb-2">
        <div className="text-[0.72rem] font-bold text-[var(--text-muted)] uppercase mb-0.5">When</div>
        <div className="text-sm">{scenario.when_text}</div>
      </div>
      <div className="mb-3">
        <div className="text-[0.72rem] font-bold text-[var(--text-muted)] uppercase mb-0.5">Then</div>
        <div className="text-sm">{scenario.then_text}</div>
      </div>
      <div className="flex gap-1.5 pt-3 border-t border-[var(--border)] flex-wrap">
        <button
          className={`px-3 py-1 text-xs font-semibold rounded border cursor-pointer transition-all ${
            scenario.accepted
              ? 'bg-white border-[var(--border)] text-[var(--text)] hover:border-[var(--primary)]'
              : 'bg-[var(--success)] border-transparent text-white hover:bg-[#218838]'
          }`}
          onClick={onToggleAccept}
        >
          {scenario.accepted ? '✓ Accepté — Retirer' : 'Accepter'}
        </button>
        <button
          className={`px-2 py-1 text-xs font-semibold border rounded cursor-pointer transition-all ${
            scenario.is_tnr
              ? 'bg-[#6f42c1] border-transparent text-white'
              : 'bg-white border-[#6f42c1] text-[#6f42c1] hover:bg-[#6f42c1] hover:text-white'
          }`}
          onClick={onToggleTNR}
        >
          TNR
        </button>
        <button className="px-2 py-1 text-xs font-semibold border border-[var(--border)] rounded bg-white text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white cursor-pointer ml-auto" onClick={onDelete}>
          Supprimer
        </button>
      </div>
    </div>
  );
}
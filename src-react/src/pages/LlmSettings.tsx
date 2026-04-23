import { useState, useEffect, useCallback } from 'react';
import { llmApi } from '../lib/api';
import type { ProviderKey, ProviderSettings, OllamaStatus } from '../types';
import { PROVIDERS, ProviderFields } from '../components/ProviderFields';
import { Save, Cpu } from 'lucide-react';

const PROVIDER_KEYS: ProviderKey[] = ['anthropic', 'openai', 'mistral', 'ollama'];

function loadSettings(): { current: ProviderKey; settings: Record<ProviderKey, ProviderSettings> } {
  try {
    const stored = localStorage.getItem('testpilot_provider');
    const parsed = stored ? JSON.parse(stored) as Record<string, unknown> : {};
    const current = (parsed._current as ProviderKey | undefined) ?? 'anthropic';
    const settings = {} as Record<ProviderKey, ProviderSettings>;
    for (const [id, cfg] of Object.entries(PROVIDERS)) {
      const saved = parsed[id] as ProviderSettings | undefined;
      settings[id as ProviderKey] = {
        key:         saved?.key         ?? '',
        model:       saved?.model       ?? cfg.models[0],
        endpoint:    saved?.endpoint    ?? cfg.endpoint ?? '',
        host:        saved?.host        ?? (id === 'ollama' ? 'http://localhost:11434' : ''),
        modelCustom: saved?.modelCustom ?? '',
      };
    }
    return { current, settings };
  } catch {
    const settings = {} as Record<ProviderKey, ProviderSettings>;
    for (const [id, cfg] of Object.entries(PROVIDERS)) {
      settings[id as ProviderKey] = { key: '', model: cfg.models[0], endpoint: cfg.endpoint ?? '', host: id === 'ollama' ? 'http://localhost:11434' : '' };
    }
    return { current: 'anthropic', settings };
  }
}

export function LlmSettings() {
  const initial = loadSettings();
  const [currentProvider, setCurrentProvider] = useState<ProviderKey>(initial.current);
  const [providerSettings, setProviderSettings] = useState<Record<ProviderKey, ProviderSettings>>(initial.settings);
  const [ollamaModels, setOllamaModels] = useState<string[]>(() => llmApi.getCachedOllamaModels());
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>('unknown');
  const [ollamaChecking, setOllamaChecking] = useState(false);
  const [saved, setSaved] = useState(false);

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

  // Auto-check Ollama if it's the active provider on mount
  useEffect(() => {
    if (currentProvider === 'ollama') checkOllama();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = () => {
    try {
      const stored = localStorage.getItem('testpilot_provider');
      const existing = stored ? JSON.parse(stored) as Record<string, unknown> : {};
      const toSave = { ...existing, ...providerSettings, _current: currentProvider };
      localStorage.setItem('testpilot_provider', JSON.stringify(toSave));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Cpu size={20} style={{ color: 'var(--accent)' }} />
        <h1 className="text-xl font-bold">Paramètres LLM</h1>
      </div>

      <div className="panel p-5 max-w-xl">
        {/* Provider tabs */}
        <div className="flex gap-1 mb-5 flex-wrap">
          {PROVIDER_KEYS.map(id => (
            <button key={id}
              onClick={() => { setCurrentProvider(id); if (id === 'ollama') checkOllama(); }}
              className="px-3 py-1.5 rounded text-xs font-semibold cursor-pointer transition-all"
              style={currentProvider === id
                ? { background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)' }
                : { background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              {PROVIDERS[id].label}
              {PROVIDERS[id].offline && <span className="ml-1 text-[0.6rem] opacity-70">local</span>}
            </button>
          ))}
        </div>

        {/* Provider fields */}
        <ProviderFields
          provider={currentProvider}
          settings={providerSettings[currentProvider]}
          ollamaModels={ollamaModels}
          ollamaStatus={ollamaStatus}
          ollamaChecking={ollamaChecking}
          onCheckOllama={checkOllama}
          onChange={s => setProviderSettings(prev => ({ ...prev, [currentProvider]: s }))}
        />

        {/* Security note */}
        <div className="mt-4 text-[0.7rem] px-3 py-2 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
          <strong style={{ color: 'var(--text-muted)' }}>Sécurité :</strong>{' '}
          Les clés OpenAI et Mistral sont stockées uniquement dans votre navigateur (localStorage) et ne transitent jamais par le serveur.
          La clé Anthropic transite via le proxy backend sécurisé.
          Les requêtes Ollama passent toutes par le proxy serveur.
        </div>

        {/* Save button */}
        <div className="flex items-center gap-3 mt-5">
          <button onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 rounded text-sm font-semibold cursor-pointer transition-all"
            style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}>
            <Save size={14} />
            Sauvegarder
          </button>
          {saved && (
            <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>
              ✓ Paramètres sauvegardés
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

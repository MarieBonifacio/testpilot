import { RefreshCw } from 'lucide-react';
import type { ProviderKey, ProviderConfig, ProviderSettings, OllamaStatus } from '../types';

export const PROVIDERS: Record<ProviderKey, ProviderConfig> = {
  anthropic: {
    label: 'Anthropic Claude',
    needsKey: true,
    endpoint: '/api/messages',   // proxy backend — la clé ne transite pas côté navigateur
    keyPlaceholder: 'sk-ant-api03-...',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
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
    // Requests always go through the backend proxy — never direct from browser
    endpoint: '/api/ollama/chat',
    models: ['llama3.2', 'mistral', 'qwen2.5-coder', 'phi4', 'deepseek-r1'],
  },
};

export function ProviderFields({ provider, settings, ollamaModels, ollamaStatus, ollamaChecking, onCheckOllama, onChange }: {
  provider: ProviderKey;
  settings: ProviderSettings;
  ollamaModels: string[];
  ollamaStatus: OllamaStatus;
  ollamaChecking: boolean;
  onCheckOllama: () => void;
  onChange: (s: ProviderSettings) => void;
}) {
  const cfg = PROVIDERS[provider];
  const isOllama = provider === 'ollama';
  const modelList = isOllama && ollamaModels.length > 0 ? ollamaModels : cfg.models;
  return (
    <div className="space-y-3">
      {cfg.needsKey && (
        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Clé API</div>
          <input type="password" placeholder={cfg.keyPlaceholder} value={settings.key}
            onChange={e => onChange({ ...settings, key: e.target.value })} />
          {provider === 'anthropic' && (
            <p className="text-[0.7rem] mt-1" style={{ color: 'var(--text-dim)' }}>
              La clé transite via le proxy backend — elle n'est pas exposée dans le réseau navigateur.
            </p>
          )}
        </div>
      )}
      {/* Ollama: host + status */}
      {isOllama && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Hôte Ollama</div>
            <div className="flex items-center gap-2">
              <span className="text-[0.65rem] font-semibold px-1.5 py-0.5 rounded" style={{
                background: ollamaStatus === 'ok' ? 'var(--success-bg)' : ollamaStatus === 'error' ? 'var(--danger-bg)' : 'var(--bg-hover)',
                color: ollamaStatus === 'ok' ? 'var(--success)' : ollamaStatus === 'error' ? 'var(--danger)' : 'var(--text-dim)',
              }}>
                {ollamaStatus === 'ok' ? '● en ligne' : ollamaStatus === 'error' ? '● hors ligne' : '● vérification…'}
              </span>
              <button className="flex items-center gap-1 px-2 py-0.5 rounded text-[0.65rem] font-semibold cursor-pointer"
                style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}
                onClick={onCheckOllama} disabled={ollamaChecking}>
                <RefreshCw size={10} />
                Tester
              </button>
            </div>
          </div>
          <input type="text" value={settings.host ?? 'http://localhost:11434'}
            onChange={e => onChange({ ...settings, host: e.target.value })}
            placeholder="http://localhost:11434" />
          {ollamaStatus === 'error' && (
            <p className="text-[0.7rem] mt-1" style={{ color: 'var(--danger)' }}>
              Ollama inaccessible — vérifiez qu'il est démarré (<code>ollama serve</code>).
            </p>
          )}
        </div>
      )}
      <div className={`grid gap-3 ${!isOllama && cfg.endpointEditable ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <div>
          <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Modèle</div>
          <select value={settings.model} onChange={e => onChange({ ...settings, model: e.target.value })}>
            {modelList.map(m => <option key={m} value={m}>{m}</option>)}
            <option value="__custom__">Autre (saisir)…</option>
          </select>
          {settings.model === '__custom__' && (
            <input type="text" className="mt-2" placeholder="ex : llama3.2:latest"
              value={settings.modelCustom || ''} onChange={e => onChange({ ...settings, modelCustom: e.target.value })} />
          )}
          {isOllama && ollamaModels.length > 0 && (
            <p className="text-[0.68rem] mt-1" style={{ color: 'var(--text-dim)' }}>
              {ollamaModels.length} modèle(s) installé(s) détecté(s)
            </p>
          )}
        </div>
        {!isOllama && cfg.endpointEditable && (
          <div>
            <div className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Endpoint URL</div>
            <input type="text" value={settings.endpoint} onChange={e => onChange({ ...settings, endpoint: e.target.value })} />
          </div>
        )}
      </div>
      {isOllama && (
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Ollama doit tourner localement — <a href="https://ollama.ai" target="_blank" rel="noopener" style={{ color: 'var(--accent)' }}>ollama.ai</a>{' '}
          puis <code>ollama serve</code>. Les requêtes transitent par le proxy serveur.
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { llmApi } from '../lib/api';
import type { OllamaStatus } from '../types';

/**
 * Displays a status strip when Ollama is the active provider and is unreachable.
 * Returns null when:
 *  - the active provider is not 'ollama'
 *  - Ollama is online (no noise for the happy path)
 */
export function OllamaStatusBadge() {
  const [status, setStatus] = useState<OllamaStatus>('unknown');

  useEffect(() => {
    let cancelled = false;
    try {
      const stored = localStorage.getItem('testpilot_provider');
      if (!stored) return;
      const all = JSON.parse(stored) as Record<string, unknown>;
      if ((all._current as string) !== 'ollama') return;

      const ollama = all.ollama as Record<string, unknown> | undefined;
      const host = (ollama?.host as string | undefined) || 'http://localhost:11434';

      llmApi.checkOllamaHealth(host).then(res => {
        if (!cancelled) setStatus(res.ok ? 'ok' : 'error');
      }).catch(() => {
        if (!cancelled) setStatus('error');
      });
    } catch {
      setStatus('error');
    }
    return () => { cancelled = true; };
  }, []);

  // Active provider is not Ollama — render nothing
  try {
    const stored = localStorage.getItem('testpilot_provider');
    if (stored) {
      const all = JSON.parse(stored) as Record<string, unknown>;
      if ((all._current as string) !== 'ollama') return null;
    } else {
      return null;
    }
  } catch { return null; }

  if (status === 'ok') return null;

  if (status === 'unknown') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded text-xs font-medium"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-dim)' }}>
        <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--text-dim)' }} />
        Vérification de la connexion Ollama…
      </div>
    );
  }

  // status === 'error'
  return (
    <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded text-xs font-medium"
      style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}>
      <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--danger)' }} />
      <span>
        Ollama hors ligne — lancez <code className="font-mono">ollama serve</code> ou{' '}
        <Link to="/settings/llm" style={{ color: 'var(--danger)', textDecoration: 'underline', fontWeight: 700 }}>
          changez de provider →
        </Link>
      </span>
    </div>
  );
}

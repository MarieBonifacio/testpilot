import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { clickupApi, campaignsApi } from '../lib/api';
import type { ClickUpConfig, ClickUpList, Campaign } from '../types';
import { ExternalLink, Settings, Send, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

export function ClickUp() {
  const { projectId } = useProject();
  const [config, setConfig] = useState<ClickUpConfig>({});
  const [lists, setLists] = useState<ClickUpList[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<number | ''>('');
  const [loadingLists, setLoadingLists] = useState(false);
  const [loadingSave, setLoadingSave] = useState(false);
  const [loadingBatch, setLoadingBatch] = useState(false);
  const [saved, setSaved] = useState(false);
  const [batchResult, setBatchResult] = useState<{ created: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    loadConfig();
    loadCampaigns();
  }, [projectId]);

  const loadConfig = async () => {
    if (!projectId) return;
    try {
      const data = await clickupApi.getConfig(projectId);
      setConfig(data || {});
    } catch { /* pas de config */ }
  };

  const loadCampaigns = async () => {
    if (!projectId) return;
    try {
      const data = await campaignsApi.list(projectId);
      setCampaigns(data.filter(c => (c.fail_count ?? 0) + (c.blocked_count ?? 0) > 0));
    } catch { /* ignore */ }
  };

  const fetchLists = async () => {
    if (!config.token) { setError('Token ClickUp manquant.'); return; }
    setLoadingLists(true);
    setError(null);
    try {
      const data = await clickupApi.getLists(config.token);
      setLists(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingLists(false);
    }
  };

  const saveConfig = async () => {
    if (!projectId) return;
    setLoadingSave(true);
    setError(null);
    try {
      await clickupApi.saveConfig(projectId, config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingSave(false);
    }
  };

  const createBatch = async () => {
    if (!projectId || !selectedCampaign || !config.list_id || !config.token) {
      setError('Configurez le token et la liste cible, puis sélectionnez une campagne.');
      return;
    }
    setLoadingBatch(true);
    setError(null);
    setBatchResult(null);
    try {
      const res = await clickupApi.createBatch({
        projectId,
        campaignId: Number(selectedCampaign),
        listId:  config.list_id,
        token:   config.token,
        tagPrefix:       config.tag_prefix,
        defaultPriority: config.default_priority,
      });
      setBatchResult({ created: res.created });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingBatch(false);
    }
  };

  if (!projectId) {
    return (
      <div className="empty-state">
        <ExternalLink size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour configurer ClickUp.</p>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Intégration ClickUp</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Créez des tickets FAIL / BLOQUÉ automatiquement dans ClickUp
        </p>
      </header>

      {/* Configuration */}
      <div className="panel mb-5">
        <div className="flex items-center gap-2 mb-4" style={{ color: 'var(--text-dim)' }}>
          <Settings size={14} />
          <span className="text-xs font-bold uppercase tracking-wide">Configuration</span>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Token ClickUp personnel</label>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="pk_xxxxxxxxxxxxx"
                value={config.token || ''}
                onChange={(e) => setConfig({ ...config, token: e.target.value })}
                className="flex-1"
              />
              <button className="btn btn-secondary flex-shrink-0" onClick={fetchLists} disabled={loadingLists || !config.token}>
                {loadingLists ? <div className="spinner" /> : <RefreshCw size={13} />}
                Charger les listes
              </button>
            </div>
            <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
              Trouvez votre token dans ClickUp → Mon profil → Applications → Token API
            </p>
          </div>

          {lists.length > 0 && (
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Liste cible</label>
              <select value={config.list_id || ''} onChange={(e) => setConfig({ ...config, list_id: e.target.value })}>
                <option value="">— Sélectionner une liste —</option>
                {lists.map(l => (
                  <option key={l.id} value={l.id}>
                    {[l.space?.name, l.folder?.name, l.name].filter(Boolean).join(' › ')}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Préfixe des tags</label>
              <input type="text" placeholder="testpilot" value={config.tag_prefix || ''}
                onChange={(e) => setConfig({ ...config, tag_prefix: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Priorité par défaut</label>
              <select value={config.default_priority ?? 3} onChange={(e) => setConfig({ ...config, default_priority: Number(e.target.value) })}>
                <option value={1}>Urgente</option>
                <option value={2}>Haute</option>
                <option value={3}>Normale</option>
                <option value={4}>Basse</option>
              </select>
            </div>
          </div>

          <div className="flex gap-2">
            <button className="btn btn-primary" onClick={saveConfig} disabled={loadingSave}>
              {saved ? <CheckCircle size={14} /> : <Settings size={14} />}
              {saved ? 'Enregistré !' : 'Enregistrer la configuration'}
            </button>
          </div>
        </div>
      </div>

      {/* Création en lot */}
      <div className="panel">
        <div className="flex items-center gap-2 mb-4" style={{ color: 'var(--text-dim)' }}>
          <Send size={14} />
          <span className="text-xs font-bold uppercase tracking-wide">Création de tickets en lot</span>
        </div>
        <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
          Crée un ticket ClickUp pour chaque scénario FAIL ou BLOQUÉ d'une campagne archivée.
        </p>

        {campaigns.length === 0 ? (
          <div className="rounded p-3" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning)' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--warning)' }}>
              <AlertTriangle size={14} />
              <span className="text-sm">Aucune campagne avec des échecs — archivez d'abord une campagne depuis la page Campagne.</span>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold mb-1 block" style={{ color: 'var(--text-muted)' }}>Campagne source</label>
              <select value={selectedCampaign} onChange={(e) => setSelectedCampaign(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— Sélectionner une campagne —</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.campaign_name} — {c.fail_count ?? 0} FAIL, {c.blocked_count ?? 0} BLOQUÉ
                    ({new Date(c.archived_at).toLocaleDateString('fr-FR')})
                  </option>
                ))}
              </select>
            </div>

            <button className="btn btn-primary" onClick={createBatch}
              disabled={loadingBatch || !selectedCampaign || !config.list_id || !config.token}>
              {loadingBatch ? <div className="spinner" /> : <Send size={14} />}
              {loadingBatch ? 'Création en cours…' : 'Créer les tickets ClickUp'}
            </button>
          </div>
        )}

        {batchResult && (
          <div className="mt-4 rounded p-3" style={{ background: 'var(--success-bg)', border: '1px solid var(--success)' }}>
            <div className="flex items-center gap-2" style={{ color: 'var(--success)' }}>
              <CheckCircle size={15} />
              <span className="font-semibold">{batchResult.created} ticket(s) créé(s) dans ClickUp.</span>
            </div>
          </div>
        )}
      </div>

      {error && <div className="error-msg mt-4">{error}</div>}
    </div>
  );
}

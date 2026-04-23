import { useState, useEffect } from 'react';
import { FileText, Save, Palette, Building, AlertTriangle, Trash2 } from 'lucide-react';
import { useProject } from '../lib/hooks';
import { exportApi, projectsApi } from '../lib/api';

const FILIALES = [
  { id: 'cmt-groupe', name: 'CMT Groupe', color: '#003DA5' },
  { id: 'cmt-services', name: 'CMT Services', color: '#FF6B00' },
  { id: 'cmt-genie-electrique', name: 'CMT Génie Électrique', color: '#FFD700' },
  { id: 'cmt-genie-climatique', name: 'CMT Génie Climatique', color: '#00B894' },
  { id: 'cmt-batiment', name: 'CMT Bâtiment', color: '#6C5CE7' },
];

export function ProjectSettings() {
  const { projectId, project } = useProject();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Danger Zone
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [confirmChecked, setConfirmChecked] = useState(false);

  // Form state
  const [filiale, setFiliale] = useState('cmt-groupe');
  const [companyName, setCompanyName] = useState('');
  const [companyAddress, setCompanyAddress] = useState('');
  const [companyPostalCode, setCompanyPostalCode] = useState('');
  const [companyCity, setCompanyCity] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    exportApi.getDocConfig(projectId)
      .then(data => {
        setFiliale(data.filiale || 'cmt-groupe');
        setCompanyName(data.company_name || '');
        setCompanyAddress(data.company_address || '');
        setCompanyPostalCode(data.company_postal_code || '');
        setCompanyCity(data.company_city || '');
        setCompanyEmail(data.company_email || '');
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId]);

  const saveConfig = async () => {
    if (!projectId) return;
    setSaving(true);
    setError(null);
    try {
      await exportApi.saveDocConfig(projectId, {
        filiale,
        company_name: companyName || null,
        company_address: companyAddress || null,
        company_postal_code: companyPostalCode || null,
        company_city: companyCity || null,
        company_email: companyEmail || null,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const downloadCahierRecette = async () => {
    if (!projectId) return;
    try {
      const blob = await exportApi.downloadCahierRecette(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cahier-recette-${Date.now()}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const downloadPlanTest = async () => {
    if (!projectId) return;
    try {
      const blob = await exportApi.downloadPlanTest(projectId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plan-test-${Date.now()}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const handleDeleteProject = async () => {
    if (!projectId) return;
    setDeleteLoading(true);
    setDeleteError('');
    try {
      await projectsApi.delete(projectId);
      localStorage.removeItem('testpilot_current_project');
      window.location.replace('/dashboard');
    } catch (e) {
      setDeleteError((e as Error).message);
      setDeleteLoading(false);
    }
  };

  if (!projectId) {
    return (
      <div className="empty-state">
        <FileText size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour gérer ses paramètres.</p>
      </div>
    );
  }

  const currentFiliale = FILIALES.find(f => f.id === filiale);

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Paramètres du projet</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Configuration documentaire et exports</p>
        </div>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {loading ? (
        <div className="loader"><div className="spinner" /><span>Chargement…</span></div>
      ) : (
        <>
          {/* Exports rapides */}
          <div className="panel mb-6">
            <div className="text-sm font-bold mb-3 flex items-center gap-2" style={{ color: 'var(--accent)' }}>
              <FileText size={14} /> Exports documentaires
            </div>
            <div className="flex gap-3 flex-wrap">
              <button className="btn btn-primary" onClick={downloadCahierRecette}>
                <FileText size={14} /> Cahier de recette
              </button>
              <button className="btn btn-secondary" onClick={downloadPlanTest}>
                <FileText size={14} /> Plan de test
              </button>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-dim)' }}>
              Les documents seront générés aux couleurs de la filiale sélectionnée ci-dessous.
            </p>
          </div>

          {/* Configuration documentaire */}
          <div className="panel mb-6">
            <div className="text-sm font-bold mb-4 flex items-center gap-2" style={{ color: 'var(--accent)' }}>
              <Palette size={14} /> Configuration documentaire
            </div>

            {/* Sélecteur filiale avec aperçu couleurs */}
            <div className="mb-5">
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--text-dim)' }}>
                Filiale / Marque
              </label>
              <div className="flex gap-2 flex-wrap">
                {FILIALES.map(f => (
                  <button
                    key={f.id}
                    onClick={() => setFiliale(f.id)}
                    className="px-3 py-2 rounded text-sm font-medium transition-all"
                    style={{
                      background: filiale === f.id ? f.color : 'var(--bg)',
                      color: '#fff',
                      border: `2px solid ${filiale === f.id ? f.color : 'var(--border)'}`,
                    }}
                  >
                    {f.name}
                  </button>
                ))}
              </div>
              {currentFiliale && (
                <div className="mt-2 text-xs flex items-center gap-2" style={{ color: 'var(--text-dim)' }}>
                  <span style={{ width: 16, height: 16, background: currentFiliale.color, borderRadius: 3, display: 'inline-block' }} />
                  Couleur principale : {currentFiliale.color}
                </div>
              )}
            </div>

            {/* Identité société */}
            <div className="text-xs font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-dim)' }}>
              <Building size={12} /> Identité société (optionnel)
            </div>

            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-dim)' }}>Nom de la société</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="CMT Groupe"
                  value={companyName}
                  onChange={e => setCompanyName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-dim)' }}>Email</label>
                <input
                  type="email"
                  className="input w-full"
                  placeholder="contact@cmt.fr"
                  value={companyEmail}
                  onChange={e => setCompanyEmail(e.target.value)}
                />
              </div>
              <div className="col-span-full">
                <label className="block text-xs mb-1" style={{ color: 'var(--text-dim)' }}>Adresse</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="123 rue de la Paix"
                  value={companyAddress}
                  onChange={e => setCompanyAddress(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-dim)' }}>Code postal</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="75001"
                  value={companyPostalCode}
                  onChange={e => setCompanyPostalCode(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs mb-1" style={{ color: 'var(--text-dim)' }}>Ville</label>
                <input
                  type="text"
                  className="input w-full"
                  placeholder="Paris"
                  value={companyCity}
                  onChange={e => setCompanyCity(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button className="btn btn-primary" onClick={saveConfig} disabled={saving}>
                {saving ? <div className="spinner" /> : <Save size={14} />}
                {saving ? 'Enregistrement…' : 'Enregistrer la configuration'}
              </button>
              {saved && (
                <span className="text-xs font-semibold" style={{ color: 'var(--success)' }}>
                  ✓ Configuration enregistrée
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Danger Zone ─────────────────────────────────── */}
      <div
        className="p-4 mb-4"
        style={{
          background: 'var(--danger-bg)',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius)',
          marginTop: '2rem',
        }}
      >
        <div className="flex items-center gap-2 mb-2 font-bold text-sm" style={{ color: 'var(--danger)' }}>
          <AlertTriangle size={15} /> Zone Dangereuse
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          La suppression d'un projet est <strong style={{ color: 'var(--danger)' }}>irréversible</strong>.
          Tous les scénarios, campagnes et résultats de tests associés seront supprimés définitivement.
        </p>
        <button
          className="btn btn-danger"
          onClick={() => { setShowDeleteConfirm(true); setConfirmChecked(false); setDeleteError(''); }}
        >
          <Trash2 size={14} /> Supprimer le projet
        </button>
      </div>

      {/* ── Modal confirmation suppression ──────────────── */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowDeleteConfirm(false); }}
        >
          <div
            className="w-full max-w-md p-6"
            style={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
            }}
          >
            <div className="flex items-center gap-2 mb-3 font-bold" style={{ color: 'var(--danger)' }}>
              <AlertTriangle size={18} />
              Supprimer le projet « {project?.name ?? projectId} » ?
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
              Cette action est <strong style={{ color: 'var(--danger)' }}>définitive et irréversible</strong>.
              Tous les scénarios, campagnes, sessions de test et données associées à ce projet
              seront supprimés de la base de données.
            </p>

            <label className="flex items-start gap-2 mb-4 cursor-pointer text-sm" style={{ color: 'var(--text)' }}>
              <input
                type="checkbox"
                checked={confirmChecked}
                onChange={e => setConfirmChecked(e.target.checked)}
                style={{ marginTop: 2, accentColor: 'var(--danger)', width: 'auto' }}
              />
              Je comprends que cette action est irréversible et que toutes les données seront perdues.
            </label>

            {deleteError && (
              <div className="error-msg mb-3 text-xs">{deleteError}</div>
            )}

            <div className="flex gap-3 justify-end">
              <button
                className="btn btn-secondary"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteLoading}
              >
                Annuler
              </button>
              <button
                className="btn btn-danger"
                onClick={handleDeleteProject}
                disabled={!confirmChecked || deleteLoading}
                style={{ opacity: (!confirmChecked || deleteLoading) ? 0.45 : 1 }}
              >
                {deleteLoading ? <div className="spinner" /> : <Trash2 size={14} />}
                {deleteLoading ? 'Suppression…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from 'react';
import { FileText, Save, Palette, Building } from 'lucide-react';
import { useProject } from '../lib/hooks';
import { exportApi } from '../lib/api';

const FILIALES = [
  { id: 'cmt-groupe', name: 'CMT Groupe', color: '#003DA5' },
  { id: 'cmt-services', name: 'CMT Services', color: '#FF6B00' },
  { id: 'cmt-genie-electrique', name: 'CMT Génie Électrique', color: '#FFD700' },
  { id: 'cmt-genie-climatique', name: 'CMT Génie Climatique', color: '#00B894' },
  { id: 'cmt-batiment', name: 'CMT Bâtiment', color: '#6C5CE7' },
];

export function ProjectSettings() {
  const { projectId } = useProject();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const blob = await fetch(`/api/projects/${projectId}/export/cahier-recette`, {
        headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('testpilot_auth') || '{}').token}` }
      }).then(r => r.blob());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cahier-recette-${Date.now()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const downloadPlanTest = async () => {
    if (!projectId) return;
    try {
      const blob = await fetch(`/api/projects/${projectId}/export/plan-test`, {
        headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('testpilot_auth') || '{}').token}` }
      }).then(r => r.blob());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plan-test-${Date.now()}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
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
    </div>
  );
}

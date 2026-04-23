import { useState, useRef, useCallback } from 'react';
import { useProject } from '../lib/hooks';
import { importApi, llmApi } from '../lib/api';
import type { ImportPreviewRow } from '../types';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, Trash2, Play } from 'lucide-react';
import { OllamaStatusBadge } from '../components/OllamaStatusBadge';

export function Import() {
  const { projectId } = useProject();
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewRow[]>([]);
  const [markTNR, setMarkTNR] = useState(false);
  const [autoAccept, setAutoAccept] = useState(false);
  const [useAI, setUseAI] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  }, []);

  const loadFile = (f: File) => {
    if (!f.name.match(/\.(xlsx|xls)$/i)) {
      setError('Seuls les fichiers .xlsx et .xls sont acceptés.');
      return;
    }
    setFile(f);
    setError(null);
    setResult(null);
    setPreview([]);
  };

  const doImport = async () => {
    if (!projectId || !file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await importApi.uploadExcel(projectId, buf, { markTNR, autoAccept, useAI });
      setResult({ imported: res.imported });
      setPreview(res.scenarios as ImportPreviewRow[]);
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (!projectId) {
    return (
      <div className="empty-state">
        <FileSpreadsheet size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour importer des scénarios.</p>
      </div>
    );
  }

  return (
    <div>
      <OllamaStatusBadge />
      <header className="mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Import Excel</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Importez des scénarios depuis un fichier .xlsx — colonnes GWT détectées automatiquement
        </p>
      </header>

      {/* Zone de dépôt */}
      {!result && (
        <div
          className="rounded-xl mb-5 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all"
          style={{
            minHeight: 180,
            border: `2px dashed ${dragging ? 'var(--accent)' : 'var(--border)'}`,
            background: dragging ? 'var(--accent-bg)' : 'var(--bg-elevated)',
            color: dragging ? 'var(--accent)' : 'var(--text-muted)',
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={36} style={{ opacity: 0.5 }} />
          {file
            ? <span className="font-semibold text-sm" style={{ color: 'var(--accent)' }}>{file.name}</span>
            : <>
                <span className="font-semibold text-sm">Glisser-déposer un fichier Excel ici</span>
                <span className="text-xs">ou cliquer pour parcourir</span>
              </>
          }
          <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
        </div>
      )}

      {/* Options */}
      {!result && (
        <div className="panel mb-4">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Options</div>
          <div className="space-y-3">
            {[
              { checked: markTNR,     onChange: setMarkTNR,     label: 'Marquer tous les scénarios importés comme TNR' },
              { checked: autoAccept,  onChange: setAutoAccept,  label: 'Accepter automatiquement les scénarios importés' },
              { checked: useAI,       onChange: setUseAI,       label: `Normalisation IA (compléter les GWT incomplets via ${llmApi.getActiveProviderLabel()})` },
            ].map(({ checked, onChange, label }) => (
              <label key={label} className="flex items-center gap-2.5 text-sm cursor-pointer">
                <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
                  className="w-4 h-4" style={{ accentColor: 'var(--accent)' }} />
                <span>{label}</span>
              </label>
            ))}
            {useAI && (
              <div className="mt-2 rounded p-3" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)' }}>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Provider actif : <strong style={{ color: 'var(--accent)' }}>{llmApi.getActiveProviderLabel()}</strong>.
                  Configurez le provider et sa clé dans la page <strong>Rédaction</strong>.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Actions */}
      {!result && (
        <div className="flex gap-3 mb-6">
          <button className="btn btn-primary" onClick={doImport}
            disabled={!file || loading}>
            <Play size={14} />
            {loading ? 'Import en cours…' : 'Lancer l\'import'}
          </button>
          {file && (
            <button className="btn btn-secondary" onClick={() => { setFile(null); setPreview([]); setError(null); }}>
              <Trash2 size={14} />
              Annuler
            </button>
          )}
        </div>
      )}

      {loading && (
        <div className="loader mb-4">
          <div className="spinner" />
          <span>Analyse et import en cours…</span>
        </div>
      )}

      {error && <div className="error-msg">{error}</div>}

      {/* Résultat */}
      {result && (
        <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--success-bg)', border: '1px solid var(--success)' }}>
          <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--success)' }}>
            <CheckCircle size={18} />
            {result.imported} scénario(s) importé(s) avec succès
          </div>
          <button className="btn btn-secondary mt-3" onClick={() => { setResult(null); setPreview([]); }}>
            Importer un autre fichier
          </button>
        </div>
      )}

      {/* Preview */}
      {preview.length > 0 && (
        <div>
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>
            Aperçu — {preview.length} scénarios importés
          </div>
          <div className="space-y-3">
            {preview.map((row, i) => (
              <div key={i} className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="flex items-start justify-between mb-2 gap-3">
                  <div>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-dim)' }}>Ligne {i + 1}</span>
                    <div className="font-semibold text-sm mt-0.5">{row.title || '—'}</div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {row.is_tnr && <span className="badge-tnr">TNR</span>}
                    {row.accepted && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-semibold"
                        style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>Accepté</span>
                    )}
                  </div>
                </div>
                {[
                  { label: 'Given', text: row.given_text },
                  { label: 'When',  text: row.when_text },
                  { label: 'Then',  text: row.then_text },
                ].map(({ label, text }) => text && (
                  <div key={label} className="text-sm mb-1">
                    <span className="font-bold text-xs uppercase mr-1" style={{ color: 'var(--text-dim)' }}>{label}</span>
                    {text}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format attendu */}
      {!result && !file && (
        <div className="panel mt-6">
          <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--warning)' }}>
            <AlertTriangle size={14} />
            <span className="text-xs font-bold uppercase tracking-wide">Format Excel attendu</span>
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
            Les colonnes sont détectées automatiquement par correspondance de mots-clés (insensible à la casse).
          </p>
          <div className="grid grid-cols-2 gap-1 text-xs" style={{ color: 'var(--text-dim)' }}>
            {[
              ['Titre / Title / Scénario', 'titre du scénario'],
              ['Given / Étant donné', 'précondition'],
              ['When / Quand / Action', 'action déclenchante'],
              ['Then / Alors / Résultat', 'résultat attendu'],
              ['Type / Scenario_type', 'functional, negative, edge-case…'],
              ['Priority / Priorité', 'high, medium, low'],
              ['Feature / Fonctionnalité', 'nom de la feature'],
              ['TNR / Régression', 'oui/non ou 1/0'],
            ].map(([col, desc]) => (
              <div key={col}>
                <code className="text-xs px-1 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--accent)' }}>{col}</code>
                <span className="ml-1">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

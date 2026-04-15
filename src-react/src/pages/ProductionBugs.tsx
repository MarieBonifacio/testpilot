import { useState, useEffect, useCallback } from 'react';
import { useProject, useAuth } from '../lib/hooks';
import { productionBugsApi, scenariosApi } from '../lib/api';
import type { ProductionBug, LeakRateKPI } from '../types';
import {
  Bug, Plus, Pencil, Trash2, Link2, Link2Off,
  ChevronLeft, ChevronRight, AlertTriangle,
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────
const SEVERITY_LABEL: Record<string, string> = {
  critical: 'Critique', major: 'Majeur', minor: 'Mineur', trivial: 'Trivial',
};
const SEVERITY_STYLE: Record<string, React.CSSProperties> = {
  critical: { background: 'var(--danger-bg)',  color: 'var(--danger)'  },
  major:    { background: 'var(--warning-bg)', color: 'var(--warning)' },
  minor:    { background: 'var(--info-bg)',    color: 'var(--info)'    },
  trivial:  { background: 'var(--bg-hover)',   color: 'var(--text-muted)' },
};

function leakColor(pct: number) {
  if (pct <= 10)  return 'var(--success)';
  if (pct <= 25)  return 'var(--warning)';
  return 'var(--danger)';
}

// ── Sparkline SVG ────────────────────────────────────
function Sparkline({ data, color }: { data: (number | null)[]; color: string }) {
  const values = data.filter((v): v is number => v !== null);
  if (values.length < 2) return <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem' }}>—</span>;
  const max = Math.max(...values, 1);
  const W = 80, H = 28, pts = data.length;
  const points = data
    .map((v, i) => v !== null ? `${(i / (pts - 1)) * W},${H - (v / max) * H}` : null)
    .filter(Boolean)
    .join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  );
}

// ── Circular gauge ───────────────────────────────────
function CircleGauge({ pct, size = 64 }: { pct: number; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * (pct / 100);
  const color = leakColor(pct);
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bg-hover)" strokeWidth={6} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={6}
        strokeDasharray={`${dash} ${circ}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.5s' }}
      />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle"
        style={{ fontSize: '0.75rem', fontWeight: 700, fill: color }}>
        {pct}%
      </text>
    </svg>
  );
}

// ── Modal création / édition ─────────────────────────
interface BugFormData {
  title: string;
  description: string;
  severity: ProductionBug['severity'];
  scenario_id: number | null;
  detected_date: string;
  feature: string;
  external_id: string;
  root_cause: string;
}

const EMPTY_FORM: BugFormData = {
  title: '', description: '', severity: 'major', scenario_id: null,
  detected_date: new Date().toISOString().slice(0, 10),
  feature: '', external_id: '', root_cause: '',
};

interface BugModalProps {
  bug: ProductionBug | null;
  projectId: number;
  onSave: () => void;
  onClose: () => void;
}

function BugModal({ bug, projectId, onSave, onClose }: BugModalProps) {
  const [form, setForm] = useState<BugFormData>(() =>
    bug ? {
      title:         bug.title,
      description:   bug.description || '',
      severity:      bug.severity,
      scenario_id:   bug.scenario_id,
      detected_date: bug.detected_date.slice(0, 10),
      feature:       bug.feature || '',
      external_id:   bug.external_id || '',
      root_cause:    bug.root_cause || '',
    } : { ...EMPTY_FORM }
  );
  const [scenarios, setScenarios] = useState<{ id: number; title: string; scenario_id: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [scenarioSearch, setScenarioSearch] = useState('');

  useEffect(() => {
    scenariosApi.list(projectId).then(list =>
      setScenarios(
        list
          .filter(s => s.accepted)
          .map(s => ({ id: s.id!, title: s.title, scenario_id: s.scenario_id }))
      )
    ).catch(() => {});
  }, [projectId]);

  const set = (k: keyof BugFormData, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.title.trim())        return setError('Le titre est requis.');
    if (!form.detected_date)       return setError('La date de détection est requise.');
    setSaving(true); setError('');
    try {
      const payload = {
        title:         form.title.trim(),
        description:   form.description  || null,
        severity:      form.severity,
        scenario_id:   form.scenario_id,
        detected_date: form.detected_date,
        feature:       form.feature       || null,
        external_id:   form.external_id   || null,
        root_cause:    form.root_cause    || null,
      };
      if (bug) {
        await productionBugsApi.update(bug.id, payload);
      } else {
        await productionBugsApi.create(projectId, payload);
      }
      onSave();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const filteredScenarios = scenarioSearch
    ? scenarios.filter(s =>
        s.title.toLowerCase().includes(scenarioSearch.toLowerCase()) ||
        s.scenario_id.toLowerCase().includes(scenarioSearch.toLowerCase())
      )
    : scenarios;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="rounded-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow)' }}
        onClick={e => e.stopPropagation()}>

        <h2 className="text-base font-bold mb-5" style={{ color: 'var(--text)' }}>
          {bug ? 'Modifier le bug' : 'Nouveau bug de production'}
        </h2>

        {error && (
          <div className="mb-4 px-3 py-2 rounded text-sm" style={{ background: 'var(--danger-bg)', color: 'var(--danger)' }}>
            {error}
          </div>
        )}

        <div className="space-y-4">
          {/* Titre */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Titre *</label>
            <input className="input w-full" value={form.title} onChange={e => set('title', e.target.value)} placeholder="Ex: Calcul TVA incorrect sur commande internationale" />
          </div>

          {/* Sévérité + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Sévérité</label>
              <select className="input w-full" value={form.severity} onChange={e => set('severity', e.target.value as ProductionBug['severity'])}>
                {(['critical', 'major', 'minor', 'trivial'] as const).map(s => (
                  <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Date détection *</label>
              <input className="input w-full" type="date" value={form.detected_date} onChange={e => set('detected_date', e.target.value)} />
            </div>
          </div>

          {/* Feature + ID externe */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Feature</label>
              <input className="input w-full" value={form.feature} onChange={e => set('feature', e.target.value)} placeholder="Ex: Commande client" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>ID externe (ClickUp/Jira)</label>
              <input className="input w-full" value={form.external_id} onChange={e => set('external_id', e.target.value)} placeholder="Ex: BUG-1234" />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Description</label>
            <textarea className="input w-full" rows={2} value={form.description} onChange={e => set('description', e.target.value)} placeholder="Comportement observé en production..." />
          </div>

          {/* Cause racine */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>Analyse cause racine</label>
            <textarea className="input w-full" rows={2} value={form.root_cause} onChange={e => set('root_cause', e.target.value)} placeholder="Pourquoi ce bug a-t-il échappé à la recette ?" />
          </div>

          {/* Scénario lié */}
          <div>
            <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
              Scénario lié
              <span className="ml-1 font-normal" style={{ color: 'var(--text-dim)' }}>
                — si un scénario couvrait cette feature, c'est une fuite
              </span>
            </label>
            {form.scenario_id ? (
              <div className="flex items-center gap-2 px-3 py-2 rounded" style={{ background: 'var(--danger-bg)', border: '1px solid var(--danger)' }}>
                <Link2 size={13} style={{ color: 'var(--danger)' }} />
                <span className="text-sm flex-1" style={{ color: 'var(--danger)' }}>
                  {scenarios.find(s => s.id === form.scenario_id)?.scenario_id} — {scenarios.find(s => s.id === form.scenario_id)?.title || `Scénario #${form.scenario_id}`}
                </span>
                <button onClick={() => set('scenario_id', null)} className="btn-icon" title="Délier">
                  <Link2Off size={13} />
                </button>
              </div>
            ) : (
              <div>
                <input
                  className="input w-full mb-2"
                  placeholder="Rechercher un scénario accepté..."
                  value={scenarioSearch}
                  onChange={e => setScenarioSearch(e.target.value)}
                />
                {scenarioSearch && (
                  <div className="rounded border max-h-40 overflow-y-auto" style={{ border: '1px solid var(--border)', background: 'var(--bg)' }}>
                    {filteredScenarios.length === 0
                      ? <div className="px-3 py-2 text-sm" style={{ color: 'var(--text-dim)' }}>Aucun résultat</div>
                      : filteredScenarios.slice(0, 8).map(s => (
                        <button key={s.id}
                          className="w-full text-left px-3 py-2 text-sm transition-colors"
                          style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--bg-hover)', cursor: 'pointer', color: 'var(--text)' }}
                          onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          onClick={() => { set('scenario_id', s.id); setScenarioSearch(''); }}>
                          <span style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: '0.68rem' }}>{s.scenario_id}</span>
                          <span className="ml-2">{s.title}</span>
                        </button>
                      ))
                    }
                  </div>
                )}
                <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                  Laisser vide si aucun scénario ne couvrait cette fonctionnalité.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Enregistrement...' : bug ? 'Enregistrer' : 'Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page principale ──────────────────────────────────
export function ProductionBugs() {
  const { projectId } = useProject();
  const { user } = useAuth();
  const canEdit = user?.role === 'cp' || user?.role === 'admin';

  const [bugs, setBugs]       = useState<ProductionBug[]>([]);
  const [kpi, setKpi]         = useState<LeakRateKPI | null>(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage]       = useState(1);
  const [pages, setPages]     = useState(1);
  const [total, setTotal]     = useState(0);

  // Filtres
  const [filterSeverity, setFilterSeverity] = useState('');
  const [filterCovered, setFilterCovered]   = useState<'' | 'true' | 'false'>('');
  const [filterFeature, setFilterFeature]   = useState('');

  // Modal
  const [modalOpen, setModalOpen]       = useState(false);
  const [editingBug, setEditingBug]     = useState<ProductionBug | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const [listRes, kpiRes] = await Promise.all([
        productionBugsApi.list(projectId, {
          page,
          limit: 20,
          severity:     filterSeverity  || undefined,
          has_scenario: filterCovered   || undefined,
          feature:      filterFeature   || undefined,
        }),
        productionBugsApi.getLeakRate(projectId),
      ]);
      setBugs(listRes.bugs);
      setTotal(listRes.total);
      setPages(listRes.pages);
      setKpi(kpiRes);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [projectId, page, filterSeverity, filterCovered, filterFeature]);

  useEffect(() => { load(); }, [load]);
  // Reset page when filters change
  useEffect(() => { setPage(1); }, [filterSeverity, filterCovered, filterFeature]);

  const handleDelete = async (id: number) => {
    if (!confirm('Supprimer ce bug ?')) return;
    await productionBugsApi.delete(id);
    load();
  };

  const openCreate = () => { setEditingBug(null); setModalOpen(true); };
  const openEdit   = (b: ProductionBug) => { setEditingBug(b); setModalOpen(true); };
  const closeModal = () => setModalOpen(false);
  const onSaved    = () => { setModalOpen(false); load(); };

  if (!projectId) {
    return (
      <div className="empty-state">
        <Bug size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet.</p>
      </div>
    );
  }

  const leakPct = kpi?.leak_rate_percent ?? 0;

  return (
    <div>
      {/* Header */}
      <header className="mb-6 pb-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Bugs de production</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Suivi du taux de fuite — bugs détectés en prod couverts par un scénario de test</p>
        </div>
        {canEdit && (
          <button className="btn btn-primary flex items-center gap-1.5" onClick={openCreate}>
            <Plus size={14} /> Nouveau bug
          </button>
        )}
      </header>

      {/* KPI cards */}
      {kpi && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {/* Jauge circulaire taux de fuite */}
          <div className="rounded-lg p-4 flex items-center gap-4 col-span-1"
            style={{ background: 'var(--bg-elevated)', border: `1px solid ${leakColor(leakPct)}` }}>
            <CircleGauge pct={leakPct} size={64} />
            <div>
              <div className="text-[0.72rem] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>Taux de fuite</div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {kpi.bugs_with_scenario} / {kpi.total_bugs} bugs
              </div>
              <div className="text-xs mt-0.5" style={{ color: leakColor(leakPct), fontWeight: 600 }}>
                {leakPct <= 10 ? 'Excellent' : leakPct <= 25 ? 'Attention' : 'Critique'}
              </div>
            </div>
          </div>

          {/* Totaux */}
          {[
            { label: 'Total bugs', value: kpi.total_bugs, color: 'var(--text)' },
            { label: 'Avec scénario (fuites)', value: kpi.bugs_with_scenario, color: 'var(--danger)' },
            { label: 'Sans scénario', value: kpi.bugs_without_scenario, color: 'var(--text-muted)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="text-[0.72rem] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-dim)' }}>{label}</div>
              <div className="text-2xl font-bold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Sparkline tendance 30j */}
      {kpi && kpi.trend_30d.some(v => v !== null) && (
        <div className="rounded-lg p-4 mb-6 flex items-center gap-4"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="text-[0.72rem] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>Tendance 30j</div>
          <Sparkline data={kpi.trend_30d} color={leakColor(leakPct)} />
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Taux de fuite quotidien</div>
        </div>
      )}

      {/* Filtres */}
      <div className="flex flex-wrap gap-2 mb-4">
        <select className="input text-sm"
          value={filterSeverity} onChange={e => setFilterSeverity(e.target.value)}>
          <option value="">Toutes sévérités</option>
          {(['critical', 'major', 'minor', 'trivial'] as const).map(s => (
            <option key={s} value={s}>{SEVERITY_LABEL[s]}</option>
          ))}
        </select>
        <select className="input text-sm"
          value={filterCovered} onChange={e => setFilterCovered(e.target.value as '' | 'true' | 'false')}>
          <option value="">Tous</option>
          <option value="true">Fuites (avec scénario)</option>
          <option value="false">Non couverts (sans scénario)</option>
        </select>
        <input className="input text-sm" placeholder="Filtrer par feature..."
          value={filterFeature} onChange={e => setFilterFeature(e.target.value)} style={{ minWidth: 160 }} />
        {(filterSeverity || filterCovered || filterFeature) && (
          <button className="btn btn-ghost text-sm" onClick={() => {
            setFilterSeverity(''); setFilterCovered(''); setFilterFeature('');
          }}>Réinitialiser</button>
        )}
        <span className="ml-auto text-sm" style={{ color: 'var(--text-muted)', alignSelf: 'center' }}>
          {total} bug{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Liste */}
      {loading ? (
        <div className="empty-state"><p>Chargement...</p></div>
      ) : bugs.length === 0 ? (
        <div className="empty-state">
          <Bug size={40} className="mx-auto mb-3 opacity-30" />
          <p>Aucun bug de production enregistré.</p>
          {canEdit && (
            <button className="btn btn-primary mt-3" onClick={openCreate}>
              <Plus size={13} className="mr-1" /> Enregistrer le premier bug
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg overflow-hidden mb-4" style={{ border: '1px solid var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                {['Sévérité', 'Titre', 'Feature', 'Date détection', 'Scénario lié', 'ID ext.', ''].map(h => (
                  <th key={h} className="px-3 py-2.5 text-left text-[0.7rem] font-bold uppercase tracking-wide"
                    style={{ color: 'var(--text-dim)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bugs.map((b, i) => (
                <tr key={b.id}
                  style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg-elevated)', borderBottom: '1px solid var(--bg-hover)' }}>
                  <td className="px-3 py-2.5">
                    <span className="text-[0.68rem] px-1.5 py-0.5 rounded font-semibold"
                      style={SEVERITY_STYLE[b.severity] || {}}>
                      {SEVERITY_LABEL[b.severity] || b.severity}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 font-medium max-w-[280px]">
                    <div className="truncate" title={b.title}>{b.title}</div>
                    {b.description && (
                      <div className="text-xs truncate mt-0.5" style={{ color: 'var(--text-dim)' }}>{b.description}</div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    {b.feature || '—'}
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {b.detected_date ? new Date(b.detected_date).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {b.scenario_id ? (
                      <div className="flex items-center gap-1">
                        <AlertTriangle size={11} style={{ color: 'var(--danger)', flexShrink: 0 }} />
                        <span className="text-xs font-semibold truncate max-w-[160px]" style={{ color: 'var(--danger)' }}
                          title={b.scenario_title || undefined}>
                          {b.scenario_ref ? `${b.scenario_ref} — ` : ''}{b.scenario_title || `#${b.scenario_id}`}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-dim)' }}>—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                    {b.external_id || '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button className="btn-icon" title="Modifier" onClick={() => openEdit(b)}>
                          <Pencil size={13} />
                        </button>
                        <button className="btn-icon" title="Supprimer"
                          style={{ color: 'var(--danger)' }} onClick={() => handleDelete(b.id)}>
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-2">
          <button className="btn-icon" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={15} />
          </button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {page} / {pages}</span>
          <button className="btn-icon" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={15} />
          </button>
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <BugModal bug={editingBug} projectId={projectId} onSave={onSaved} onClose={closeModal} />
      )}
    </div>
  );
}

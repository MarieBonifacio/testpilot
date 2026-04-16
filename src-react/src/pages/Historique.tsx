import { useState, useEffect, useRef } from 'react';
import { useProject } from '../lib/hooks';
import { campaignsApi } from '../lib/api';
import type { Campaign } from '../types';
import { History, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight, Calendar, Download } from 'lucide-react';

/** Normalise les noms de colonnes backend → noms front uniformes */
function normalize(c: Campaign): Required<Pick<Campaign,
  'id'|'pass_rate'|'pass_count'|'fail_count'|'blocked_count'|'not_run_count'|'total_scenarios'|'campaign_name'|'archived_at'
>> & Campaign {
  return {
    ...c,
    campaign_name:   c.campaign_name   ?? c.name           ?? 'Campagne',
    pass_rate:       c.pass_rate       ?? c.success_rate    ?? 0,
    pass_count:      c.pass_count      ?? c.pass            ?? 0,
    fail_count:      c.fail_count      ?? c.fail            ?? 0,
    blocked_count:   c.blocked_count   ?? c.blocked         ?? 0,
    not_run_count:   c.not_run_count   ?? c.skipped         ?? 0,
    total_scenarios: c.total_scenarios ?? c.total           ?? 0,
    escape_rate:     c.escape_rate     ?? c.leak_rate       ?? undefined,
    duration_minutes: c.duration_minutes
      ?? (c.duration_sec != null ? Math.round(c.duration_sec / 60) : undefined),
    archived_at:     c.archived_at ?? c.finished_at ?? c.started_at ?? new Date().toISOString(),
  } as ReturnType<typeof normalize>;
}

export function Historique() {
  const { projectId } = useProject();
  const [campaigns, setCampaigns] = useState<ReturnType<typeof normalize>[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<'all' | 'tnr'>('all');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!projectId) return;
    load();
  }, [projectId]);

  useEffect(() => {
    drawChart();
  }, [campaigns, filter]);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const raw = await campaignsApi.list(projectId);
      setCampaigns(raw.map(normalize));
    } catch (err) {
      console.error('Erreur chargement historique:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = filter === 'tnr'
    ? campaigns.filter(c => (c.tnr_count ?? 0) > 0)
    : campaigns;

  const drawChart = () => {
    const canvas = canvasRef.current;
    if (!canvas || filtered.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width = canvas.offsetWidth || 600;
    const H = canvas.height = 140;
    ctx.clearRect(0, 0, W, H);

    const rates = filtered.map(c => Math.round(c.pass_rate ?? 0));
    const padL = 40, padR = 20, padT = 16, padB = 24;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const step = rates.length > 1 ? chartW / (rates.length - 1) : chartW;

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach(y => {
      const yy = padT + chartH - (y / 100) * chartH;
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText(`${y}%`, padL - 6, yy + 3);
    });

    const gradient = ctx.createLinearGradient(0, padT, 0, padT + chartH);
    gradient.addColorStop(0, 'rgba(122,162,247,0.25)');
    gradient.addColorStop(1, 'rgba(122,162,247,0)');
    ctx.beginPath();
    rates.forEach((r, i) => {
      const x = padL + i * step;
      const y = padT + chartH - (r / 100) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.lineTo(padL + (rates.length - 1) * step, padT + chartH);
    ctx.lineTo(padL, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = gradient; ctx.fill();

    ctx.strokeStyle = '#7aa2f7'; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath();
    rates.forEach((r, i) => {
      const x = padL + i * step;
      const y = padT + chartH - (r / 100) * chartH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    rates.forEach((r, i) => {
      const x = padL + i * step;
      const y = padT + chartH - (r / 100) * chartH;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = r >= 80 ? '#9ece6a' : r >= 50 ? '#e0af68' : '#f7768e';
      ctx.fill();
      ctx.strokeStyle = '#0f1419'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  };

  const toggleExpand = (id: number) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const trend = (c: ReturnType<typeof normalize>, prev: ReturnType<typeof normalize> | undefined) => {
    if (!prev) return null;
    const diff = c.pass_rate - prev.pass_rate;
    if (diff > 2)  return <TrendingUp  size={14} style={{ color: 'var(--success)' }} />;
    if (diff < -2) return <TrendingDown size={14} style={{ color: 'var(--danger)' }} />;
    return <Minus size={14} style={{ color: 'var(--text-dim)' }} />;
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  if (!projectId) {
    return (
      <div className="empty-state">
        <History size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour voir l'historique.</p>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
        <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Historique des campagnes</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>KPIs archivés et tendances de qualité</p>
      </header>

      <div className="flex gap-2 mb-5">
        {(['all', 'tnr'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded text-sm font-semibold cursor-pointer transition-all"
            style={filter === f
              ? { border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)' }
              : { border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)' }}>
            {f === 'all' ? 'Toutes' : 'TNR uniquement'}
          </button>
        ))}
      </div>

      {filtered.length >= 2 && (
        <div className="panel mb-5">
          <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Taux de succès — tendance</div>
          <canvas ref={canvasRef} style={{ width: '100%', height: 140, display: 'block' }} />
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Campagnes',     value: filtered.length,  color: 'var(--text)' },
            { label: 'Taux pass moy.', value: Math.round(filtered.reduce((s, c) => s + c.pass_rate, 0) / filtered.length) + '%', color: 'var(--success)' },
            { label: 'Meilleur taux', value: Math.round(Math.max(...filtered.map(c => c.pass_rate))) + '%', color: 'var(--accent)' },
            { label: 'Dernier taux',  value: Math.round(filtered[filtered.length - 1]?.pass_rate ?? 0) + '%', color: 'var(--warning)' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-lg p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="text-[0.72rem] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>{label}</div>
              <div className="text-xl font-bold" style={{ color }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="loader"><div className="spinner" /><span>Chargement…</span></div>}

      {!loading && filtered.length === 0 && (
        <div className="empty-state">
          <Calendar size={40} className="mx-auto mb-3 opacity-20" />
          <p>Aucune campagne archivée pour ce projet.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>Les campagnes sont archivées depuis la page Campagne.</p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((c, idx) => {
          const prev = idx > 0 ? filtered[idx - 1] : undefined;
          const isExpanded = expanded.has(c.id);
          const passRate = Math.round(c.pass_rate);
          const rateColor = passRate >= 80 ? 'var(--success)' : passRate >= 50 ? 'var(--warning)' : 'var(--danger)';
          return (
            <div key={c.id} className="rounded-lg overflow-hidden"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 p-4 cursor-pointer" onClick={() => toggleExpand(c.id)}>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{c.campaign_name}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>{fmtDate(c.archived_at)}</div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {trend(c, prev)}
                  <span className="text-sm font-bold" style={{ color: rateColor }}>{passRate}%</span>
                  <div className="w-20 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                    <div className="h-full rounded-full" style={{ width: `${passRate}%`, background: rateColor }} />
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-dim)' }}>{c.total_scenarios} scén.</span>
                  {isExpanded ? <ChevronDown size={14} style={{ color: 'var(--text-dim)' }} /> : <ChevronRight size={14} style={{ color: 'var(--text-dim)' }} />}
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                  <div className="grid grid-cols-4 gap-3 mb-3">
                    {[
                      { label: 'Pass',      value: c.pass_count,    color: 'var(--success)' },
                      { label: 'Fail',      value: c.fail_count,    color: 'var(--danger)' },
                      { label: 'Bloqué',    value: c.blocked_count, color: 'var(--purple)' },
                      { label: 'Non exéc.', value: c.not_run_count, color: 'var(--text-muted)' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="rounded p-3 text-center" style={{ background: 'var(--bg-hover)' }}>
                        <div className="text-[0.7rem] mb-0.5" style={{ color: 'var(--text-dim)' }}>{label}</div>
                        <div className="text-lg font-bold" style={{ color }}>{value ?? 0}</div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-4 text-xs flex-wrap" style={{ color: 'var(--text-dim)' }}>
                    {c.escape_rate != null && (
                      <span>Taux de fuite : <strong style={{ color: 'var(--warning)' }}>{Math.round(c.escape_rate)}%</strong></span>
                    )}
                    {c.tnr_count != null && c.tnr_count > 0 && (
                      <span>TNR : <strong style={{ color: 'var(--purple)' }}>{c.tnr_pass ?? 0}/{c.tnr_count} pass</strong></span>
                    )}
                    {c.duration_minutes != null && (
                      <span>Durée : <strong>{c.duration_minutes} min</strong></span>
                    )}
                  </div>
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <button
                      className="btn btn-secondary text-xs flex items-center gap-1.5"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const res = await fetch(`/api/campaigns/${c.id}/export-rapport`, {
                            headers: { Authorization: `Bearer ${JSON.parse(localStorage.getItem('testpilot_auth') || '{}').token}` }
                          });
                          if (!res.ok) throw new Error('Export failed');
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `rapport-${c.id}.docx`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch { /* ignore */ }
                      }}
                    >
                      <Download size={12} /> Télécharger le rapport
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


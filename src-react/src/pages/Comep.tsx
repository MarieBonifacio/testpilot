import { useState, useEffect, useRef } from 'react';
import { useProject } from '../lib/hooks';
import { comepApi } from '../lib/api';
import type { ComepReport } from '../types';
import { ShieldCheck, AlertTriangle, Download, RefreshCw } from 'lucide-react';

function GaugeCanvas({ score }: { score: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = 220, H = 120;
    canvas.width = W; canvas.height = H;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2, cy = H - 10, r = 90;
    const startAngle = Math.PI, endAngle = 2 * Math.PI;

    // BG arc
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 16;
    ctx.stroke();

    // Color arc
    const color = score >= 75 ? '#9ece6a' : score >= 50 ? '#e0af68' : score >= 25 ? '#f7768e' : '#bb9af7';
    const angle = startAngle + (score / 100) * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Score text
    ctx.font = 'bold 32px sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(String(score), cx, cy - 20);
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('/100', cx, cy - 2);
  }, [score]);

  return <canvas ref={ref} style={{ display: 'block', margin: '0 auto' }} />;
}

export function Comep() {
  const { projectId, project } = useProject();
  const [report, setReport] = useState<ComepReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    load();
  }, [projectId]);

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await comepApi.getReport(projectId);
      setReport(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const exportHTML = () => {
    if (!report) return;
    const levelColor: Record<string, string> = {
      'ÉLEVÉ':    '#9ece6a',
      'MOYEN':    '#e0af68',
      'FAIBLE':   '#f7768e',
      'CRITIQUE': '#bb9af7',
    };
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport COMEP — ${report.project_name}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
  h1 { color: #4a7cf7; }
  .score { font-size: 3rem; font-weight: 700; color: ${levelColor[report.confidence_level] || '#4a7cf7'}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
  .risk-high { color: #d9534f; font-weight: bold; }
  .risk-medium { color: #f0ad4e; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>Rapport COMEP — ${report.project_name}</h1>
<p>Généré le ${new Date(report.generated_at).toLocaleDateString('fr-FR')}</p>
<div class="score">${report.confidence_score}/100 — ${report.confidence_level}</div>
<div class="grid">
  <div class="card"><strong>Couverture</strong><br>${Math.round(report.components.coverage)}/30</div>
  <div class="card"><strong>Traçabilité</strong><br>${Math.round(report.components.traceability)}/20</div>
  <div class="card"><strong>Taux Pass</strong><br>${Math.round(report.components.pass_rate)}/30</div>
  <div class="card"><strong>Critiques</strong><br>${Math.round(report.components.critical_failures)}/20</div>
</div>
<h2>Risques résiduels</h2>
${report.risks.map(r => `<p class="${r.level === 'HIGH' ? 'risk-high' : 'risk-medium'}">[${r.level}] ${r.description}</p>`).join('')}
<h2>Recommandations</h2>
<ol>${report.recommendations.map(r => `<li>${r.text}</li>`).join('')}</ol>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport-comep-${report.project_name.replace(/\s+/g, '-')}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!projectId) {
    return (
      <div className="empty-state">
        <ShieldCheck size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour générer le rapport COMEP.</p>
      </div>
    );
  }

  const levelColors: Record<string, string> = {
    'ÉLEVÉ':    'var(--success)',
    'MOYEN':    'var(--warning)',
    'FAIBLE':   'var(--danger)',
    'CRITIQUE': 'var(--purple)',
  };

  return (
    <div>
      <header className="mb-6 pb-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--accent)' }}>Rapport COMEP</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Score de confiance et risques résiduels — {project?.name}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={13} />
            Recalculer
          </button>
          {report && (
            <button className="btn btn-secondary" onClick={exportHTML}>
              <Download size={13} />
              Exporter HTML/PDF
            </button>
          )}
        </div>
      </header>

      {loading && <div className="loader"><div className="spinner" /><span>Calcul du rapport…</span></div>}
      {error && <div className="error-msg">{error}</div>}

      {report && (
        <>
          {/* Score global */}
          <div className="panel mb-5 text-center">
            <GaugeCanvas score={report.confidence_score} />
            <div className="mt-2 font-bold text-lg"
              style={{ color: levelColors[report.confidence_level] || 'var(--accent)' }}>
              Niveau de confiance : {report.confidence_level}
            </div>
          </div>

          {/* Composantes */}
          <div className="panel mb-5">
            <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Composantes du score</div>
            <div className="space-y-3">
              {[
                { label: 'Couverture fonctionnelle', value: report.components.coverage,          max: 30 },
                { label: 'Traçabilité exigences',    value: report.components.traceability,      max: 20 },
                { label: 'Taux de réussite',         value: report.components.pass_rate,         max: 30 },
                { label: 'Absence de critiques',     value: report.components.critical_failures, max: 20 },
              ].map(({ label, value, max }) => {
                const pct = Math.round((value / max) * 100);
                return (
                  <div key={label}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>{label}</span>
                      <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                        {Math.round(value)}/{max}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          background: pct >= 70 ? 'var(--success)' : pct >= 40 ? 'var(--warning)' : 'var(--danger)',
                        }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Scénarios total',    value: report.stats.total,                                      color: 'var(--text)' },
              { label: 'Taux d\'acceptation', value: `${Math.round(report.stats.coverage_pct)}%`,            color: 'var(--accent)' },
              { label: 'Taux pass',          value: `${Math.round(report.stats.pass_rate)}%`,               color: 'var(--success)' },
              { label: 'TNR',               value: report.stats.tnr,                                        color: 'var(--purple)' },
              { label: 'Traçabilité',        value: `${Math.round(report.stats.traceability_pct)}%`,        color: 'var(--info)' },
              { label: 'Acceptés',           value: report.stats.accepted,                                  color: 'var(--success)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="text-[0.68rem] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>{label}</div>
                <div className="text-lg font-bold" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Risques */}
          {report.risks.length > 0 && (
            <div className="panel mb-5">
              <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--danger)' }}>
                <AlertTriangle size={14} />
                <span className="text-xs font-bold uppercase tracking-wide">Risques résiduels</span>
              </div>
              <div className="space-y-2">
                {report.risks.map((risk, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-sm p-2.5 rounded"
                    style={{
                      background: risk.level === 'HIGH' ? 'var(--danger-bg)' : 'var(--warning-bg)',
                      border: `1px solid ${risk.level === 'HIGH' ? 'var(--danger)' : 'var(--warning)'}`,
                    }}>
                    <span className="text-xs font-bold flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded"
                      style={{
                        background: risk.level === 'HIGH' ? 'var(--danger)' : 'var(--warning)',
                        color: 'var(--bg)',
                      }}>
                      {risk.level}
                    </span>
                    <span style={{ color: risk.level === 'HIGH' ? 'var(--danger)' : 'var(--warning)' }}>
                      {risk.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommandations */}
          {report.recommendations.length > 0 && (
            <div className="panel">
              <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Recommandations</div>
              <ol className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center"
                      style={{ background: 'var(--accent-bg)', color: 'var(--accent)', marginTop: 1 }}>
                      {i + 1}
                    </span>
                    <span>{rec.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </div>
  );
}

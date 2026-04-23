import { useState, useEffect, useRef } from 'react';
import { useProject } from '../lib/hooks';
import { comepApi, llmApi } from '../lib/api';
import type { ComepReport } from '../types';
import { ShieldCheck, AlertTriangle, Download, RefreshCw, TrendingUp, Brain } from 'lucide-react';
import { OllamaStatusBadge } from '../components/OllamaStatusBadge';

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

    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, endAngle);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 16;
    ctx.stroke();

    const color = score >= 80 ? '#9ece6a' : score >= 60 ? '#e0af68' : score >= 40 ? '#f7768e' : '#bb9af7';
    const angle = startAngle + (score / 100) * Math.PI;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startAngle, angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = 16;
    ctx.lineCap = 'round';
    ctx.stroke();

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
  const [aiComment, setAiComment] = useState<string | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiCommentError, setAiCommentError] = useState<string | null>(null);

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

  const generateComment = async () => {
    if (!report) return;
    setAiGenerating(true);
    setAiCommentError(null);
    setAiComment(null);
    const { score, summary, residualRisks, recommendations, lastCampaign } = report;
    const risksText = residualRisks.slice(0, 5).map(r => `- [${r.level}] ${r.reason}${r.title ? ` (${r.title})` : ''}`).join('\n') || 'Aucun risque résiduel identifié.';
    const recoText = recommendations.slice(0, 3).map(r => `- ${r.text}`).join('\n') || 'Aucune recommandation.';
    const campaignText = lastCampaign
      ? `Dernière campagne : ${lastCampaign.total} tests, ${lastCampaign.pass} PASS, ${lastCampaign.fail} FAIL, ${lastCampaign.blocked} BLOQUÉS.`
      : 'Aucune campagne exécutée.';
    const prompt = `Tu es un expert QA. Rédige un commentaire COMEP de 3-5 phrases pour présenter en comité de mise en production le rapport suivant :\n\n`
      + `Score de confiance : ${score.value}/100 (${score.level})\n`
      + `Couverture : ${summary.coverageRate}% | Traçabilité : ${summary.traceRate}%\n`
      + `${campaignText}\n`
      + `Risques résiduels :\n${risksText}\n`
      + `Recommandations prioritaires :\n${recoText}\n\n`
      + `Le commentaire doit être professionnel, factuel et synthétique. Réponds en français.`;
    try {
      const comment = await llmApi.call(prompt, { maxTokens: 500 });
      setAiComment(comment);
    } catch (e) {
      setAiCommentError((e as Error).message);
    } finally {
      setAiGenerating(false);
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
    const projectName = report.project?.name ?? 'Projet';
    const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Rapport COMEP — ${projectName}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; }
  h1 { color: #4a7cf7; }
  .score { font-size: 3rem; font-weight: 700; color: ${levelColor[report.score.level] || '#4a7cf7'}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 20px 0; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 16px; }
  .risk-high { color: #d9534f; font-weight: bold; }
  .risk-medium { color: #f0ad4e; }
  @media print { body { margin: 20px; } }
</style>
</head>
<body>
<h1>Rapport COMEP — ${projectName}</h1>
<p>Généré le ${new Date(report.generated_at).toLocaleDateString('fr-FR')}</p>
<div class="score">${report.score.value}/100 — ${report.score.level}</div>
<div class="grid">
  <div class="card"><strong>Couverture</strong><br>${report.score.components.coverage}/100 → max 30 pts</div>
  <div class="card"><strong>Traçabilité</strong><br>${report.score.components.traceability}/100 → max 20 pts</div>
  <div class="card"><strong>Taux Pass</strong><br>${report.score.components.pass_rate}/100 → max 30 pts</div>
  <div class="card"><strong>Critiques couverts</strong><br>${report.score.components.critical_coverage}/100 → max 20 pts</div>
</div>
<h2>Risques résiduels</h2>
${report.residualRisks.map(r => `<p class="${r.level === 'HIGH' ? 'risk-high' : 'risk-medium'}">[${r.level}] ${r.reason}${r.title ? ` — ${r.title}` : ''}</p>`).join('')}
<h2>Recommandations</h2>
<ol>${report.recommendations.map(r => `<li>${r.text}</li>`).join('')}</ol>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rapport-comep-${projectName.replace(/\s+/g, '-')}.html`;
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
      <OllamaStatusBadge />
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
            <>
              <button className="btn btn-secondary" onClick={generateComment} disabled={aiGenerating}>
                {aiGenerating ? <div className="spinner" /> : <Brain size={13} />}
                {aiGenerating ? 'Génération…' : 'Commentaire IA'}
              </button>
              <button className="btn btn-secondary" onClick={exportHTML}>
                <Download size={13} />
                Exporter HTML/PDF
              </button>
            </>
          )}
        </div>
      </header>

      {loading && <div className="loader"><div className="spinner" /><span>Calcul du rapport…</span></div>}
      {error && <div className="error-msg">{error}</div>}

      {report && (
        <>
          {/* AI COMEP comment */}
          {aiCommentError && <div className="error-msg mb-4">{aiCommentError}</div>}
          {aiComment && (
            <div className="panel mb-5">
              <div className="flex items-center gap-2 mb-3">
                <Brain size={14} style={{ color: 'var(--accent)' }} />
                <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>Commentaire COMEP généré</span>
                <span className="text-[0.65rem] px-1.5 py-0.5 rounded ml-auto" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>
                  {llmApi.getActiveProviderLabel()}
                </span>
                <button
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => { navigator.clipboard?.writeText(aiComment); }}
                >
                  Copier
                </button>
              </div>
              <p className="text-sm" style={{ color: 'var(--text)', lineHeight: 1.7, margin: 0 }}>{aiComment}</p>
            </div>
          )}

          {/* Score global */}
          <div className="panel mb-5 text-center">
            <GaugeCanvas score={report.score.value} />
            <div className="mt-2 font-bold text-lg"
              style={{ color: levelColors[report.score.level] || 'var(--accent)' }}>
              Niveau de confiance : {report.score.level}
            </div>
          </div>

          {/* Composantes du score */}
          <div className="panel mb-5">
            <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>
              Composantes du score
            </div>
            <div className="space-y-3">
              {[
                { label: 'Couverture fonctionnelle', pct: report.score.components.coverage,          pts: Math.round(report.score.components.coverage * 0.30), max: 30 },
                { label: 'Traçabilité exigences',    pct: report.score.components.traceability,      pts: Math.round(report.score.components.traceability * 0.20), max: 20 },
                { label: 'Taux de réussite',         pct: report.score.components.pass_rate,         pts: Math.round(report.score.components.pass_rate * 0.30), max: 30 },
                { label: 'Couverture critiques',     pct: report.score.components.critical_coverage, pts: Math.round(report.score.components.critical_coverage * 0.20), max: 20 },
              ].map(({ label, pct, pts, max }) => (
                <div key={label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{label}</span>
                    <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                      {pts}/{max} pts
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
              ))}
            </div>
          </div>

          {/* Stats résumé */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Scénarios total',     value: report.summary.totalScenarios,                                              color: 'var(--text)' },
              { label: 'Taux couverture',     value: `${report.summary.coverageRate}%`,                                          color: 'var(--accent)' },
              { label: 'Taux pass (dernière)',value: report.summary.lastPassRate !== null ? `${report.summary.lastPassRate}%` : '—', color: 'var(--success)' },
              { label: 'TNR',                 value: report.summary.tnr,                                                         color: 'var(--purple)' },
              { label: 'Traçabilité',         value: `${report.summary.traceRate}%`,                                             color: 'var(--info)' },
              { label: 'Acceptés',            value: report.summary.accepted,                                                    color: 'var(--success)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="text-[0.68rem] font-bold uppercase tracking-wide mb-1" style={{ color: 'var(--text-dim)' }}>{label}</div>
                <div className="text-lg font-bold" style={{ color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Tendance campagnes */}
          {report.trend.length > 0 && (
            <div className="panel mb-5">
              <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--text-dim)' }}>
                <TrendingUp size={13} />
                <span className="text-xs font-bold uppercase tracking-wide">Tendance (3 dernières campagnes)</span>
              </div>
              <div className="space-y-2">
                {report.trend.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 truncate" style={{ color: 'var(--text-muted)' }}>{t.name}</span>
                    <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-hover)' }}>
                      <div className="h-full rounded-full"
                        style={{
                          width: `${t.pass_rate}%`,
                          background: t.pass_rate >= 80 ? 'var(--success)' : t.pass_rate >= 50 ? 'var(--warning)' : 'var(--danger)',
                        }} />
                    </div>
                    <span className="font-semibold w-10 text-right"
                      style={{ color: t.pass_rate >= 80 ? 'var(--success)' : t.pass_rate >= 50 ? 'var(--warning)' : 'var(--danger)' }}>
                      {t.pass_rate}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Risques résiduels */}
          {report.residualRisks.length > 0 && (
            <div className="panel mb-5">
              <div className="flex items-center gap-2 mb-3" style={{ color: 'var(--danger)' }}>
                <AlertTriangle size={14} />
                <span className="text-xs font-bold uppercase tracking-wide">Risques résiduels ({report.residualRisks.length})</span>
              </div>
              <div className="space-y-2">
                {report.residualRisks.map((risk, i) => (
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
                    <div>
                      <div style={{ color: risk.level === 'HIGH' ? 'var(--danger)' : 'var(--warning)' }}>
                        {risk.reason}
                      </div>
                      {risk.title && (
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-dim)' }}>
                          {risk.id && <code className="mr-1">{risk.id}</code>}{risk.title}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommandations */}
          {report.recommendations.length > 0 && (
            <div className="panel">
              <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>
                Recommandations
              </div>
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

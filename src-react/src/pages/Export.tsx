import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { scenariosApi } from '../lib/api';
import type { Scenario } from '../types';
import { Download, FileJson, Table, Code, FileSpreadsheet } from 'lucide-react';

type ExportFormat = 'json' | 'gherkin' | 'csv' | 'xlsx' | 'testlink';

export function Export() {
  const { projectId, project } = useProject();
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [includeTNR, setIncludeTNR] = useState(true);
  const [includeUnaccepted, setIncludeUnaccepted] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    scenariosApi.list(projectId).then(setScenarios).catch(console.error);
  }, [projectId]);

  const getFilteredScenarios = () => {
    let filtered = scenarios;
    if (!includeUnaccepted) filtered = filtered.filter(s => s.accepted);
    if (!includeTNR) filtered = filtered.filter(s => !s.is_tnr);
    return filtered;
  };

  const exportData = () => {
    const filtered = getFilteredScenarios();
    if (filtered.length === 0) {
      alert('Aucun scénario à exporter avec les options sélectionnées.');
      return;
    }

    let content: string;
    let mimeType: string;
    let filename: string;

    switch (format) {
      case 'json':
        content = JSON.stringify(filtered.map(({ scenario_id, title, scenario_type, priority, given_text, when_text, then_text, feature_name, is_tnr }) => ({
          id: scenario_id, title, type: scenario_type, priority, given: given_text, when: when_text, then: then_text, feature: feature_name, isTNR: is_tnr
        })), null, 2);
        mimeType = 'application/json';
        filename = `${project?.name || 'testpilot'}-scenarios.json`;
        break;
      case 'gherkin':
        content = filtered.map(s => `Feature: ${s.feature_name || 'Feature'}\n\n  ${s.scenario_type === 'negative' ? '@negative\n  ' : ''}Scenario: ${s.title}\n    Given ${s.given_text}\n    When ${s.when_text}\n    Then ${s.then_text}\n`).join('\n');
        mimeType = 'text/plain';
        filename = `${project?.name || 'testpilot'}-scenarios.feature`;
        break;
      case 'csv': {
        const headers = ['ID', 'Title', 'Type', 'Priority', 'Given', 'When', 'Then', 'Feature', 'TNR'];
        const rows = filtered.map(s => [s.scenario_id, s.title, s.scenario_type, s.priority, s.given_text, s.when_text, s.then_text, s.feature_name || '', s.is_tnr ? 'Yes' : 'No'].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
        content = [headers.join(','), ...rows].join('\n');
        mimeType = 'text/csv';
        filename = `${project?.name || 'testpilot'}-scenarios.csv`;
        break;
      }
      default:
        alert('Format non encore implémenté');
        return;
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = getFilteredScenarios();
  const acceptedCount = scenarios.filter(s => s.accepted).length;

  if (!projectId) {
    return (
      <div className="text-center py-10 text-[var(--text-muted)]">
        <Download size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour exporter les scénarios.</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold text-[var(--primary)] mb-1">Export</h1>
      <p className="text-sm text-[var(--text-muted)] mb-7">Exportez vos scénarios dans différents formats</p>

      {/* Format Selection */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <button
          onClick={() => setFormat('json')}
          className={`bg-white border rounded-xl p-5 text-left transition-all ${format === 'json' ? 'border-2 border-[var(--primary)] bg-[rgba(59,109,17,0.04)]' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
        >
          <FileJson className="text-lg mb-2.5" />
          <div className="font-bold text-sm">JSON</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Format structuré, idéal pour l'intégration</div>
        </button>
        <button
          onClick={() => setFormat('gherkin')}
          className={`bg-white border rounded-xl p-5 text-left transition-all ${format === 'gherkin' ? 'border-2 border-[var(--primary)] bg-[rgba(59,109,17,0.04)]' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
        >
          <Code className="text-lg mb-2.5" />
          <div className="font-bold text-sm">Gherkin / Cucumber</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Syntaxe BDD pour Cucumber, Behat...</div>
        </button>
        <button
          onClick={() => setFormat('csv')}
          className={`bg-white border rounded-xl p-5 text-left transition-all ${format === 'csv' ? 'border-2 border-[var(--primary)] bg-[rgba(59,109,17,0.04)]' : 'border-[var(--border)] hover:border-[var(--primary)]'}`}
        >
          <Table className="text-lg mb-2.5" />
          <div className="font-bold text-sm">CSV</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Tableur, Excel, Google Sheets</div>
        </button>
        <button
          onClick={() => setFormat('xlsx')}
          className={`bg-white border rounded-xl p-5 text-left transition-all opacity-50 cursor-not-allowed`}
          disabled
        >
          <FileSpreadsheet className="text-lg mb-2.5" />
          <div className="font-bold text-sm">Excel (XLSX)</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">Bientôt disponible</div>
        </button>
      </div>

      {/* Options */}
      <div className="bg-white border border-[var(--border)] rounded-xl p-5 mb-6">
        <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-3.5">Options</div>
        <div className="space-y-3">
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={includeTNR} onChange={(e) => setIncludeTNR(e.target.checked)} className="accent-[var(--primary)] w-4 h-4" />
            <span>Inclure les scénarios TNR</span>
          </label>
          <label className="flex items-center gap-2.5 text-sm cursor-pointer">
            <input type="checkbox" checked={includeUnaccepted} onChange={(e) => setIncludeUnaccepted(e.target.checked)} className="accent-[var(--primary)] w-4 h-4" />
            <span>Inclure les scénarios non acceptés</span>
          </label>
        </div>
      </div>

      {/* Stats */}
      <div className="bg-white border border-[var(--border)] rounded-xl p-5 mb-6">
        <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-muted)] mb-3.5">Aperçu</div>
        <div className="text-sm">
          <span className="font-bold text-[var(--primary)]">{filtered.length}</span> scénario(s) prêt(s) à être exporté(s)
          {scenarios.length !== filtered.length && <span className="text-[var(--text-muted)]"> (sur {scenarios.length} total)</span>}
        </div>
        <div className="text-xs text-[var(--text-muted)] mt-2">
          {acceptedCount} accepté(s) / {scenarios.length} total
        </div>
      </div>

      {/* Export Button */}
      <button
        className="btn btn-primary flex items-center gap-2"
        onClick={exportData}
        disabled={filtered.length === 0}
      >
        <Download size={16} />
        Exporter {filtered.length} scénario(s)
      </button>
    </div>
  );
}
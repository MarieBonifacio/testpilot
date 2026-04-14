import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { scenariosApi } from '../lib/api';
import type { Scenario } from '../types';
import { Download, FileJson, Table, Code, FileSpreadsheet } from 'lucide-react';

type ExportFormat = 'json' | 'gherkin' | 'csv';

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
        content = filtered.map(s =>
          `Feature: ${s.feature_name || 'Feature'}\n\n  ${s.scenario_type === 'negative' ? '@negative\n  ' : ''}Scenario: ${s.title}\n    Given ${s.given_text}\n    When ${s.when_text}\n    Then ${s.then_text}\n`
        ).join('\n');
        mimeType = 'text/plain';
        filename = `${project?.name || 'testpilot'}-scenarios.feature`;
        break;
      case 'csv': {
        const headers = ['ID', 'Title', 'Type', 'Priority', 'Given', 'When', 'Then', 'Feature', 'TNR'];
        const rows = filtered.map(s =>
          [s.scenario_id, s.title, s.scenario_type, s.priority, s.given_text, s.when_text, s.then_text, s.feature_name || '', s.is_tnr ? 'Yes' : 'No']
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
        content = [headers.join(','), ...rows].join('\n');
        mimeType = 'text/csv';
        filename = `${project?.name || 'testpilot'}-scenarios.csv`;
        break;
      }
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
      <div className="empty-state">
        <Download size={48} className="mx-auto mb-4 opacity-30" />
        <p>Veuillez sélectionner un projet pour exporter les scénarios.</p>
      </div>
    );
  }

  const formats: { key: ExportFormat | 'xlsx'; label: string; desc: string; icon: React.ReactNode; disabled?: boolean }[] = [
    { key: 'json',    label: 'JSON',              desc: 'Format structuré, idéal pour l\'intégration', icon: <FileJson size={20} /> },
    { key: 'gherkin', label: 'Gherkin / Cucumber', desc: 'Syntaxe BDD pour Cucumber, Behat…',           icon: <Code size={20} /> },
    { key: 'csv',     label: 'CSV',               desc: 'Tableur, Excel, Google Sheets',               icon: <Table size={20} /> },
    { key: 'xlsx',    label: 'Excel (XLSX)',       desc: 'Bientôt disponible',                          icon: <FileSpreadsheet size={20} />, disabled: true },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--accent)' }}>Export</h1>
      <p className="text-sm mb-7" style={{ color: 'var(--text-muted)' }}>Exportez vos scénarios dans différents formats</p>

      {/* Format Selection */}
      <div className="grid grid-cols-2 gap-3 mb-7">
        {formats.map(({ key, label, desc, icon, disabled }) => {
          const isActive = !disabled && format === key;
          return (
            <button
              key={key}
              onClick={() => !disabled && setFormat(key as ExportFormat)}
              disabled={disabled}
              className="rounded-xl p-5 text-left transition-all"
              style={{
                background: 'var(--bg-elevated)',
                border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                opacity: disabled ? 0.4 : 1,
                cursor: disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <div className="mb-2.5" style={{ color: isActive ? 'var(--accent)' : 'var(--text-muted)' }}>{icon}</div>
              <div className="font-bold text-sm mb-1">{label}</div>
              <div className="text-xs" style={{ color: 'var(--text-dim)' }}>{desc}</div>
            </button>
          );
        })}
      </div>

      {/* Options */}
      <div className="rounded-xl p-5 mb-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Options</div>
        <div className="space-y-3">
          {[
            { checked: includeTNR,          onChange: setIncludeTNR,          label: 'Inclure les scénarios TNR' },
            { checked: includeUnaccepted,   onChange: setIncludeUnaccepted,   label: 'Inclure les scénarios non acceptés' },
          ].map(({ checked, onChange, label }) => (
            <label key={label} className="flex items-center gap-2.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="w-4 h-4"
                style={{ accentColor: 'var(--accent)' }}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: 'var(--text-dim)' }}>Aperçu</div>
        <div className="text-sm">
          <span className="font-bold" style={{ color: 'var(--accent)' }}>{filtered.length}</span>
          <span> scénario(s) prêt(s) à être exporté(s)</span>
          {scenarios.length !== filtered.length && (
            <span style={{ color: 'var(--text-muted)' }}> (sur {scenarios.length} total)</span>
          )}
        </div>
        <div className="text-xs mt-1.5" style={{ color: 'var(--text-dim)' }}>
          {acceptedCount} accepté(s) / {scenarios.length} total
        </div>
      </div>

      {/* Export Button */}
      <button
        className="btn btn-primary"
        onClick={exportData}
        disabled={filtered.length === 0}
      >
        <Download size={15} />
        Exporter {filtered.length} scénario(s)
      </button>
    </div>
  );
}

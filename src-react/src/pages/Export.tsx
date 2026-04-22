import { useState, useEffect } from 'react';
import { useProject } from '../lib/hooks';
import { scenariosApi } from '../lib/api';
import type { Scenario } from '../types';
import { Download, FileJson, Table, Code, FileSpreadsheet } from 'lucide-react';

type ExportFormat = 'json' | 'gherkin' | 'csv' | 'xlsx';

// ── Générateur XLSX minimal (SpreadsheetML, sans dépendance externe) ──────────
function escapeXml(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateXlsx(scenarios: Scenario[], projectName: string): Blob {
  const headers = ['ID', 'Titre', 'Type', 'Priorité', 'Feature', 'Given', 'When', 'Then', 'Accepté', 'TNR'];
  const rows = scenarios.map(s => [
    s.scenario_id,
    s.title,
    s.scenario_type,
    s.priority,
    s.feature_name ?? '',
    s.given_text,
    s.when_text,
    s.then_text,
    s.accepted ? 'Oui' : 'Non',
    s.is_tnr ? 'Oui' : 'Non',
  ]);

  const headerCells = headers.map(h =>
    `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(h)}</Data></Cell>`
  ).join('');

  const dataRows = rows.map(row =>
    `<Row>${row.map(v => `<Cell><Data ss:Type="String">${escapeXml(v)}</Data></Cell>`).join('')}</Row>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:x="urn:schemas-microsoft-com:office:excel">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1" ss:Color="#FFFFFF" />
      <Interior ss:Color="#1E3A5F" ss:Pattern="Solid" />
      <Alignment ss:WrapText="1" />
    </Style>
  </Styles>
  <Worksheet ss:Name="${escapeXml(projectName)} — Scénarios">
    <Table>
      <Column ss:Width="80" />
      <Column ss:Width="200" />
      <Column ss:Width="100" />
      <Column ss:Width="80" />
      <Column ss:Width="120" />
      <Column ss:Width="200" />
      <Column ss:Width="200" />
      <Column ss:Width="200" />
      <Column ss:Width="60" />
      <Column ss:Width="60" />
      <Row>${headerCells}</Row>
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`;

  return new Blob([xml], { type: 'application/vnd.ms-excel;charset=utf-8' });
}

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

    let blob: Blob;
    let filename: string;
    const name = project?.name || 'testpilot';

    switch (format) {
      case 'json': {
        const content = JSON.stringify(filtered.map(({ scenario_id, title, scenario_type, priority, given_text, when_text, then_text, feature_name, is_tnr }) => ({
          id: scenario_id, title, type: scenario_type, priority, given: given_text, when: when_text, then: then_text, feature: feature_name, isTNR: is_tnr
        })), null, 2);
        blob = new Blob([content], { type: 'application/json' });
        filename = `${name}-scenarios.json`;
        break;
      }
      case 'gherkin': {
        const content = filtered.map(s =>
          `Feature: ${s.feature_name || 'Feature'}\n\n  ${s.scenario_type === 'negative' ? '@negative\n  ' : ''}Scenario: ${s.title}\n    Given ${s.given_text}\n    When ${s.when_text}\n    Then ${s.then_text}\n`
        ).join('\n');
        blob = new Blob([content], { type: 'text/plain' });
        filename = `${name}-scenarios.feature`;
        break;
      }
      case 'csv': {
        const csvHeaders = ['ID', 'Title', 'Type', 'Priority', 'Given', 'When', 'Then', 'Feature', 'TNR'];
        const csvRows = filtered.map(s =>
          [s.scenario_id, s.title, s.scenario_type, s.priority, s.given_text, s.when_text, s.then_text, s.feature_name || '', s.is_tnr ? 'Yes' : 'No']
            .map(v => `"${String(v).replace(/"/g, '""')}"`)
            .join(',')
        );
        const content = [csvHeaders.join(','), ...csvRows].join('\n');
        blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
        filename = `${name}-scenarios.csv`;
        break;
      }
      case 'xlsx': {
        blob = generateXlsx(filtered, name);
        filename = `${name}-scenarios.xls`;
        break;
      }
    }

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

  const formats: { key: ExportFormat; label: string; desc: string; icon: React.ReactNode }[] = [
    { key: 'json',    label: 'JSON',               desc: "Format structuré, idéal pour l'intégration", icon: <FileJson size={20} /> },
    { key: 'gherkin', label: 'Gherkin / Cucumber',  desc: 'Syntaxe BDD pour Cucumber, Behat…',          icon: <Code size={20} /> },
    { key: 'csv',     label: 'CSV',                desc: 'Tableur, Excel, Google Sheets (UTF-8)',       icon: <Table size={20} /> },
    { key: 'xlsx',    label: 'Excel (XLSX)',        desc: 'Classeur Excel avec mise en forme',          icon: <FileSpreadsheet size={20} /> },
  ];

  return (
    <div>
      <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--accent)' }}>Export</h1>
      <p className="text-sm mb-7" style={{ color: 'var(--text-muted)' }}>Exportez vos scénarios dans différents formats</p>

      {/* Format Selection */}
      <div className="grid grid-cols-2 gap-3 mb-7">
        {formats.map(({ key, label, desc, icon }) => {
          const isActive = format === key;
          return (
            <button
              key={key}
              onClick={() => setFormat(key)}
              className="rounded-xl p-5 text-left transition-all"
              style={{
                background: 'var(--bg-elevated)',
                border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                cursor: 'pointer',
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
            { checked: includeTNR,        onChange: setIncludeTNR,        label: 'Inclure les scénarios TNR' },
            { checked: includeUnaccepted, onChange: setIncludeUnaccepted, label: 'Inclure les scénarios non acceptés' },
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

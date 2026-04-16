/**
 * Générateur de documents Word pour TestPilot
 * ===========================================
 * Uses cmt-generator-v3.js pour générer des documents formatés
 * aux couleurs CMT.
 */

const { generateMemoire, content, tables, FILIALE_COLORS } = require('../cmt-generator-v3');
const { h, p, bullet, vide, sautPage } = content;
const { makeTable } = tables;

/**
 * Formatte une durée en texte lisible
 */
function formatDuration(seconds) {
  if (!seconds) return '-';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min ${s % 60}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}min`;
}

/**
 * Formate une date en texte français
 */
function formatDateFR(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * Génère un cahier de recette complet
 */
async function generateCahierRecette(projectId, db) {
  const project = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM projects WHERE id = ?', [projectId], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
  
  if (!project) throw new Error('Projet non trouvé');
  
  const docConfig = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM project_doc_config WHERE project_id = ?', [projectId], (err, row) => {
      if (err) reject(err); else resolve(row || {});
    });
  });
  
  const scenarios = await new Promise((resolve, reject) => {
    db.all(`
      SELECT s.*,
        (SELECT COUNT(*) FROM test_results r WHERE r.scenario_id = s.id AND r.status = 'PASS') as pass_count,
        (SELECT COUNT(*) FROM test_results r WHERE r.scenario_id = s.id AND UPPER(r.status) = 'FAIL') as fail_count
      FROM scenarios s
      WHERE s.project_id = ? AND s.accepted = 1
      ORDER BY s.feature_name, s.priority DESC, s.scenario_id
    `, [projectId], (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
  
  const byFeature = {};
  for (const s of scenarios) {
    const feature = s.feature_name || 'Général';
    if (!byFeature[feature]) byFeature[feature] = [];
    byFeature[feature].push(s);
  }
  
  const sections = [];
  
  // Section 1 : Introduction
  sections.push({
    level: 2,
    title: 'Objet du document',
    content: `Ce cahier de recette présente l'ensemble des scénarios de tests du projet ${project.name}.` + 
      `\nIl couvre ${scenarios.length} scénarios répartis sur ${Object.keys(byFeature).length} domaines fonctionnels.` +
      `\n\nLes scénarios sont classés par priorité :` +
      `\n- Haute : fonctionnalités critiques pour l'activité` +
      `\n- Normale : fonctionnalités standards` +
      `\n- Basse : fonctionnalités mineures`
  });
  
  // Section 2 : Synthèse
  const highCount = scenarios.filter(s => s.priority === 'high').length;
  const tnrCount = scenarios.filter(s => s.is_tnr).length;
  
  sections.push({
    level: 2,
    title: 'Synthèse de la couverture',
    content: `
{{coverage_table}}

- Scénarios haute priorité : ${highCount}
- Scénarios TNR : ${tnrCount}
- Couverture fonctionnelle : ${Object.keys(byFeature).length} domaines
- Total des scénarios : ${scenarios.length}
`
  });
  
  // Section 3+ : Scénarios par feature
  for (const [feature, featureScenarios] of Object.entries(byFeature)) {
    const subsections = featureScenarios.map(s => ({
      level: 4,
      title: `${s.scenario_id} — ${s.title}`,
      content: formatScenarioContent(s)
    }));
    
    sections.push({
      level: 2,
      title: feature,
      content: `Cette section couvre ${featureScenarios.length} scénario(s).`,
      subsections
    });
  }
  
  const templateVars = {
    documentType: 'cahier-recette',
    projectTitle: `Cahier de recette — ${project.name}`,
    projectReference: project.name,
    generationDate: new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
    companyName: docConfig?.company_name || 'CMT Groupe',
    companyAddress: docConfig?.company_address,
    companyPostalCode: docConfig?.company_postal_code,
    companyCity: docConfig?.company_city,
    filiale: docConfig?.filiale || 'cmt-groupe',
    sections,
    
    // Tableau de couverture
    coverageData: [
      [{ text: 'Domaine', bold: true, align: 'center' }, { text: 'Total', bold: true, align: 'center' }, { text: 'Acceptés', bold: true, align: 'center' }, { text: 'TNR', bold: true, align: 'center' }, { text: 'Haute priorité', bold: true, align: 'center' }],
      ...Object.entries(byFeature).map(([feature, scs]) => [
        feature,
        scs.length,
        scs.filter(s => s.accepted).length,
        scs.filter(s => s.is_tnr).length,
        scs.filter(s => s.priority === 'high').length,
      ]),
    ],
  };
  
  return generateMemoire(templateVars, { logosDir: './logos' });
}

function formatScenarioContent(scenario) {
  let content = '';
  
  content += `**Type** : ${scenario.scenario_type || 'functional'} | **Priorité** : ${scenario.priority || 'normale'}`;
  if (scenario.is_tnr) content += ' | **TNR**';
  content += '\n\n';
  
  content += `**Given** : ${scenario.given_text || '-'}\n`;
  content += `**When** : ${scenario.when_text || '-'}\n`;
  content += `**Then** : ${scenario.then_text || '-'}\n`;
  
  if (scenario.source_reference) {
    content += `\n**Référence** : ${scenario.source_reference}`;
  }
  
  return content;
}

/**
 * Génère un rapport de campagne
 */
async function generateRapportCampagne(sessionId, db) {
  const session = await new Promise((resolve, reject) => {
    db.get(`
      SELECT s.*, p.name as project_name
      FROM test_sessions s
      JOIN projects p ON s.project_id = p.id
      WHERE s.id = ?
    `, [sessionId], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
  
  if (!session) throw new Error('Session non trouvée');
  
  const results = await new Promise((resolve, reject) => {
    db.all(`
      SELECT r.*, sc.scenario_id, sc.title, sc.feature_name, sc.priority, sc.scenario_type
      FROM test_results r
      JOIN scenarios sc ON r.scenario_id = sc.id
      WHERE r.session_id = ?
      ORDER BY sc.feature_name, sc.scenario_id
    `, [sessionId], (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
  
  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const blocked = results.filter(r => ['BLOQUE', 'BLOCKED'].includes((r.status || '').toUpperCase())).length;
  const total = results.length;
  
  const docConfig = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM project_doc_config WHERE project_id = ?', [session.project_id], (err, row) => {
      if (err) reject(err); else resolve(row || {});
    });
  });
  
  const failedResults = results.filter(r => r.status === 'FAIL' || ['BLOQUE', 'BLOCKED'].includes((r.status || '').toUpperCase()));
  
  const sections = [
    {
      level: 2,
      title: 'Synthèse',
      content: `
Campagne exécutée du ${formatDateFR(session.started_at)} au ${formatDateFR(session.finished_at || session.started_at)}

**Résultats globaux** :
- Total des tests : ${total}
- Passés : ${passed} (${total > 0 ? Math.round(passed/total*100) : 0}%)
- Échecs : ${failed}
- Bloqués : ${blocked}

${session.duration_seconds ? `**Durée** : ${formatDuration(session.duration_seconds)}` : ''}
`
    },
    {
      level: 2,
      title: 'Détail des résultats',
      content: '{{results_table}}'
    },
    {
      level: 2,
      title: 'Anomalies détectées',
      content: failedResults.length > 0 
        ? failedResults.map(r => `- **${r.scenario_id}** : ${r.title}\n  ${r.comment || 'Pas de commentaire'}`).join('\n')
        : 'Aucune anomalie détectée.'
    }
  ];
  
  const templateVars = {
    documentType: 'rapport-campagne',
    projectTitle: `Rapport de campagne — ${session.session_name || session.id}`,
    projectReference: session.project_name,
    generationDate: new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
    companyName: docConfig?.company_name || 'CMT Groupe',
    companyAddress: docConfig?.company_address,
    companyPostalCode: docConfig?.company_postal_code,
    companyCity: docConfig?.company_city,
    filiale: docConfig?.filiale || 'cmt-groupe',
    sections,
    
    // Données pour le tableau de résultats
    resultsData: [
      [{ text: 'ID', bold: true, align: 'center' }, { text: 'Titre', bold: true }, { text: 'Feature', bold: true }, { text: 'Statut', bold: true, align: 'center' }, { text: 'Commentaire', bold: true }],
      ...results.map(r => [
        r.scenario_id,
        r.title,
        r.feature_name || '-',
        { text: r.status, color: r.status === 'PASS' ? '00AA00' : r.status === 'FAIL' ? 'DD0000' : 'FF8800' },
        r.comment || '-',
      ])
    ],
  };
  
  return generateMemoire(templateVars, { logosDir: './logos' });
}

/**
 * Génère un plan de test projet
 */
async function generatePlanTest(projectId, db) {
  const project = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM projects WHERE id = ?', [projectId], (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
  
  if (!project) throw new Error('Projet non trouvé');
  
  const docConfig = await new Promise((resolve, reject) => {
    db.get('SELECT * FROM project_doc_config WHERE project_id = ?', [projectId], (err, row) => {
      if (err) reject(err); else resolve(row || {});
    });
  });
  
  const scenarios = await new Promise((resolve, reject) => {
    db.all(`
      SELECT s.*,
        (SELECT COUNT(*) FROM test_results r WHERE r.scenario_id = s.id AND r.status = 'PASS') as pass_count,
        (SELECT COUNT(*) FROM test_results r WHERE r.scenario_id = s.id AND UPPER(r.status) = 'FAIL') as fail_count
      FROM scenarios s
      WHERE s.project_id = ? AND s.accepted = 1
      ORDER BY s.priority DESC, s.scenario_id
    `, [projectId], (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
  
  const byPriority = { high: [], medium: [], low: [] };
  for (const s of scenarios) {
    const p = s.priority || 'medium';
    if (byPriority[p]) byPriority[p].push(s);
    else byPriority.medium.push(s);
  }
  
  const sections = [
    {
      level: 2,
      title: 'Introduction',
      content: `Ce plan de test définit la stratégie de test pour le projet ${project.name}.` +
        `\n\nObjectifs :` +
        `\n- Valider les fonctionnalités critiques` +
        `\n- Garantir la non-régression` +
        `\n- Documenter les résultats`
    },
    {
      level: 2,
      title: 'Périmètre',
      content: `${scenarios.length} scénarios de test répartis comme suit :` +
        `\n- Haute priorité : ${byPriority.high.length}` +
        `\n- Moyenne priorité : ${byPriority.medium.length}` +
        `\n- Basse priorité : ${byPriority.low.length}`
    },
    {
      level: 2,
      title: 'Stratégie de test',
      content: `**Tests manuels** : Tous les scénarios sont exécutés manuellement.` +
        `\n\n**Critères de validation** :` +
        `\n- 100% des scénarios haute priorité validés` +
        `\n- Taux de succès > 90%` +
        `\n\n**Environnement** :` +
        `\n- Environment de recette défini par le projet`
    },
    {
      level: 2,
      title: 'Livrables',
      content: `- Cahier de recette` +
        `\n- Rapports de campagne` +
        `\n- Synthèse des anomalies`
    }
  ];
  
  const templateVars = {
    documentType: 'plan-test',
    projectTitle: `Plan de test — ${project.name}`,
    projectReference: project.name,
    generationDate: new Date().toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
    companyName: docConfig?.company_name || 'CMT Groupe',
    companyAddress: docConfig?.company_address,
    companyPostalCode: docConfig?.company_postal_code,
    companyCity: docConfig?.company_city,
    filiale: docConfig?.filiale || 'cmt-groupe',
    sections,
  };
  
  return generateMemoire(templateVars, { logosDir: './logos' });
}

module.exports = {
  generateCahierRecette,
  generateRapportCampagne,
  generatePlanTest,
};

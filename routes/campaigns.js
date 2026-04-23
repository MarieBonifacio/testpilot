"use strict";

const express = require("express");

module.exports = function createCampaignsRouter(db, requireAuth, docGenerator) {
  const router = express.Router();

  // ── Helpers DB promisifiés (locaux) ──────────────────
  const dbRunP  = (sql, p=[]) => new Promise((res,rej) => db.run(sql,p,function(e){e?rej(e):res(this)}));
  const dbGetP  = (sql, p=[]) => new Promise((res,rej) => db.get(sql,p,(e,r)=>e?rej(e):res(r)));
  const dbAllP  = (sql, p=[]) => new Promise((res,rej) => db.all(sql,p,(e,r)=>e?rej(e):res(r)));

  // GET /api/projects - Liste tous les projets
  router.get("/api/projects", requireAuth, (req, res) => {
    db.all(`
      SELECT p.*, 
             (SELECT COUNT(*) FROM scenarios WHERE project_id = p.id) as scenario_count,
             (SELECT COUNT(*) FROM scenarios WHERE project_id = p.id AND accepted = 1) as accepted_count
      FROM projects p 
      ORDER BY p.name
    `, [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
      });
  });

  // GET /api/projects/:id - Récupère un projet par ID
  router.get("/api/projects/:id", requireAuth, (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: 'ID projet invalide' });

    db.get(`
      SELECT p.*, 
             (SELECT COUNT(*) FROM scenarios WHERE project_id = p.id) as scenario_count,
             (SELECT COUNT(*) FROM scenarios WHERE project_id = p.id AND accepted = 1) as accepted_count
      FROM projects p 
      WHERE p.id = ?
    `, [projectId], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: `Projet ${projectId} non trouvé` });
      res.json(row);
    });
  });

  // POST /api/projects — Créer un nouveau projet
  router.post("/api/projects", requireAuth, (req, res) => {
    const { name, tech_stack, business_domain, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Le nom du projet est requis" });
    }
    const trimmedName = String(name).trim();
    db.run(
      `INSERT INTO projects (name, tech_stack, business_domain, description)
       VALUES (?, ?, ?, ?)`,
      [trimmedName, tech_stack || null, business_domain || null, description || null],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(409).json({ error: `Un projet nommé "${trimmedName}" existe déjà` });
          }
          return res.status(500).json({ error: err.message });
        }
        db.get(
          `SELECT p.*, 0 as scenario_count, 0 as accepted_count FROM projects p WHERE p.id = ?`,
          [this.lastID],
          (err2, row) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.status(201).json(row);
          }
        );
      }
    );
  });

  // PUT /api/projects/:id — Mettre à jour un projet
  router.put("/api/projects/:id", requireAuth, (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: "ID projet invalide" });

    const { name, tech_stack, business_domain, description } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "Le nom du projet est requis" });
    }
    const trimmedName = String(name).trim();
    db.run(
      `UPDATE projects SET name = ?, tech_stack = ?, business_domain = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [trimmedName, tech_stack || null, business_domain || null, description || null, projectId],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE constraint failed")) {
            return res.status(409).json({ error: `Un projet nommé "${trimmedName}" existe déjà` });
          }
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) return res.status(404).json({ error: `Projet ${projectId} non trouvé` });
        db.get(
          `SELECT p.*,
                  (SELECT COUNT(*) FROM scenarios WHERE project_id = p.id) as scenario_count,
                  (SELECT COUNT(*) FROM scenarios WHERE project_id = p.id AND accepted = 1) as accepted_count
           FROM projects p WHERE p.id = ?`,
          [projectId],
          (err2, row) => {
            if (err2) return res.status(500).json({ error: err2.message });
            res.json(row);
          }
        );
      }
    );
  });

  // DELETE /api/projects/:id — Supprimer un projet (admin/cp uniquement)
  router.delete("/api/projects/:id", requireAuth, (req, res) => {
    const projectId = parseInt(req.params.id, 10);
    if (isNaN(projectId)) return res.status(400).json({ error: "ID projet invalide" });

    // Vérification rôle : cp ou admin uniquement
    const role = req.currentUser?.role;
    if (!["cp", "admin"].includes(role)) {
      return res.status(403).json({ error: "Droits insuffisants pour supprimer un projet" });
    }

    db.run(`DELETE FROM projects WHERE id = ?`, [projectId], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: `Projet ${projectId} non trouvé` });
      res.status(204).end();
    });
  });

  // GET /api/campaigns/:id/export-rapport — exporter le rapport d'une campagne archivée
  router.get('/api/campaigns/:id/export-rapport', requireAuth, async (req, res) => {
    const campaignId = parseInt(req.params.id);
    
    db.get('SELECT * FROM campaigns WHERE id = ?', [campaignId], (err, campaign) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!campaign) return res.status(404).json({ error: 'Campagne non trouvée' });
      
      // Parser les résultats si besoin
      let results = [];
      try {
        results = typeof campaign.results_json === 'string' ? JSON.parse(campaign.results_json) : (campaign.results_json || []);
      } catch { results = []; }
      
      const docConfig = {};
      db.get('SELECT * FROM project_doc_config WHERE project_id = ?', [campaign.project_id], (err2, cfg) => {
        if (!err2 && cfg) Object.assign(docConfig, cfg);
        
        // Générer le document avec le template
        const templateVars = {
          documentType: 'rapport-campagne',
          projectTitle: `Rapport de campagne — ${campaign.name || campaignId}`,
          projectReference: campaign.type === 'TNR' ? 'TNR' : 'Complet',
          generationDate: new Date(campaign.finished_at || campaign.created_at).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }),
          companyName: docConfig.company_name || 'CMT',
          companyAddress: docConfig.company_address,
          companyPostalCode: docConfig.company_postal_code,
          companyCity: docConfig.company_city,
          filiale: docConfig.filiale || 'cmt-groupe',
          sections: [
            {
              level: 2,
              title: 'Synthèse',
              content: `
Campagne réalisée le ${new Date(campaign.finished_at || campaign.started_at || Date.now()).toLocaleDateString('fr-FR')}

**Résultats** :
- Total : ${campaign.total}
- Passés : ${campaign.pass} (${campaign.total > 0 ? Math.round(campaign.pass / campaign.total * 100) : 0}%)
- Échecs : ${campaign.fail}
- Bloqués : ${campaign.blocked}
- Non exécutés : ${campaign.skipped}
`
            },
            {
              level: 2,
              title: 'Anomalies',
              content: results.filter(r => r.status === 'fail' || r.status === 'blocked')
                .map(r => `- **${r.id}** : ${r.title}\n  ${r.comment || ''}`).join('\n') || 'Aucune anomalie'
            }
          ],
          resultsData: [
            [{ text: 'ID', bold: true }, { text: 'Titre', bold: true }, { text: 'Feature', bold: true }, { text: 'Statut', bold: true }],
            ...results.map(r => [r.id, r.title, r.feature || '-', r.status.toUpperCase()])
          ]
        };
        
        // Utiliser docGenerator si disponible, sinon générer réponse simple
        if (typeof docGenerator !== 'undefined' && docGenerator && docGenerator.generateRapportCampagne) {
          docGenerator.generateRapportCampagne(campaignId, db).then(buffer => {
            res.set({
              'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'Content-Disposition': `attachment; filename="rapport-campagne-${campaignId}.docx"`
            });
            res.send(buffer);
          }).catch(e => {
            console.error('Export error:', e);
            res.status(500).json({ error: e.message });
          });
        } else {
          res.status(500).json({ error: 'Module docGenerator non chargé' });
        }
      });
    });
  });

  /**
   * POST /api/projects/:id/campaigns  — Enregistre une campagne terminée
   * Body: { name, type, started_at, finished_at, total, pass, fail, blocked, skipped, results[] }
   */
  router.post("/api/projects/:id/campaigns", requireAuth, (req, res) => {
    const projectId = req.params.id;
    const { name, type, started_at, finished_at, total, pass, fail, blocked, skipped, results } = req.body;

    db.run(`
      INSERT INTO campaigns (project_id, name, type, started_at, finished_at, total, pass, fail, blocked, skipped, results_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [projectId, name || "Campagne", type || "ALL", started_at, finished_at, total || 0, pass || 0, fail || 0, blocked || 0, skipped || 0, JSON.stringify(results || [])],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID });
    });
  });

  /**
   * GET /api/projects/:id/campaigns  — Liste toutes les campagnes d'un projet
   */
  router.get("/api/projects/:id/campaigns", requireAuth, (req, res) => {
    db.all(`
      SELECT id, project_id, name, type, started_at, finished_at,
             total, pass, fail, blocked, skipped,
             CASE WHEN total > 0 THEN ROUND(pass * 100.0 / total, 1) ELSE 0 END as success_rate,
             CASE WHEN total > 0 THEN ROUND((fail + blocked) * 100.0 / total, 1) ELSE 0 END as leak_rate,
             CAST((strftime('%s', finished_at) - strftime('%s', started_at)) AS INTEGER) as duration_sec,
             results_json
      FROM campaigns
      WHERE project_id = ?
      ORDER BY finished_at DESC
    `, [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      // Calcul tnr_count et tnr_pass depuis results_json
      const enriched = rows.map(row => {
        let tnr_count = 0, tnr_pass = 0;
        try {
          const results = JSON.parse(row.results_json || "[]");
          tnr_count = results.filter(r => r.is_tnr).length;
          tnr_pass  = results.filter(r => r.is_tnr && r.status === "PASS").length;
        } catch (_) {}
        const { results_json: _rj, ...rest } = row;
        return { ...rest, tnr_count, tnr_pass };
      });
      res.json(enriched);
    });
  });

  /**
   * GET /api/campaigns/:id  — Détail d'une campagne avec résultats complets
   */
  router.get("/api/campaigns/:id", requireAuth, (req, res) => {
    db.get("SELECT * FROM campaigns WHERE id = ?", [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Campagne non trouvée" });
      row.results = JSON.parse(row.results_json || "[]");
      delete row.results_json;
      res.json(row);
    });
  });

  /**
   * DELETE /api/campaigns/:id  — Supprimer une campagne
   */
  router.delete("/api/campaigns/:id", requireAuth, (req, res) => {
    db.run("DELETE FROM campaigns WHERE id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Campagne non trouvée" });
      res.json({ deleted: true });
    });
  });

  /**
   * GET /api/projects/:id/coverage-matrix
   * Retourne la matrice exigence ↔ scénario, groupée par source_reference.
   * Les scénarios sans référence sont regroupés sous "Sans référence".
   */
  router.get("/api/projects/:id/coverage-matrix", requireAuth, (req, res) => {
    const projectId = req.params.id;

    db.all(`
      SELECT id, scenario_id, title, scenario_type, priority,
             feature_name, source_reference, accepted, is_tnr,
             given_text, when_text, then_text
      FROM scenarios
      WHERE project_id = ?
      ORDER BY COALESCE(source_reference, 'ZZZ'), feature_name, scenario_id
    `, [projectId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      // Grouper par source_reference
      const groups = {};
      for (const row of rows) {
        const ref = row.source_reference || null;
        const key = ref || "__NONE__";
        if (!groups[key]) {
          groups[key] = { reference: ref, label: ref || "Sans référence", scenarios: [] };
        }
        groups[key].scenarios.push(row);
      }

      // Calcul des stats par groupe
      const matrix = Object.values(groups).map(g => {
        const total    = g.scenarios.length;
        const accepted = g.scenarios.filter(s => s.accepted).length;
        const tnr      = g.scenarios.filter(s => s.is_tnr).length;
        const byType   = {};
        const byPriority = {};
        for (const s of g.scenarios) {
          byType[s.scenario_type] = (byType[s.scenario_type] || 0) + 1;
          byPriority[s.priority]  = (byPriority[s.priority]  || 0) + 1;
        }
        const coverage_pct = total > 0 ? Math.round(accepted / total * 100) : 0;
        return { ...g, total, accepted, tnr, coverage_pct, byType, byPriority };
      });

      // Stats globales
      const allScenarios = rows.length;
      const withRef      = rows.filter(r => r.source_reference).length;
      const withoutRef   = allScenarios - withRef;
      const uniqueRefs   = Object.keys(groups).filter(k => k !== "__NONE__").length;

      res.json({
        matrix,
        stats: { allScenarios, withRef, withoutRef, uniqueRefs }
      });
    });
  });

  /**
   * PUT /api/scenarios/:id/reference  — Mettre à jour la référence source d'un scénario
   */
  router.put("/api/scenarios/:id/reference", requireAuth, (req, res) => {
    const { source_reference } = req.body;
    db.run(
      "UPDATE scenarios SET source_reference = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [source_reference || null, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
        res.json({ updated: true, source_reference: source_reference || null });
      }
    );
  });

  router.get("/api/projects/:id/campaigns/kpis", requireAuth, (req, res) => {
    const projectId = req.params.id;
    db.all(`
      SELECT id, name, type, started_at, finished_at, total, pass, fail, blocked, skipped,
             CASE WHEN total > 0 THEN ROUND(pass * 100.0 / total, 1) ELSE 0 END as success_rate,
             CASE WHEN total > 0 THEN ROUND((fail + blocked) * 100.0 / total, 1) ELSE 0 END as leak_rate,
             CAST((strftime('%s', finished_at) - strftime('%s', started_at)) AS INTEGER) as duration_sec
      FROM campaigns
      WHERE project_id = ?
      ORDER BY finished_at ASC
    `, [projectId], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });

      if (rows.length === 0) return res.json({ campaigns: [], aggregates: null });

      const totalCampaigns = rows.length;
      const avgSuccess = rows.reduce((s, r) => s + (r.success_rate || 0), 0) / totalCampaigns;
      const avgLeak    = rows.reduce((s, r) => s + (r.leak_rate    || 0), 0) / totalCampaigns;
      const avgDur     = rows.filter(r => r.duration_sec > 0).reduce((s, r) => s + r.duration_sec, 0) / (rows.filter(r => r.duration_sec > 0).length || 1);

      // Tendance (dernière vs avant-dernière)
      const trend = rows.length >= 2
        ? rows[rows.length - 1].success_rate - rows[rows.length - 2].success_rate
        : null;

      res.json({
        campaigns: rows,
        aggregates: {
          total_campaigns: totalCampaigns,
          avg_success_rate: Math.round(avgSuccess * 10) / 10,
          avg_leak_rate:    Math.round(avgLeak * 10) / 10,
          avg_duration_sec: Math.round(avgDur),
          trend_vs_previous: trend !== null ? Math.round(trend * 10) / 10 : null
        }
      });
    });
  });

  /**
   * PATCH /api/sessions/:id/is-tnr
   * Marque/démarque une session comme TNR
   */
  router.patch("/api/sessions/:id/is-tnr", requireAuth, (req, res) => {
    const { is_tnr } = req.body;
    db.run(
      "UPDATE test_sessions SET is_tnr = ? WHERE id = ?",
      [is_tnr ? 1 : 0, req.params.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Session non trouvée" });
        res.json({ updated: true });
      }
    );
  });

  /**
   * GET /api/projects/:id/kpis/tnr-duration
   */
  router.get("/api/projects/:id/kpis/tnr-duration", requireAuth, async (req, res) => {
    const projectId = req.params.id;
    try {
      const [sessions, setting] = await Promise.all([
        dbAllP(
          `SELECT id, session_name, started_at, finished_at, duration_seconds, scenario_count, is_tnr
           FROM test_sessions
           WHERE project_id = ? AND is_tnr = 1 AND finished_at IS NOT NULL AND duration_seconds IS NOT NULL
           ORDER BY finished_at DESC
           LIMIT 20`,
          [projectId]
        ),
        dbGetP("SELECT tnr_target_minutes FROM project_kpi_settings WHERE project_id = ?", [projectId])
      ]);

      if (sessions.length === 0) {
        return res.json({
          average_duration_seconds: null,
          average_duration_formatted: null,
          min_duration_seconds: null,
          max_duration_seconds: null,
          last_10_sessions: [],
          trend: "stable",
          target_duration_seconds: setting?.tnr_target_minutes ? setting.tnr_target_minutes * 60 : null
        });
      }

      const durations = sessions.map(s => s.duration_seconds);
      const avg = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      const min = Math.min(...durations);
      const max = Math.max(...durations);

      // Tendance : comparer la moyenne des 3 dernières vs les 3 précédentes
      let trend = "stable";
      if (sessions.length >= 6) {
        const recent = sessions.slice(0, 3).map(s => s.duration_seconds);
        const older  = sessions.slice(3, 6).map(s => s.duration_seconds);
        const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
        const avgOlder  = older.reduce((a, b) => a + b, 0)  / older.length;
        const delta = (avgRecent - avgOlder) / avgOlder;
        if (delta < -0.05) trend = "improving";
        else if (delta > 0.05) trend = "degrading";
      }

      const formatDuration = (s) => {
        if (s < 60)   return `${s}s`;
        if (s < 3600) return `${Math.floor(s / 60)}min ${s % 60}s`;
        return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}min`;
      };

      res.json({
        average_duration_seconds:   avg,
        average_duration_formatted: formatDuration(avg),
        min_duration_seconds:       min,
        max_duration_seconds:       max,
        last_10_sessions: sessions.slice(0, 10).map(s => ({
          id:               s.id,
          date:             s.finished_at,
          session_name:     s.session_name,
          duration_seconds: s.duration_seconds,
          duration_formatted: formatDuration(s.duration_seconds),
          scenario_count:   s.scenario_count
        })),
        trend,
        target_duration_seconds: setting?.tnr_target_minutes ? setting.tnr_target_minutes * 60 : null
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /**
   * POST /api/projects/:id/settings/tnr-target
   * Body: { target_duration_minutes: number }
   */
  router.post("/api/projects/:id/settings/tnr-target", requireAuth, (req, res) => {
    const { target_duration_minutes } = req.body;
    if (!Number.isFinite(target_duration_minutes) || target_duration_minutes <= 0) {
      return res.status(400).json({ error: "target_duration_minutes doit être un entier positif" });
    }
    db.run(
      `INSERT INTO project_kpi_settings (project_id, tnr_target_minutes, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(project_id) DO UPDATE SET
         tnr_target_minutes = excluded.tnr_target_minutes,
         updated_at = datetime('now')`,
      [req.params.id, Math.round(target_duration_minutes)],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ saved: true, target_duration_minutes: Math.round(target_duration_minutes) });
      }
    );
  });

  /**
   * GET /api/projects/:id/kpis/flakiness
   */
  router.get("/api/projects/:id/kpis/flakiness", requireAuth, async (req, res) => {
    const projectId = req.params.id;
    try {
      const stats = await dbAllP(
        `SELECT fs.scenario_id, fs.total_executions, fs.flaky_changes, fs.flakiness_rate,
                fs.last_status, fs.last_calculated,
                sc.title, sc.scenario_id AS scenario_ref, sc.feature_name, sc.priority
         FROM scenario_flakiness_stats fs
         JOIN scenarios sc ON sc.id = fs.scenario_id
         WHERE sc.project_id = ?
         ORDER BY fs.flakiness_rate DESC, fs.flaky_changes DESC`,
        [projectId]
      );

      const total = stats.length;
      const flakyCount = stats.filter(s => s.flakiness_rate > 0).length;
      const globalRate = total > 0
        ? Math.round(stats.reduce((a, s) => a + s.flakiness_rate, 0) / total * 10) / 10
        : 0;

      // Par feature
      const byFeature = {};
      stats.forEach(s => {
        const f = s.feature_name || "Sans feature";
        if (!byFeature[f]) byFeature[f] = { count: 0, flaky_count: 0 };
        byFeature[f].count++;
        if (s.flakiness_rate > 0) byFeature[f].flaky_count++;
      });

      // Dernière modification de statut pour chaque scénario flaky
      const mostFlaky = await Promise.all(
        stats.filter(s => s.flakiness_rate > 0).slice(0, 10).map(async s => {
          const last = await dbGetP(
            `SELECT detected_at, previous_status, new_status
             FROM scenario_status_changes
             WHERE scenario_id = ?
             ORDER BY detected_at DESC LIMIT 1`,
            [s.scenario_id]
          );
          return {
            scenario_id:    s.scenario_id,
            scenario_ref:   s.scenario_ref,
            title:          s.title,
            feature:        s.feature_name,
            priority:       s.priority,
            flakiness_rate: s.flakiness_rate,
            total_executions: s.total_executions,
            flaky_changes:  s.flaky_changes,
            last_change:    last?.detected_at || null,
            last_from:      last?.previous_status || null,
            last_to:        last?.new_status || null
          };
        })
      );

      res.json({
        global_flakiness_rate: globalRate,
        flaky_scenarios_count: flakyCount,
        total_scenarios_count: total,
        stability_rate: total > 0 ? Math.round((1 - flakyCount / total) * 100 * 10) / 10 : 100,
        most_flaky: mostFlaky,
        by_feature: byFeature
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  /**
   * GET /api/scenarios/:id/flakiness-history
   */
  router.get("/api/scenarios/:id/flakiness-history", requireAuth, async (req, res) => {
    try {
      const [history, stats] = await Promise.all([
        dbAllP(
          `SELECT sc.id, sc.session_id, sc.previous_status, sc.new_status, sc.is_flaky_change,
                  sc.detected_at, ts.session_name, ts.finished_at
           FROM scenario_status_changes sc
           JOIN test_sessions ts ON ts.id = sc.session_id
           WHERE sc.scenario_id = ?
           ORDER BY sc.detected_at DESC
           LIMIT 50`,
          [req.params.id]
        ),
        dbGetP(
          "SELECT * FROM scenario_flakiness_stats WHERE scenario_id = ?",
          [req.params.id]
        )
      ]);
      res.json({ history, stats: stats || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};

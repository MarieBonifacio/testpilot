"use strict";

const express = require("express");

module.exports = function createProductionBugsRouter(db, requireAuth) {
  const router = express.Router();

  /**
   * GET /api/projects/:id/production-bugs
   * Query: ?page=1&limit=20&severity=critical&has_scenario=true|false
   */
  router.get("/api/projects/:id/production-bugs", requireAuth, (req, res) => {
    const projectId = req.params.id;
    const page      = Math.max(1, parseInt(req.query.page)  || 1);
    const limit     = Math.min(100, parseInt(req.query.limit) || 20);
    const offset    = (page - 1) * limit;

    let where  = "b.project_id = ?";
    const params = [projectId];

    if (req.query.severity) {
      where += " AND b.severity = ?";
      params.push(req.query.severity);
    }
    if (req.query.has_scenario === "true") {
      where += " AND b.scenario_id IS NOT NULL";
    } else if (req.query.has_scenario === "false") {
      where += " AND b.scenario_id IS NULL";
    }
    if (req.query.feature) {
      where += " AND b.feature = ?";
      params.push(req.query.feature);
    }

    const countSql = `SELECT COUNT(*) AS total FROM production_bugs b WHERE ${where}`;
    const dataSql  = `
      SELECT b.*,
             s.title AS scenario_title,
             s.scenario_id AS scenario_ref
      FROM production_bugs b
      LEFT JOIN scenarios s ON s.id = b.scenario_id
      WHERE ${where}
      ORDER BY b.detected_date DESC, b.created_at DESC
      LIMIT ? OFFSET ?
    `;

    db.get(countSql, params, (err, countRow) => {
      if (err) return res.status(500).json({ error: err.message });
      db.all(dataSql, [...params, limit, offset], (err2, rows) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({
          bugs:  rows,
          total: countRow.total,
          page,
          limit,
          pages: Math.ceil(countRow.total / limit)
        });
      });
    });
  });

  /**
   * POST /api/projects/:id/production-bugs
   * Body: { title, description?, severity?, scenario_id?, detected_date, feature?, external_id?, root_cause? }
   */
  router.post("/api/projects/:id/production-bugs", requireAuth, (req, res) => {
    const projectId = req.params.id;
    const { title, description, severity, scenario_id, detected_date, feature, external_id, root_cause } = req.body;
    if (!title)          return res.status(400).json({ error: "title est requis" });
    if (!detected_date)  return res.status(400).json({ error: "detected_date est requis" });

    db.run(`
      INSERT INTO production_bugs
        (project_id, external_id, title, description, severity, scenario_id, detected_date, feature, root_cause)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      projectId,
      external_id  || null,
      title,
      description  || null,
      severity     || "major",
      scenario_id  || null,
      detected_date,
      feature      || null,
      root_cause   || null
    ], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.status(201).json({ id: this.lastID });
    });
  });

  /**
   * PUT /api/production-bugs/:id
   */
  router.put("/api/production-bugs/:id", requireAuth, (req, res) => {
    const { title, description, severity, scenario_id, detected_date, feature, external_id, root_cause } = req.body;
    db.run(`
      UPDATE production_bugs SET
        title         = COALESCE(?, title),
        description   = ?,
        severity      = COALESCE(?, severity),
        scenario_id   = ?,
        detected_date = COALESCE(?, detected_date),
        feature       = ?,
        external_id   = ?,
        root_cause    = ?
      WHERE id = ?
    `, [
      title        || null,
      description  !== undefined ? description  : null,
      severity     || null,
      scenario_id  !== undefined ? scenario_id  : null,
      detected_date || null,
      feature      !== undefined ? feature      : null,
      external_id  !== undefined ? external_id  : null,
      root_cause   !== undefined ? root_cause   : null,
      req.params.id
    ], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Bug non trouvé" });
      res.json({ updated: true });
    });
  });

  /**
   * DELETE /api/production-bugs/:id
   */
  router.delete("/api/production-bugs/:id", requireAuth, (req, res) => {
    db.run("DELETE FROM production_bugs WHERE id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Bug non trouvé" });
      res.json({ deleted: true });
    });
  });

  /**
   * GET /api/projects/:id/kpis/leak-rate
   * Retourne le taux de fuite avec détails (by_severity, by_feature, trend_30d)
   */
  router.get("/api/projects/:id/kpis/leak-rate", requireAuth, (req, res) => {
    const projectId = req.params.id;

    const q = (sql, params) => new Promise((resolve, reject) =>
      db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
    );

    Promise.all([
      q(`SELECT b.*, s.title AS scenario_title
         FROM production_bugs b
         LEFT JOIN scenarios s ON s.id = b.scenario_id
         WHERE b.project_id = ?
         ORDER BY b.detected_date DESC`, [projectId]),
      // Trend 30 jours : nombre de bugs par jour (tous et avec scénario lié)
      q(`SELECT
           date(detected_date) AS day,
           COUNT(*) AS total,
           SUM(CASE WHEN scenario_id IS NOT NULL THEN 1 ELSE 0 END) AS leaked
         FROM production_bugs
         WHERE project_id = ?
           AND detected_date >= date('now', '-29 days')
         GROUP BY date(detected_date)
         ORDER BY day ASC`, [projectId])
    ]).then(([bugs, dailyData]) => {
      const total             = bugs.length;
      const bugs_with_scenario    = bugs.filter(b => b.scenario_id !== null).length;
      const bugs_without_scenario = total - bugs_with_scenario;
      const leak_rate_percent = total > 0
        ? Math.round(bugs_with_scenario / total * 1000) / 10
        : 0;

      // Par sévérité
      const severities = ["critical", "major", "minor", "trivial"];
      const by_severity = {};
      severities.forEach(sev => {
        const subset = bugs.filter(b => b.severity === sev);
        by_severity[sev] = {
          total:  subset.length,
          leaked: subset.filter(b => b.scenario_id !== null).length
        };
      });

      // Par feature
      const by_feature = {};
      bugs.forEach(b => {
        const f = b.feature || "Sans feature";
        if (!by_feature[f]) by_feature[f] = { total: 0, leaked: 0 };
        by_feature[f].total++;
        if (b.scenario_id !== null) by_feature[f].leaked++;
      });

      // Trend 30 jours — tableau de 30 valeurs (taux quotidien en %)
      // On construit un dictionnaire jour → taux, puis on remplit les jours manquants avec null
      const dayMap = {};
      dailyData.forEach(d => {
        dayMap[d.day] = d.total > 0 ? Math.round(d.leaked / d.total * 1000) / 10 : 0;
      });
      const trend_30d = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        trend_30d.push(dayMap[key] !== undefined ? dayMap[key] : null);
      }

      res.json({
        total_bugs:            total,
        bugs_with_scenario,
        bugs_without_scenario,
        leak_rate_percent,
        by_severity,
        by_feature,
        trend_30d,
        recent_bugs: bugs.slice(0, 10).map(b => ({
          id:             b.id,
          title:          b.title,
          severity:       b.severity,
          feature:        b.feature,
          detected_date:  b.detected_date,
          scenario_id:    b.scenario_id,
          scenario_title: b.scenario_title,
          external_id:    b.external_id
        }))
      });
    }).catch(err => res.status(500).json({ error: err.message }));
  });

  /**
   * GET /api/projects/:id/comep-report
   * Génère le rapport COMEP complet :
   *  - Score de confiance (0-100)
   *  - Couverture des exigences
   *  - Risques résiduels (scénarios high priority non passés)
   *  - Synthèse des campagnes
   */
  router.get("/api/projects/:id/comep-report", requireAuth, (req, res) => {
    const projectId = req.params.id;

    // Récupérer toutes les données du projet en parallèle
    const q = (sql, params) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
    const qGet = (sql, params) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });

    Promise.all([
      qGet("SELECT * FROM projects WHERE id = ?", [projectId]),
      q("SELECT * FROM scenarios WHERE project_id = ?", [projectId]),
      q(`SELECT id, name, type, started_at, finished_at, total, pass, fail, blocked, skipped, results_json
         FROM campaigns WHERE project_id = ? ORDER BY finished_at DESC`, [projectId]),
      q(`SELECT feature_detected, complexity, ambiguities, regression_risks, created_at
         FROM scenario_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`, [projectId]),
      q(`SELECT * FROM production_bugs WHERE project_id = ? AND detected_date >= date('now', '-30 days') ORDER BY detected_date DESC`, [projectId])
    ]).then(([project, scenarios, campaigns, analyses, recentBugs]) => {
      if (!project) return res.status(404).json({ error: "Projet non trouvé" });

      const totalScenarios  = scenarios.length;
      const accepted        = scenarios.filter(s => s.accepted).length;
      const tnr             = scenarios.filter(s => s.is_tnr).length;
      const withRef         = scenarios.filter(s => s.source_reference).length;
      const highPriority    = scenarios.filter(s => s.priority === "high").length;
      const highAccepted    = scenarios.filter(s => s.priority === "high" && s.accepted).length;

      // Couverture globale
      const coverageRate    = totalScenarios > 0 ? (accepted / totalScenarios * 100) : 0;
      const traceRate       = totalScenarios > 0 ? (withRef / totalScenarios * 100) : 0;

      // Dernière campagne terminée
      const lastCampaign    = campaigns.find(c => c.finished_at) || null;
      const lastResults     = lastCampaign ? JSON.parse(lastCampaign.results_json || "[]") : [];
      const lastPassRate    = lastCampaign && lastCampaign.total > 0
        ? (lastCampaign.pass / lastCampaign.total * 100) : null;
      const lastLeakRate    = lastCampaign && lastCampaign.total > 0
        ? ((lastCampaign.fail + lastCampaign.blocked) / lastCampaign.total * 100) : null;

      // Tendance (3 dernières campagnes)
      const recentCampaigns = campaigns.filter(c => c.finished_at).slice(0, 3);
      const trend = recentCampaigns.map(c => ({
        name:      c.name || "Campagne",
        date:      c.finished_at,
        pass_rate: c.total > 0 ? Math.round(c.pass / c.total * 100) : 0,
        leak_rate: c.total > 0 ? Math.round((c.fail + c.blocked) / c.total * 100) : 0,
        total:     c.total,
        pass:      c.pass,
        fail:      c.fail,
        blocked:   c.blocked
      }));

      // ── Score de confiance ────────────────────────────
      // Formule : couverture(30%) × tracabilité(20%) × taux_pass(30%) × hors_risques_critiques(20%)
      // Chaque composante varie de 0 à 1, le score final est sur 100.
      const compCoverage    = Math.min(coverageRate / 100, 1);
      const compTrace       = Math.min(traceRate / 100, 1);
      const compPass        = lastPassRate !== null ? Math.min(lastPassRate / 100, 1) : 0.5;
      const compCritical    = highPriority > 0 ? (highAccepted / highPriority) : 1;

      const confidenceScore = Math.round(
        (compCoverage * 0.30 + compTrace * 0.20 + compPass * 0.30 + compCritical * 0.20) * 100
      );

      const confidenceLevel =
        confidenceScore >= 80 ? "ÉLEVÉ"   :
        confidenceScore >= 60 ? "MOYEN"   :
        confidenceScore >= 40 ? "FAIBLE"  : "CRITIQUE";

      const confidenceColor =
        confidenceScore >= 80 ? "green" :
        confidenceScore >= 60 ? "amber" :
        confidenceScore >= 40 ? "red"   : "danger";

      // ── Risques résiduels ─────────────────────────────
      // 1. Scénarios high priority non acceptés (non couverts)
      const uncoveredHigh = scenarios
        .filter(s => s.priority === "high" && !s.accepted)
        .map(s => ({
          id: s.scenario_id, title: s.title, feature: s.feature_name,
          reason: "Scénario critique non accepté (non couvert)",
          level: "HIGH"
        }));

      // 2. Scénarios FAIL/BLOQUÉ dans la dernière campagne
      const failedInLastCampaign = lastResults
        .filter(r => r.status === "fail" || r.status === "blocked")
        .map(r => ({
          id: r.id, title: r.title, feature: r.feature,
          reason: `Résultat ${r.status.toUpperCase()} lors de la dernière campagne`,
          comment: r.comment || null,
          level: r.status === "fail" ? "HIGH" : "MEDIUM"
        }));

      // 3. Scénarios sans référence exigence (non tracés)
      const untracedHigh = scenarios
        .filter(s => s.priority === "high" && !s.source_reference)
        .map(s => ({
          id: s.scenario_id, title: s.title, feature: s.feature_name,
          reason: "Scénario critique sans référence exigence",
          level: "MEDIUM"
        }));

      // Déduplication par id
      const riskMap = {};
      [...uncoveredHigh, ...failedInLastCampaign, ...untracedHigh].forEach(r => {
        const key = r.id || r.title;
        if (!riskMap[key] || (r.level === "HIGH" && riskMap[key].level !== "HIGH")) {
          riskMap[key] = r;
        }
      });
      const residualRisks = Object.values(riskMap);

      // ── Features couverture ───────────────────────────
      const featureMap = {};
      scenarios.forEach(s => {
        const f = s.feature_name || "Sans feature";
        if (!featureMap[f]) featureMap[f] = { total: 0, accepted: 0, high: 0 };
        featureMap[f].total++;
        if (s.accepted)         featureMap[f].accepted++;
        if (s.priority === "high") featureMap[f].high++;
      });
      const features = Object.entries(featureMap).map(([name, d]) => ({
        name,
        total: d.total,
        accepted: d.accepted,
        high: d.high,
        coverage_pct: d.total > 0 ? Math.round(d.accepted / d.total * 100) : 0
      })).sort((a, b) => b.high - a.high || b.total - a.total);

      // ── Recommandations ───────────────────────────────
      const recommendations = [];
      if (coverageRate < 80) {
        recommendations.push({
          priority: "HIGH",
          text: `Taux de couverture insuffisant (${Math.round(coverageRate)}%). Accepter les scénarios manquants avant la mise en production.`
        });
      }
      if (traceRate < 70) {
        recommendations.push({
          priority: "MEDIUM",
          text: `${totalScenarios - withRef} scénario(s) sans référence exigence. Compléter la traçabilité dans la page Traçabilité.`
        });
      }
      if (lastLeakRate !== null && lastLeakRate > 15) {
        recommendations.push({
          priority: "HIGH",
          text: `Taux de fuite élevé (${Math.round(lastLeakRate)}%). Analyser les tickets FAIL/BLOQUÉ avant validation COMEP.`
        });
      }
      if (uncoveredHigh.length > 0) {
        recommendations.push({
          priority: "HIGH",
          text: `${uncoveredHigh.length} scénario(s) de priorité haute non couvert(s). Risque résiduel critique.`
        });
      }
      if (tnr === 0) {
        recommendations.push({
          priority: "MEDIUM",
          text: "Aucun scénario marqué TNR. Identifier et marquer les scénarios de non-régression."
        });
      }
      if (recommendations.length === 0) {
        recommendations.push({
          priority: "LOW",
          text: "Tous les indicateurs sont au vert. Le projet peut être présenté en COMEP."
        });
      }

      // ── Section qualité production ────────────────────
      const totalBugs30d   = recentBugs.length;
      const leakedBugs30d  = recentBugs.filter(b => b.scenario_id !== null).length;
      const leakRate30d    = totalBugs30d > 0
        ? Math.round(leakedBugs30d / totalBugs30d * 1000) / 10
        : 0;
      const criticalBugs30d = recentBugs.filter(b => b.severity === "critical" || b.severity === "major");

      if (totalBugs30d > 0 && leakRate30d > 25) {
        recommendations.push({
          priority: "HIGH",
          text: `Taux de fuite production élevé (${leakRate30d}% sur 30j) : ${leakedBugs30d} bug(s) auraient pu être détectés en recette.`
        });
      } else if (totalBugs30d > 0 && leakRate30d > 10) {
        recommendations.push({
          priority: "MEDIUM",
          text: `Taux de fuite production modéré (${leakRate30d}% sur 30j). Renforcer la couverture des features impactées.`
        });
      }

      res.json({
        generated_at: new Date().toISOString(),
        project,
        score: {
          value: confidenceScore,
          level: confidenceLevel,
          color: confidenceColor,
          components: {
            coverage:    Math.round(compCoverage * 100),
            traceability: Math.round(compTrace * 100),
            pass_rate:   Math.round(compPass * 100),
            critical_coverage: Math.round(compCritical * 100)
          }
        },
        summary: {
          totalScenarios, accepted, tnr, withRef, highPriority, highAccepted,
          coverageRate: Math.round(coverageRate),
          traceRate:    Math.round(traceRate),
          totalCampaigns: campaigns.length,
          lastPassRate:  lastPassRate !== null ? Math.round(lastPassRate) : null,
          lastLeakRate:  lastLeakRate !== null ? Math.round(lastLeakRate) : null
        },
        features,
        residualRisks,
        trend,
        recommendations,
        lastCampaign: lastCampaign ? {
          name: lastCampaign.name,
          date: lastCampaign.finished_at,
          total: lastCampaign.total,
          pass:  lastCampaign.pass,
          fail:  lastCampaign.fail,
          blocked: lastCampaign.blocked,
          skipped: lastCampaign.skipped
        } : null,
        lastAnalysis: analyses[0] ? {
          feature_detected: analyses[0].feature_detected,
          complexity:       analyses[0].complexity,
          ambiguities:      JSON.parse(analyses[0].ambiguities || "[]"),
          regression_risks: JSON.parse(analyses[0].regression_risks || "[]"),
          date:             analyses[0].created_at
        } : null,
        production: {
          total_bugs_30d:   totalBugs30d,
          leaked_bugs_30d:  leakedBugs30d,
          leak_rate_30d:    leakRate30d,
          critical_bugs_30d: criticalBugs30d.map(b => ({
            id:            b.id,
            title:         b.title,
            severity:      b.severity,
            feature:       b.feature,
            detected_date: b.detected_date,
            external_id:   b.external_id
          }))
        }
      });
    }).catch(err => res.status(500).json({ error: err.message }));
  });

  return router;
};

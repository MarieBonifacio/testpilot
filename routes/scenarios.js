"use strict";

const express = require("express");

/**
 * @param {object}   db                        - connexion SQLite3
 * @param {Function} requireAuth               - middleware auth obligatoire
 * @param {Function} requireCP                 - middleware rôle CP/admin obligatoire
 * @param {Function} detectFlakinessForSession - async (sessionId) => void, définie dans proxy.js
 */
module.exports = function createScenariosRouter(db, requireAuth, requireCP, detectFlakinessForSession) {
  const router = express.Router();

  // ── Project Context ───────────────────────────────────

  // GET /api/projects/:id/context
  router.get("/api/projects/:id/context", requireAuth, (req, res) => {
    db.get("SELECT * FROM project_contexts WHERE project_id = ?", [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || { project_id: parseInt(req.params.id), adjacent_features: "", global_constraints: "" });
    });
  });

  // PUT /api/projects/:id/context
  router.put("/api/projects/:id/context", requireAuth, (req, res) => {
    const { adjacent_features, global_constraints } = req.body;
    const projectId = req.params.id;

    db.run(`
      INSERT INTO project_contexts (project_id, adjacent_features, global_constraints)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        adjacent_features = excluded.adjacent_features,
        global_constraints = excluded.global_constraints,
        updated_at = CURRENT_TIMESTAMP
    `, [projectId, adjacent_features, global_constraints], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ project_id: parseInt(projectId), adjacent_features, global_constraints });
    });
  });

  // ── Scenarios CRUD ────────────────────────────────────

  // GET /api/projects/:id/scenarios
  router.get("/api/projects/:id/scenarios", requireAuth, (req, res) => {
    const { accepted, is_tnr } = req.query;
    let sql = `SELECT s.*, u.display_name AS assignee_name
               FROM scenarios s
               LEFT JOIN users u ON u.id = s.assigned_to
               WHERE s.project_id = ?`;
    const params = [req.params.id];

    if (accepted !== undefined) {
      sql += " AND s.accepted = ?";
      params.push(accepted === "true" ? 1 : 0);
    }
    if (is_tnr !== undefined) {
      sql += " AND s.is_tnr = ?";
      params.push(is_tnr === "true" ? 1 : 0);
    }
    sql += " ORDER BY s.created_at DESC";

    db.all(sql, params, (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // POST /api/projects/:id/scenarios
  router.post("/api/projects/:id/scenarios", requireAuth, (req, res) => {
    const projectId = req.params.id;
    const scenarios = Array.isArray(req.body) ? req.body : [req.body];

    db.serialize(() => {
      // First, find the next available scenario_id for this project
      db.get(
        `SELECT scenario_id FROM scenarios WHERE project_id = ? ORDER BY scenario_id DESC LIMIT 1`,
        [projectId],
        (maxErr, maxRow) => {
          if (maxErr) return res.status(500).json({ error: maxErr.message });

          // Extract numeric part from SC-XXX format, default to 0 if none exist
          let nextNum = 1;
          if (maxRow?.scenario_id) {
            const match = maxRow.scenario_id.match(/SC-(\d+)/);
            if (match) nextNum = parseInt(match[1], 10) + 1;
          }

          db.run("BEGIN TRANSACTION", (beginErr) => {
            if (beginErr) return res.status(500).json({ error: beginErr.message });

            const stmt = db.prepare(`
              INSERT INTO scenarios (project_id, scenario_id, title, scenario_type, priority, given_text, when_text, then_text, feature_name, accepted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const inserted = [];
            let firstError = null;
            let pending = scenarios.length;

            if (pending === 0) {
              stmt.finalize();
              db.run("COMMIT", () => res.status(201).json([]));
              return;
            }

            scenarios.forEach((s, idx) => {
              // Auto-generate scenario_id in SC-XXX format
              const scenarioId = `SC-${String(nextNum + idx).padStart(3, '0')}`;
              stmt.run(
                [projectId, scenarioId, s.title, s.type || s.scenario_type, s.priority, s.given || s.given_text, s.when || s.when_text, s.then || s.then_text, s.feature || s.feature_name, s.accepted ? 1 : 0],
                function(err) {
                  if (err && !firstError) firstError = err;
                  if (!err) inserted.push({ ...s, scenario_id: scenarioId, _dbId: this.lastID });

                  pending -= 1;
                  if (pending > 0) return;

                  stmt.finalize(() => {
                    if (firstError) {
                      db.run("ROLLBACK", () => res.status(500).json({ error: "Erreur lors de l'insertion des scénarios: " + firstError.message }));
                    } else {
                      db.run("COMMIT", () => res.status(201).json(inserted));
                    }
                  });
                }
              );
            });
          });
        }
      );
    });
  });

  // PUT /api/scenarios/:id
  router.put("/api/scenarios/:id", requireAuth, (req, res) => {
    const { title, scenario_type, priority, given_text, when_text, then_text, accepted, is_tnr } = req.body;
    db.run(`
      UPDATE scenarios SET
        title = COALESCE(?, title),
        scenario_type = COALESCE(?, scenario_type),
        priority = COALESCE(?, priority),
        given_text = COALESCE(?, given_text),
        when_text = COALESCE(?, when_text),
        then_text = COALESCE(?, then_text),
        accepted = COALESCE(?, accepted),
        is_tnr = COALESCE(?, is_tnr),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [title, scenario_type, priority, given_text, when_text, then_text, accepted, is_tnr, req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
      res.json({ updated: true });
    });
  });

  // PATCH /api/scenarios/:id/accept
  router.patch("/api/scenarios/:id/accept", requireAuth, (req, res) => {
    db.run("UPDATE scenarios SET accepted = NOT accepted, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
      res.json({ toggled: true });
    });
  });

  // PATCH /api/scenarios/:id/tnr
  router.patch("/api/scenarios/:id/tnr", requireAuth, (req, res) => {
    db.run("UPDATE scenarios SET is_tnr = NOT is_tnr, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
      res.json({ toggled: true });
    });
  });

  // DELETE /api/scenarios/:id
  router.delete("/api/scenarios/:id", requireAuth, (req, res) => {
    db.run("DELETE FROM scenarios WHERE id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
      res.json({ deleted: true });
    });
  });

  // DELETE /api/projects/:id/scenarios — requireCP : action destructrice, rôle minimum cp
  router.delete("/api/projects/:id/scenarios", requireAuth, requireCP, (req, res) => {
    db.run("DELETE FROM scenarios WHERE project_id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: this.changes });
    });
  });

  // POST /api/projects/:id/scenarios/accept-all — requireCP : validation massive
  router.post("/api/projects/:id/scenarios/accept-all", requireAuth, requireCP, (req, res) => {
    db.run("UPDATE scenarios SET accepted = 1, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ accepted: this.changes });
    });
  });

  // ── Analyses ──────────────────────────────────────────

  // GET /api/projects/:id/analysis
  router.get("/api/projects/:id/analysis", requireAuth, (req, res) => {
    db.get("SELECT * FROM scenario_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT 1", [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (row) {
        row.ambiguities     = JSON.parse(row.ambiguities     || "[]");
        row.regression_risks = JSON.parse(row.regression_risks || "[]");
      }
      res.json(row || null);
    });
  });

  // POST /api/projects/:id/analysis
  router.post("/api/projects/:id/analysis", requireAuth, (req, res) => {
    const { feature_detected, complexity, ambiguities, regression_risks } = req.body;
    db.run(
      "INSERT INTO scenario_analyses (project_id, feature_detected, complexity, ambiguities, regression_risks) VALUES (?, ?, ?, ?, ?)",
      [req.params.id, feature_detected, complexity, JSON.stringify(ambiguities || []), JSON.stringify(regression_risks || [])],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID });
      }
    );
  });

  // ── Test Sessions ─────────────────────────────────────

  // GET /api/projects/:id/sessions
  router.get("/api/projects/:id/sessions", requireAuth, (req, res) => {
    db.all(`
      SELECT s.*,
             (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'PASS')   as pass_count,
             (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'FAIL')   as fail_count,
             (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'BLOQUE') as blocked_count
      FROM test_sessions s
      WHERE s.project_id = ?
      ORDER BY s.started_at DESC
    `, [req.params.id], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // POST /api/projects/:id/sessions
  router.post("/api/projects/:id/sessions", requireAuth, (req, res) => {
    const { session_name, scenario_count } = req.body;
    db.run(
      "INSERT INTO test_sessions (project_id, session_name, scenario_count) VALUES (?, ?, ?)",
      [req.params.id, session_name, scenario_count || 0],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, session_name, scenario_count });
      }
    );
  });

  // GET /api/sessions/:id
  router.get("/api/sessions/:id", requireAuth, (req, res) => {
    db.get("SELECT * FROM test_sessions WHERE id = ?", [req.params.id], (err, session) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!session) return res.status(404).json({ error: "Session non trouvée" });

      db.all(`
        SELECT tr.*, sc.title, sc.scenario_id, sc.given_text, sc.when_text, sc.then_text, sc.scenario_type, sc.priority
        FROM test_results tr
        JOIN scenarios sc ON tr.scenario_id = sc.id
        WHERE tr.session_id = ?
        ORDER BY tr.executed_at
      `, [req.params.id], (err2, results) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ ...session, results });
      });
    });
  });

  // PUT /api/sessions/:id/finish
  router.put("/api/sessions/:id/finish", requireAuth, (req, res) => {
    const sessionId = req.params.id;
    db.get("SELECT * FROM test_sessions WHERE id = ?", [sessionId], (err, session) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!session) return res.status(404).json({ error: "Session non trouvée" });

      const finishedAt = new Date().toISOString();
      const startedAt  = session.started_at;
      let durationSeconds = null;
      if (startedAt) {
        durationSeconds = Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000);
      }

      db.run(
        "UPDATE test_sessions SET finished_at = ?, duration_seconds = ? WHERE id = ?",
        [finishedAt, durationSeconds, sessionId],
        function(updateErr) {
          if (updateErr) return res.status(500).json({ error: updateErr.message });
          detectFlakinessForSession(sessionId).catch(e =>
            console.warn("[flakiness] Erreur détection:", e.message)
          );
          res.json({ finished: true, duration_seconds: durationSeconds });
        }
      );
    });
  });

  // POST /api/sessions/:id/results
  router.post("/api/sessions/:id/results", requireAuth, (req, res) => {
    const { scenario_id, status, comment } = req.body;
    const VALID_STATUSES = ["PASS", "FAIL", "BLOQUE", "pass", "fail", "blocked", "skipped"];
    if (!scenario_id || !status) {
      return res.status(400).json({ error: "scenario_id et status sont requis" });
    }
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Statut invalide. Valeurs acceptées : ${VALID_STATUSES.join(", ")}` });
    }
    db.run(
      "INSERT INTO test_results (session_id, scenario_id, status, comment) VALUES (?, ?, ?, ?)",
      [req.params.id, scenario_id, status, comment],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({ id: this.lastID, scenario_id, status, comment });
      }
    );
  });

  // ── Stats / Dashboard ─────────────────────────────────

  // GET /api/projects/:id/stats
  router.get("/api/projects/:id/stats", requireAuth, (req, res) => {
    const projectId = req.params.id;

    db.get(`
      SELECT
        (SELECT COUNT(*) FROM scenarios WHERE project_id = ?) as total,
        (SELECT COUNT(*) FROM scenarios WHERE project_id = ? AND accepted = 1) as accepted,
        (SELECT COUNT(*) FROM scenarios WHERE project_id = ? AND priority = 'high') as critical,
        (SELECT COUNT(*) FROM scenarios WHERE project_id = ? AND is_tnr = 1) as tnr_count
    `, [projectId, projectId, projectId, projectId], (err, stats) => {
      if (err) return res.status(500).json({ error: err.message });

      db.all(`
        SELECT feature_name,
               COUNT(*) as total,
               SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted
        FROM scenarios
        WHERE project_id = ? AND feature_name IS NOT NULL
        GROUP BY feature_name
      `, [projectId], (err2, features) => {
        if (err2) return res.status(500).json({ error: err2.message });
        res.json({ ...stats, features });
      });
    });
  });

  return router;
};

"use strict";

const express  = require("express");
const validate = require("../middleware/validate");

/**
 * @param {object}   db                - connexion SQLite3
 * @param {Function} requireAuth       - middleware auth obligatoire
 * @param {Function} generateApiToken  - génère un token CI/CD (préfixe tpt_)
 * @param {Function} hashApiToken      - hash SHA-256 d'un token API
 */
module.exports = function createCicdRouter(db, requireAuth, generateApiToken, hashApiToken) {
  const router = express.Router();

  // ── API Tokens ────────────────────────────────────────

  // GET /api/user/api-tokens
  router.get("/api/user/api-tokens", requireAuth, (req, res) => {
    db.all(
      `SELECT id, name, token_prefix, scopes, project_ids, last_used_at, expires_at, created_at
       FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC`,
      [req.currentUser.id],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(t => ({
          ...t,
          scopes:      JSON.parse(t.scopes      || "[]"),
          project_ids: t.project_ids ? JSON.parse(t.project_ids) : null,
        })));
      }
    );
  });

  // POST /api/user/api-tokens
  router.post("/api/user/api-tokens", requireAuth, validate.apiToken, (req, res) => {
    const { name, scopes = ["trigger"], project_ids = null, expires_in_days = null } = req.body;
    // Validation handled by validate.apiToken middleware

    const token       = generateApiToken();
    const tokenHash   = hashApiToken(token);
    const tokenPrefix = token.slice(0, 12);
    const expiresAt   = expires_in_days
      ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
      : null;

    db.run(
      `INSERT INTO api_tokens (user_id, name, token_hash, token_prefix, scopes, project_ids, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.currentUser.id,
        name,
        tokenHash,
        tokenPrefix,
        JSON.stringify(scopes),
        project_ids ? JSON.stringify(project_ids) : null,
        expiresAt,
      ],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.status(201).json({
          id:           this.lastID,
          name,
          token,
          token_prefix: tokenPrefix,
          scopes,
          project_ids,
          expires_at:   expiresAt,
          message:      "Sauvegardez ce token maintenant. Il ne sera plus jamais affiché.",
        });
      }
    );
  });

  // DELETE /api/user/api-tokens/:id
  router.delete("/api/user/api-tokens/:id", requireAuth, (req, res) => {
    db.run(
      "DELETE FROM api_tokens WHERE id = ? AND user_id = ?",
      [req.params.id, req.currentUser.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Token non trouvé" });
        res.json({ deleted: true });
      }
    );
  });

  // POST /api/user/api-tokens/:id/rotate
  router.post("/api/user/api-tokens/:id/rotate", requireAuth, (req, res) => {
    const tokenId = req.params.id;
    db.get(
      "SELECT * FROM api_tokens WHERE id = ? AND user_id = ?",
      [tokenId, req.currentUser.id],
      (err, existing) => {
        if (err)       return res.status(500).json({ error: err.message });
        if (!existing) return res.status(404).json({ error: "Token non trouvé" });

        const newToken       = generateApiToken();
        const newTokenHash   = hashApiToken(newToken);
        const newTokenPrefix = newToken.slice(0, 12);

        // Preserve expiry logic: if the old token had an expiry, keep same duration from now
        let newExpiresAt = null;
        if (existing.expires_at) {
          const originalDuration = new Date(existing.expires_at).getTime() - new Date(existing.created_at).getTime();
          newExpiresAt = new Date(Date.now() + originalDuration).toISOString();
        }

        db.run(
          `UPDATE api_tokens
           SET token_hash = ?, token_prefix = ?, expires_at = ?, last_used_at = NULL, created_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
          [newTokenHash, newTokenPrefix, newExpiresAt, tokenId, req.currentUser.id],
          function(err2) {
            if (err2)          return res.status(500).json({ error: err2.message });
            if (this.changes === 0) return res.status(404).json({ error: "Token non trouvé" });
            res.json({
              id:           parseInt(tokenId),
              name:         existing.name,
              token:        newToken,
              token_prefix: newTokenPrefix,
              scopes:       JSON.parse(existing.scopes || "[]"),
              expires_at:   newExpiresAt,
              message:      "Ancien token invalidé. Sauvegardez ce nouveau token maintenant. Il ne sera plus jamais affiché.",
            });
          }
        );
      }
    );
  });

  // ── CI/CD Trigger ─────────────────────────────────────

  // POST /api/trigger
  router.post("/api/trigger", requireAuth, (req, res) => {
    const {
      project,
      filter       = "all",
      mode         = "full",
      scenario_ids,
      commit_sha,
      branch,
      pipeline_url,
    } = req.body;

    if (req.isApiAuth) {
      let scopes = [];
      try { scopes = JSON.parse(req.apiToken.scopes || "[]"); } catch {}
      if (!scopes.includes("trigger")) {
        return res.status(403).json({ error: "Le token n'a pas le scope 'trigger'" });
      }
    }

    if (!project) return res.status(400).json({ error: "project est requis" });

    const projectParam = isNaN(Number(project)) ? null : Number(project);
    db.get(
      `SELECT id, name FROM projects WHERE id = ? OR LOWER(name) = LOWER(?)`,
      [projectParam, String(project)],
      (err, projectRow) => {
        if (err)         return res.status(500).json({ error: err.message });
        if (!projectRow) return res.status(404).json({ error: `Projet non trouvé : ${project}` });

        if (req.isApiAuth && req.apiToken.project_ids) {
          let allowed = [];
          try { allowed = JSON.parse(req.apiToken.project_ids); } catch {}
          if (!allowed.includes(projectRow.id)) {
            return res.status(403).json({ error: "Le token n'a pas accès à ce projet" });
          }
        }

        let scenarioQuery = `SELECT id FROM scenarios WHERE project_id = ? AND accepted = 1`;
        const qp = [projectRow.id];

        if (Array.isArray(scenario_ids) && scenario_ids.length > 0) {
          scenarioQuery += ` AND id IN (${scenario_ids.map(() => "?").join(",")})`;
          qp.push(...scenario_ids);
        } else {
          if (filter === "tnr")           scenarioQuery += ` AND is_tnr = 1`;
          else if (filter === "critical") scenarioQuery += ` AND priority = 'high'`;
          else if (filter.startsWith("feature:")) {
            scenarioQuery += ` AND feature_name = ?`;
            qp.push(filter.slice(8));
          }
        }

        if (mode === "smoke") {
          scenarioQuery += ` AND priority = 'high'`;
        }

        db.all(scenarioQuery, qp, (err2, scenarios) => {
          if (err2) return res.status(500).json({ error: err2.message });
          if (scenarios.length === 0) {
            return res.status(400).json({
              error: "Aucun scénario ne correspond aux critères",
              project: projectRow.name,
              filter,
              mode,
            });
          }

          const sessionName = `CI/CD ${mode}/${filter} – ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
          db.run(
            `INSERT INTO test_sessions (project_id, session_name, scenario_count, is_tnr, started_at)
             VALUES (?, ?, ?, ?, datetime('now'))`,
            [projectRow.id, sessionName, scenarios.length, filter === "tnr" ? 1 : 0],
            function(err3) {
              if (err3) return res.status(500).json({ error: err3.message });
              const sessionId = this.lastID;

              let inserted = 0;
              const onInserted = () => {
                inserted++;
                if (inserted < scenarios.length) return;

                const tokenId = req.isApiAuth ? req.apiToken.id : null;
                const ua = req.headers["user-agent"] || "";
                const triggerSource = ua.includes("GitLab") ? "gitlab-ci"
                  : ua.includes("Azure") ? "azure-devops"
                  : ua.includes("GitHub") ? "github-actions"
                  : "api";

                db.run(
                  `INSERT INTO triggered_executions
                   (session_id, api_token_id, trigger_source, commit_sha, branch, pipeline_url)
                   VALUES (?, ?, ?, ?, ?, ?)`,
                  [sessionId, tokenId, triggerSource, commit_sha || null, branch || null, pipeline_url || null]
                );

                res.status(201).json({
                  session_id:     sessionId,
                  project:        projectRow.name,
                  scenario_count: scenarios.length,
                  filter,
                  mode,
                  status_url:     `/api/sessions/${sessionId}/status`,
                  junit_url:      `/api/sessions/${sessionId}/junit`,
                  bulk_url:       `/api/sessions/${sessionId}/bulk-results`,
                });
              };

              for (const sc of scenarios) {
                db.run(
                  `INSERT INTO test_results (session_id, scenario_id, status) VALUES (?, ?, 'PENDING')`,
                  [sessionId, sc.id],
                  onInserted
                );
              }
            }
          );
        });
      }
    );
  });

  // GET /api/sessions/:id/status
  router.get("/api/sessions/:id/status", requireAuth, (req, res) => {
    const sid = req.params.id;
    db.get(
      `SELECT s.*, p.name as project_name,
         (SELECT COUNT(*) FROM test_results WHERE session_id = s.id) as total,
         (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'PENDING') as pending_count,
         (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'PASS') as passed,
         (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND UPPER(status) = 'FAIL') as failed,
         (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND UPPER(status) IN ('BLOQUE','BLOCKED')) as blocked_count
       FROM test_sessions s
       JOIN projects p ON s.project_id = p.id
       WHERE s.id = ?`,
      [sid],
      (err, session) => {
        if (err)      return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: "Session non trouvée" });

        const state   = !session.finished_at && session.pending_count > 0 ? "running" : "completed";
        const success = session.failed === 0 && session.blocked_count === 0;

        res.json({
          session_id:       session.id,
          project:          session.project_name,
          session_name:     session.session_name,
          state,
          success,
          progress: {
            total:     session.total,
            completed: session.total - session.pending_count,
            pending:   session.pending_count,
            passed:    session.passed,
            failed:    session.failed,
            blocked:   session.blocked_count,
          },
          started_at:       session.started_at,
          finished_at:      session.finished_at,
          duration_seconds: session.duration_seconds,
        });
      }
    );
  });

  // GET /api/sessions/:id/junit
  router.get("/api/sessions/:id/junit", requireAuth, (req, res) => {
    const sid = req.params.id;
    db.get(
      `SELECT s.*, p.name as project_name
       FROM test_sessions s JOIN projects p ON s.project_id = p.id
       WHERE s.id = ?`,
      [sid],
      (err, session) => {
        if (err)      return res.status(500).json({ error: err.message });
        if (!session) return res.status(404).json({ error: "Session non trouvée" });

        db.all(
          `SELECT r.*, sc.title, sc.feature_name as feature, sc.scenario_id as identifier, sc.priority
           FROM test_results r
           JOIN scenarios sc ON r.scenario_id = sc.id
           WHERE r.session_id = ?`,
          [sid],
          (err2, results) => {
            if (err2) return res.status(500).json({ error: err2.message });

            const failed  = results.filter(r => r.status === "FAIL").length;
            const blocked = results.filter(r => ["BLOQUE","BLOCKED"].includes((r.status||"").toUpperCase())).length;
            const skipped = results.filter(r => ["PENDING","SKIP"].includes((r.status||"").toUpperCase())).length;
            const total   = results.length;
            const durationSec = session.duration_seconds || 0;

            const esc = (s) => String(s || "")
              .replace(/&/g, "&amp;").replace(/</g, "&lt;")
              .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
              .replace(/'/g, "&apos;");

            let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
            xml += `<testsuites name="TestPilot – ${esc(session.project_name)}" tests="${total}" failures="${failed}" errors="${blocked}" skipped="${skipped}" time="${durationSec}">\n`;
            xml += `  <testsuite name="${esc(session.session_name)}" tests="${total}" failures="${failed}" errors="${blocked}" skipped="${skipped}" time="${durationSec}">\n`;

            for (const r of results) {
              const testName  = `${r.identifier || "TST-???"}: ${r.title}`;
              const className = `${session.project_name}.${(r.feature || "General").replace(/\s+/g, "_")}`;
              const status    = (r.status || "PENDING").toUpperCase();

              xml += `    <testcase name="${esc(testName)}" classname="${esc(className)}">\n`;
              if (status === "FAIL") {
                xml += `      <failure message="Test échoué">${esc(r.comment)}</failure>\n`;
              } else if (["BLOQUE","BLOCKED"].includes(status)) {
                xml += `      <error message="Test bloqué">${esc(r.comment)}</error>\n`;
              } else if (["PENDING","SKIP"].includes(status)) {
                xml += `      <skipped/>\n`;
              }
              xml += `    </testcase>\n`;
            }

            xml += `  </testsuite>\n</testsuites>`;

            res.set("Content-Type", "application/xml; charset=utf-8");
            res.set("Content-Disposition", `attachment; filename="testpilot-session-${sid}.xml"`);
            res.send(xml);
          }
        );
      }
    );
  });

  // POST /api/sessions/:id/bulk-results
  router.post("/api/sessions/:id/bulk-results", requireAuth, (req, res) => {
    const { results } = req.body;
    if (!Array.isArray(results)) {
      return res.status(400).json({ error: "results doit être un tableau" });
    }

    const sid = req.params.id;
    let done = 0;
    if (results.length === 0) return res.json({ updated: 0, remaining: 0 });

    results.forEach(r => {
      const status = (r.status || "PASS").toUpperCase();
      db.run(
        `UPDATE test_results
         SET status = ?, comment = ?, executed_at = datetime('now')
         WHERE session_id = ? AND scenario_id = ?`,
        [status, r.comment || null, sid, r.scenario_id],
        () => {
          done++;
          if (done < results.length) return;

          db.get(
            `SELECT COUNT(*) as cnt FROM test_results WHERE session_id = ? AND status = 'PENDING'`,
            [sid],
            (err, row) => {
              const remaining = row ? row.cnt : 0;
              if (remaining === 0) {
                db.run(
                  `UPDATE test_sessions
                   SET finished_at = datetime('now'),
                       duration_seconds = CAST((julianday(datetime('now')) - julianday(started_at)) * 86400 AS INTEGER)
                   WHERE id = ? AND finished_at IS NULL`,
                  [sid]
                );
              }
              res.json({ updated: results.length, remaining });
            }
          );
        }
      );
    });
  });

  // GET /api/trigger/history
  router.get("/api/trigger/history", requireAuth, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    db.all(
      `SELECT te.*, ts.session_name, ts.started_at, ts.finished_at, ts.duration_seconds,
              p.name as project_name, at2.name as token_name
       FROM triggered_executions te
       JOIN test_sessions ts ON ts.id = te.session_id
       JOIN projects p ON p.id = ts.project_id
       LEFT JOIN api_tokens at2 ON at2.id = te.api_token_id
       ORDER BY te.triggered_at DESC LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
      }
    );
  });

  return router;
};

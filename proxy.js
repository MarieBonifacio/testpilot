/**
 * TestPilot — Server API + Proxy LLM
 * ===================================
 * Lance avec : node proxy.js
 * Optionnel  : PORT=8080 node proxy.js
 *
 * Fonctionnalités :
 *   - API REST pour projets, scénarios, sessions de tests
 *   - Proxy vers les APIs LLM (Anthropic, OpenAI, Mistral)
 *   - Serveur de fichiers statiques
 */

"use strict";

const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const https   = require("https");
const path    = require("path");
const fs      = require("fs");
const XLSX    = require("xlsx");

const app  = express();
const PORT = process.env.PORT || 3000;
const ENV_KEY = process.env.ANTHROPIC_API_KEY || null;

// ── Database connection ──────────────────────────────
const dbPath = path.join(__dirname, "testpilot.db");
if (!fs.existsSync(dbPath)) {
  console.error("❌ Base de données non trouvée. Lancez d'abord: node init_db.js");
  process.exit(1);
}
const db = new sqlite3.Database(dbPath);
db.run("PRAGMA foreign_keys = ON", (err) => {
  if (err) console.error("⚠  Impossible d'activer les clés étrangères:", err.message);
});

// ── Middleware ───────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "20mb" }));
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key, anthropic-version");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// ── Logging ──────────────────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    const t = new Date().toLocaleTimeString("fr-FR");
    const color = res.statusCode >= 400 ? "\x1b[31m" : res.statusCode >= 300 ? "\x1b[33m" : "\x1b[32m";
    console.log(`${color}[${t}] ${req.method} ${req.path} → ${res.statusCode} (${duration}ms)\x1b[0m`);
  });
  next();
});

// ══════════════════════════════════════════════════════
// ██  API PROJECTS
// ══════════════════════════════════════════════════════

// GET /api/projects - Liste tous les projets
app.get("/api/projects", (req, res) => {
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

// GET /api/projects/:id - Détail d'un projet
app.get("/api/projects/:id", (req, res) => {
  db.get("SELECT * FROM projects WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Projet non trouvé" });
    res.json(row);
  });
});

// POST /api/projects - Créer un projet
app.post("/api/projects", (req, res) => {
  const { name, tech_stack, business_domain, description } = req.body;
  if (!name) return res.status(400).json({ error: "Le nom du projet est requis" });
  
  db.run(
    "INSERT INTO projects (name, tech_stack, business_domain, description) VALUES (?, ?, ?, ?)",
    [name, tech_stack, business_domain, description],
    function(err) {
      if (err) {
        if (err.message.includes("UNIQUE")) {
          return res.status(409).json({ error: "Un projet avec ce nom existe déjà" });
        }
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({ id: this.lastID, name, tech_stack, business_domain, description });
    }
  );
});

// PUT /api/projects/:id - Modifier un projet
app.put("/api/projects/:id", (req, res) => {
  const { name, tech_stack, business_domain, description } = req.body;
  db.run(
    "UPDATE projects SET name = ?, tech_stack = ?, business_domain = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
    [name, tech_stack, business_domain, description, req.params.id],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Projet non trouvé" });
      res.json({ id: parseInt(req.params.id), name, tech_stack, business_domain, description });
    }
  );
});

// DELETE /api/projects/:id - Supprimer un projet
app.delete("/api/projects/:id", (req, res) => {
  db.run("DELETE FROM projects WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Projet non trouvé" });
    res.json({ deleted: true });
  });
});

// ══════════════════════════════════════════════════════
// ██  API PROJECT CONTEXT
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/context - Récupérer le contexte d'un projet
app.get("/api/projects/:id/context", (req, res) => {
  db.get("SELECT * FROM project_contexts WHERE project_id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { project_id: parseInt(req.params.id), adjacent_features: "", global_constraints: "" });
  });
});

// PUT /api/projects/:id/context - Mettre à jour le contexte
app.put("/api/projects/:id/context", (req, res) => {
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

// ══════════════════════════════════════════════════════
// ██  API SCENARIOS
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/scenarios - Liste les scénarios d'un projet
app.get("/api/projects/:id/scenarios", (req, res) => {
  const { accepted, is_tnr } = req.query;
  let sql = "SELECT * FROM scenarios WHERE project_id = ?";
  const params = [req.params.id];
  
  if (accepted !== undefined) {
    sql += " AND accepted = ?";
    params.push(accepted === "true" ? 1 : 0);
  }
  if (is_tnr !== undefined) {
    sql += " AND is_tnr = ?";
    params.push(is_tnr === "true" ? 1 : 0);
  }
  sql += " ORDER BY created_at DESC";
  
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST /api/projects/:id/scenarios - Créer un ou plusieurs scénarios
app.post("/api/projects/:id/scenarios", (req, res) => {
  const projectId = req.params.id;
  const scenarios = Array.isArray(req.body) ? req.body : [req.body];

  db.serialize(() => {
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

      scenarios.forEach(s => {
        stmt.run(
          [projectId, s.id || s.scenario_id, s.title, s.type || s.scenario_type, s.priority, s.given || s.given_text, s.when || s.when_text, s.then || s.then_text, s.feature || s.feature_name, s.accepted ? 1 : 0],
          function(err) {
            if (err && !firstError) firstError = err;
            if (!err) inserted.push({ ...s, _dbId: this.lastID });

            pending -= 1;
            if (pending > 0) return;

            // All stmt.run callbacks have completed — safe to commit/rollback
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
  });
});

// PUT /api/scenarios/:id - Modifier un scénario
app.put("/api/scenarios/:id", (req, res) => {
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

// PATCH /api/scenarios/:id/accept - Basculer l'état accepté
app.patch("/api/scenarios/:id/accept", (req, res) => {
  db.run("UPDATE scenarios SET accepted = NOT accepted, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
    res.json({ toggled: true });
  });
});

// PATCH /api/scenarios/:id/tnr - Marquer/démarquer comme TNR
app.patch("/api/scenarios/:id/tnr", (req, res) => {
  db.run("UPDATE scenarios SET is_tnr = NOT is_tnr, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
    res.json({ toggled: true });
  });
});

// DELETE /api/scenarios/:id - Supprimer un scénario
app.delete("/api/scenarios/:id", (req, res) => {
  db.run("DELETE FROM scenarios WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
    res.json({ deleted: true });
  });
});

// DELETE /api/projects/:id/scenarios - Supprimer tous les scénarios d'un projet
app.delete("/api/projects/:id/scenarios", (req, res) => {
  db.run("DELETE FROM scenarios WHERE project_id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// POST /api/projects/:id/scenarios/accept-all - Accepter tous les scénarios
app.post("/api/projects/:id/scenarios/accept-all", (req, res) => {
  db.run("UPDATE scenarios SET accepted = 1, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ accepted: this.changes });
  });
});

// ══════════════════════════════════════════════════════
// ██  API ANALYSES
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/analysis - Récupérer la dernière analyse
app.get("/api/projects/:id/analysis", (req, res) => {
  db.get("SELECT * FROM scenario_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT 1", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row) {
      row.ambiguities = JSON.parse(row.ambiguities || "[]");
      row.regression_risks = JSON.parse(row.regression_risks || "[]");
    }
    res.json(row || null);
  });
});

// POST /api/projects/:id/analysis - Sauvegarder une analyse
app.post("/api/projects/:id/analysis", (req, res) => {
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

// ══════════════════════════════════════════════════════
// ██  API TEST SESSIONS
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/sessions - Liste des sessions de test
app.get("/api/projects/:id/sessions", (req, res) => {
  db.all(`
    SELECT s.*,
           (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'PASS') as pass_count,
           (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'FAIL') as fail_count,
           (SELECT COUNT(*) FROM test_results WHERE session_id = s.id AND status = 'BLOQUE') as blocked_count
    FROM test_sessions s
    WHERE s.project_id = ?
    ORDER BY s.started_at DESC
  `, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST /api/projects/:id/sessions - Créer une session
app.post("/api/projects/:id/sessions", (req, res) => {
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

// GET /api/sessions/:id - Détail d'une session avec résultats
app.get("/api/sessions/:id", (req, res) => {
  db.get("SELECT * FROM test_sessions WHERE id = ?", [req.params.id], (err, session) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!session) return res.status(404).json({ error: "Session non trouvée" });
    
    db.all(`
      SELECT tr.*, sc.title, sc.scenario_id, sc.given_text, sc.when_text, sc.then_text, sc.scenario_type, sc.priority
      FROM test_results tr
      JOIN scenarios sc ON tr.scenario_id = sc.id
      WHERE tr.session_id = ?
      ORDER BY tr.executed_at
    `, [req.params.id], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ...session, results });
    });
  });
});

// PUT /api/sessions/:id/finish - Terminer une session
app.put("/api/sessions/:id/finish", (req, res) => {
  db.run("UPDATE test_sessions SET finished_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ finished: true });
  });
});

// POST /api/sessions/:id/results - Enregistrer un résultat de test
app.post("/api/sessions/:id/results", (req, res) => {
  const { scenario_id, status, comment } = req.body;
  if (!scenario_id || !status) {
    return res.status(400).json({ error: "scenario_id et status sont requis" });
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

// ══════════════════════════════════════════════════════
// ██  API STATS / DASHBOARD
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/stats - Statistiques d'un projet
app.get("/api/projects/:id/stats", (req, res) => {
  const projectId = req.params.id;
  
  db.get(`
    SELECT
      (SELECT COUNT(*) FROM scenarios WHERE project_id = ?) as total,
      (SELECT COUNT(*) FROM scenarios WHERE project_id = ? AND accepted = 1) as accepted,
      (SELECT COUNT(*) FROM scenarios WHERE project_id = ? AND priority = 'high') as critical,
      (SELECT COUNT(*) FROM scenarios WHERE project_id = ? AND is_tnr = 1) as tnr_count
  `, [projectId, projectId, projectId, projectId], (err, stats) => {
    if (err) return res.status(500).json({ error: err.message });
    
    // Grouper par feature
    db.all(`
      SELECT feature_name, 
             COUNT(*) as total,
             SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) as accepted
      FROM scenarios 
      WHERE project_id = ? AND feature_name IS NOT NULL
      GROUP BY feature_name
    `, [projectId], (err, features) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ...stats, features });
    });
  });
});

// ══════════════════════════════════════════════════════
// ██  API IMPORT EXCEL
// ══════════════════════════════════════════════════════

/**
 * POST /api/projects/:id/import-excel
 * Corps : application/octet-stream (fichier .xlsx brut)
 * Analyse chaque ligne du premier onglet et retourne un tableau
 * de cas de tests normalisés en Given/When/Then via l'IA.
 * Sans clé IA : retourne les lignes brutes sans normalisation.
 */
app.post("/api/projects/:id/import-excel", (req, res) => {
  const projectId = req.params.id;

  // Le corps peut être Buffer (raw) ou { base64: "..." } (json)
  let buffer;
  if (Buffer.isBuffer(req.body)) {
    buffer = req.body;
  } else if (req.body && req.body.base64) {
    buffer = Buffer.from(req.body.base64, "base64");
  } else {
    return res.status(400).json({ error: "Corps de la requête invalide. Envoyez le fichier .xlsx en binaire ou base64." });
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (e) {
    return res.status(400).json({ error: "Impossible de lire le fichier Excel : " + e.message });
  }

  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

  if (rows.length === 0) {
    return res.status(400).json({ error: "Le fichier Excel est vide ou ne contient pas de données exploitables." });
  }

  // Détection automatique des colonnes
  const keys = Object.keys(rows[0]);

  // Helpers pour trouver une colonne par mots-clés (insensible à la casse)
  function findCol(candidates) {
    return keys.find(k => candidates.some(c => k.toLowerCase().includes(c.toLowerCase()))) || null;
  }

  const colTitle    = findCol(["titre", "title", "cas de test", "intitulé", "libellé", "nom", "name"]);
  const colGiven    = findCol(["given", "étant donné", "precondition", "pré-condition", "contexte", "prérequis"]);
  const colWhen     = findCol(["when", "quand", "action", "étape", "step", "operation"]);
  const colThen     = findCol(["then", "alors", "résultat attendu", "expected", "résultat", "attendu"]);
  const colPriority = findCol(["priorité", "priority", "criticité", "criticite", "sévérité", "severite"]);
  const colFeature  = findCol(["feature", "fonctionnalité", "module", "fonction", "composant"]);
  const colType     = findCol(["type", "scenario_type", "nature"]);
  const colRef      = findCol(["référence", "ref", "id", "exigence", "requirement", "user story", "us"]);
  const colDesc     = findCol(["description", "desc", "détail", "detail", "contenu"]);

  // Nettoyage d'une valeur cellule
  function cell(row, col) {
    if (!col) return "";
    return String(row[col] || "").trim();
  }

  // Normaliser la priorité
  function normPriority(raw) {
    const v = raw.toLowerCase();
    if (["haute", "high", "critique", "critical", "h", "1", "p1"].includes(v)) return "high";
    if (["moyenne", "medium", "moyen", "m", "2", "p2"].includes(v)) return "medium";
    if (["basse", "low", "faible", "l", "3", "p3"].includes(v)) return "low";
    return "medium";
  }

  // Normaliser le type
  function normType(raw) {
    const v = raw.toLowerCase();
    if (v.includes("négatif") || v.includes("negatif") || v.includes("neg") || v.includes("erreur")) return "negative";
    if (v.includes("limite") || v.includes("bound") || v.includes("bornage")) return "boundary";
    if (v.includes("edge") || v.includes("cas limite") || v.includes("coin")) return "edge-case";
    return "functional";
  }

  const parsed = rows
    .filter(row => {
      // Ignorer les lignes vides ou en-têtes
      const vals = Object.values(row).map(v => String(v).trim()).filter(Boolean);
      return vals.length > 1;
    })
    .map((row, i) => {
      const title    = cell(row, colTitle) || `Cas de test ${i + 1}`;
      const givenRaw = cell(row, colGiven);
      const whenRaw  = cell(row, colWhen);
      const thenRaw  = cell(row, colThen);
      const descRaw  = cell(row, colDesc);

      // Si pas de colonnes GWT détectées, on met la description complète en "when"
      const given = givenRaw || "Le système est dans son état initial";
      const when  = whenRaw  || descRaw || title;
      const then  = thenRaw  || "Le système se comporte correctement";

      const priorityRaw = cell(row, colPriority);
      const typeRaw     = cell(row, colType);
      const feature     = cell(row, colFeature);
      const ref         = cell(row, colRef);

      return {
        scenario_id:      `IMP-${String(i + 1).padStart(3, "0")}`,
        title,
        scenario_type:    typeRaw ? normType(typeRaw) : "functional",
        priority:         priorityRaw ? normPriority(priorityRaw) : "medium",
        given_text:       given,
        when_text:        when,
        then_text:        then,
        feature_name:     feature || null,
        source_reference: ref || null,
        raw_row:          row,   // gardé pour affichage dans la prévisualisation
        needs_ai:         !givenRaw || !whenRaw || !thenRaw,
        columns_detected: { colTitle, colGiven, colWhen, colThen, colPriority, colFeature, colType, colRef }
      };
    });

  res.json({
    sheet_name:  sheetName,
    total_rows:  rows.length,
    parsed_count: parsed.length,
    columns_detected: { colTitle, colGiven, colWhen, colThen, colPriority, colFeature, colType, colRef },
    scenarios: parsed
  });
});

// ══════════════════════════════════════════════════════
// ██  API CAMPAIGN HISTORY (P1.2)
// ══════════════════════════════════════════════════════

/**
 * POST /api/projects/:id/campaigns  — Enregistre une campagne terminée
 * Body: { name, type, started_at, finished_at, total, pass, fail, blocked, skipped, results[] }
 */
app.post("/api/projects/:id/campaigns", (req, res) => {
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
app.get("/api/projects/:id/campaigns", (req, res) => {
  db.all(`
    SELECT id, project_id, name, type, started_at, finished_at,
           total, pass, fail, blocked, skipped,
           CASE WHEN total > 0 THEN ROUND(pass * 100.0 / total, 1) ELSE 0 END as success_rate,
           CASE WHEN total > 0 THEN ROUND((fail + blocked) * 100.0 / total, 1) ELSE 0 END as leak_rate,
           CAST((strftime('%s', finished_at) - strftime('%s', started_at)) AS INTEGER) as duration_sec
    FROM campaigns
    WHERE project_id = ?
    ORDER BY finished_at DESC
  `, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

/**
 * GET /api/campaigns/:id  — Détail d'une campagne avec résultats complets
 */
app.get("/api/campaigns/:id", (req, res) => {
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
app.delete("/api/campaigns/:id", (req, res) => {
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
app.get("/api/projects/:id/coverage-matrix", (req, res) => {
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
app.put("/api/scenarios/:id/reference", (req, res) => {
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


app.get("/api/projects/:id/campaigns/kpis", (req, res) => {
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



// POST /api/messages - Proxy Anthropic
app.post("/api/messages", (req, res) => {
  const apiKey = req.headers["x-api-key"] || ENV_KEY;
  if (!apiKey) {
    return res.status(401).json({ error: "Clé API manquante. Saisissez votre clé dans l'interface ou définissez ANTHROPIC_API_KEY sur le serveur." });
  }

  const body = JSON.stringify(req.body);
  const options = {
    hostname: "api.anthropic.com",
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "x-api-key": apiKey,
      "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
    },
  };

  const proxyReq = https.request(options, proxyRes => {
    res.status(proxyRes.statusCode).set("Content-Type", "application/json");
    proxyRes.pipe(res);
  });

  proxyReq.on("error", err => {
    res.status(502).json({ error: err.message });
  });

  proxyReq.write(body);
  proxyReq.end();
});

// ══════════════════════════════════════════════════════
// ██  STATIC FILES
// ══════════════════════════════════════════════════════

app.use(express.static(__dirname, {
  extensions: ["html"],
  index: "index.html"
}));

// Fallback pour les routes non trouvées
app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "Endpoint non trouvé" });
  }
  res.sendFile(path.join(__dirname, "index.html"));
});

// ══════════════════════════════════════════════════════
// ██  START SERVER
// ══════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log("\x1b[32m");
  console.log("  ✈  TestPilot Server v2.0");
  console.log("  ─────────────────────────────────────────");
  console.log(`  App       → http://localhost:${PORT}`);
  console.log(`  API       → http://localhost:${PORT}/api/`);
  console.log(`  Proxy LLM → http://localhost:${PORT}/api/messages`);
  console.log(`  Database  → ${dbPath}`);
  console.log(`  Clé API   → ${ENV_KEY ? "✓ Variable ANTHROPIC_API_KEY" : "⚠  Transmise par le client"}`);
  console.log("  ─────────────────────────────────────────");
  console.log("  Endpoints disponibles:");
  console.log("    GET    /api/projects");
  console.log("    GET    /api/projects/:id/scenarios");
  console.log("    GET    /api/projects/:id/stats");
  console.log("    POST   /api/projects/:id/scenarios");
  console.log("    ...et plus");
  console.log("  ─────────────────────────────────────────");
  console.log("  Ctrl+C pour arrêter");
  console.log("\x1b[0m");
});

// ── Graceful shutdown ────────────────────────────────
function shutdown(signal) {
  console.log(`\n[${signal}] Arrêt du serveur...`);
  db.close((err) => {
    if (err) console.error("Erreur fermeture DB:", err.message);
    else console.log("Base de données fermée proprement.");
    process.exit(0);
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

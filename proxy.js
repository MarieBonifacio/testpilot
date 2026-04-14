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
const crypto  = require("crypto");

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
  res.header("Access-Control-Allow-Headers", "Content-Type, x-api-key, anthropic-version, Authorization");
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

// ── Auth helpers (définis tôt pour être disponibles partout) ────────────────
function hashPassword(pw) {
  return require("crypto").createHash("sha256").update(pw).digest("hex");
}
function generateToken() {
  return require("crypto").randomBytes(32).toString("hex");
}

/** Middleware optionnel — attache req.currentUser si token valide */
function authMiddleware(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.replace(/^Bearer\s+/, "");
  if (!token) return next();
  const now = new Date().toISOString();
  db.get(
    `SELECT u.* FROM users u
     JOIN auth_sessions s ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?`,
    [token, now],
    (err, user) => {
      if (!err && user) req.currentUser = user;
      next();
    }
  );
}

/** Exige une session valide */
function requireAuth(req, res, next) {
  if (!req.currentUser) return res.status(401).json({ error: "Non authentifié" });
  next();
}

/** Exige rôle cp ou admin */
function requireCP(req, res, next) {
  if (!req.currentUser) return res.status(401).json({ error: "Non authentifié" });
  if (!["cp", "admin"].includes(req.currentUser.role))
    return res.status(403).json({ error: "Rôle CP ou admin requis" });
  next();
}

// Monté ici pour que req.currentUser soit disponible sur TOUTES les routes
app.use(authMiddleware);

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
// ██  API CLICKUP INTEGRATION (P2.1)
// ══════════════════════════════════════════════════════

/**
 * Helper : effectue une requête HTTPS vers api.clickup.com
 */
function clickupRequest(method, path, apiToken, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: "api.clickup.com",
      path: "/api/v2" + path,
      method,
      headers: {
        "Authorization": apiToken,
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(json.err || json.error || `ClickUp ${res.statusCode}`));
          else resolve(json);
        } catch (e) {
          reject(new Error("Réponse ClickUp invalide : " + data.slice(0, 200)));
        }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * GET /api/projects/:id/clickup-config  — Config ClickUp d'un projet
 */
app.get("/api/projects/:id/clickup-config", (req, res) => {
  db.get("SELECT * FROM clickup_configs WHERE project_id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { project_id: parseInt(req.params.id), api_token: null, list_id: null, enabled: 0 });
  });
});

/**
 * PUT /api/projects/:id/clickup-config  — Sauvegarder la config ClickUp
 */
app.put("/api/projects/:id/clickup-config", (req, res) => {
  const { api_token, list_id, enabled, workspace_id, default_priority, tag_prefix } = req.body;
  db.run(`
    INSERT INTO clickup_configs (project_id, api_token, list_id, enabled, workspace_id, default_priority, tag_prefix)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET
      api_token        = excluded.api_token,
      list_id          = excluded.list_id,
      enabled          = excluded.enabled,
      workspace_id     = excluded.workspace_id,
      default_priority = excluded.default_priority,
      tag_prefix       = excluded.tag_prefix,
      updated_at       = CURRENT_TIMESTAMP
  `, [req.params.id, api_token, list_id, enabled ? 1 : 0, workspace_id, default_priority || 2, tag_prefix || "TestPilot"],
  function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ saved: true });
  });
});

/**
 * GET /api/clickup/lists?token=...  — Récupère les listes ClickUp accessibles
 * (utilisé pour le selecteur dans la config)
 */
app.get("/api/clickup/lists", async (req, res) => {
  const token = req.query.token || req.headers["x-clickup-token"];
  if (!token) return res.status(400).json({ error: "Token ClickUp manquant" });
  try {
    const workspaces = await clickupRequest("GET", "/team", token);
    const lists = [];
    for (const team of (workspaces.teams || [])) {
      try {
        const spaces = await clickupRequest("GET", `/team/${team.id}/space?archived=false`, token);
        for (const space of (spaces.spaces || [])) {
          try {
            const folders = await clickupRequest("GET", `/space/${space.id}/folder?archived=false`, token);
            for (const folder of (folders.folders || [])) {
              const fl = await clickupRequest("GET", `/folder/${folder.id}/list?archived=false`, token);
              for (const l of (fl.lists || [])) {
                lists.push({ id: l.id, name: l.name, folder: folder.name, space: space.name, team: team.name });
              }
            }
            // Listes sans dossier
            const noFolder = await clickupRequest("GET", `/space/${space.id}/list?archived=false`, token);
            for (const l of (noFolder.lists || [])) {
              lists.push({ id: l.id, name: l.name, folder: null, space: space.name, team: team.name });
            }
          } catch(e) { /* ignore space error */ }
        }
      } catch(e) { /* ignore team error */ }
    }
    res.json({ lists });
  } catch (e) {
    res.status(502).json({ error: "Erreur ClickUp : " + e.message });
  }
});

/**
 * POST /api/clickup/create-task  — Crée une tâche ClickUp pour un scénario FAIL/BLOQUÉ
 * Body : { api_token, list_id, scenario, campaign_name, status, comment, priority }
 */
app.post("/api/clickup/create-task", async (req, res) => {
  const { api_token, list_id, scenario, campaign_name, status, comment, priority, tag_prefix } = req.body;
  if (!api_token || !list_id || !scenario) {
    return res.status(400).json({ error: "api_token, list_id et scenario sont requis" });
  }

  const statusEmoji = status === "fail" ? "🔴" : "🟣";
  const statusLabel = status === "fail" ? "FAIL" : "BLOQUÉ";
  const prefix      = tag_prefix || "TestPilot";

  // Priorité ClickUp : 1=urgent, 2=high, 3=normal, 4=low
  const pMap = { high: 2, medium: 3, low: 4 };
  const clickupPriority = pMap[scenario.priority] || priority || 3;

  const taskName = `[${prefix}] [${statusLabel}] ${scenario.title}`;

  const description = [
    `**Campagne :** ${campaign_name || "Non renseignée"}`,
    `**Statut :** ${statusEmoji} ${statusLabel}`,
    `**Scénario :** ${scenario.id || scenario.scenario_id || "—"}`,
    `**Feature :** ${scenario.feature || scenario.feature_name || "—"}`,
    `**Référence :** ${scenario.source_reference || "—"}`,
    "",
    "---",
    "### Given",
    scenario.given || scenario.given_text || "—",
    "### When",
    scenario.when  || scenario.when_text  || "—",
    "### Then",
    scenario.then  || scenario.then_text  || "—",
    "",
    ...(comment ? ["---", "### Commentaire testeur", comment] : []),
    "",
    "---",
    `*Créé automatiquement par TestPilot*`
  ].join("\n");

  try {
    const task = await clickupRequest("POST", `/list/${list_id}/task`, api_token, {
      name:     taskName,
      markdown_description: description,
      priority: clickupPriority,
      tags:     [prefix.toLowerCase(), statusLabel.toLowerCase(), scenario.priority || "medium"]
    });
    res.json({ task_id: task.id, task_url: task.url, task_name: task.name });
  } catch (e) {
    res.status(502).json({ error: "Erreur création tâche ClickUp : " + e.message });
  }
});

/**
 * POST /api/clickup/create-batch  — Crée plusieurs tâches ClickUp en lot
 * Body : { api_token, list_id, campaign_name, tag_prefix, items: [{ scenario, status, comment }] }
 */
app.post("/api/clickup/create-batch", async (req, res) => {
  const { api_token, list_id, campaign_name, tag_prefix, items } = req.body;
  if (!api_token || !list_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "api_token, list_id et items[] sont requis" });
  }

  const results = [];
  for (const item of items) {
    try {
      const pMap = { high: 2, medium: 3, low: 4 };
      const prefix = tag_prefix || "TestPilot";
      const statusLabel = item.status === "fail" ? "FAIL" : "BLOQUÉ";
      const statusEmoji = item.status === "fail" ? "🔴" : "🟣";
      const sc = item.scenario;

      const taskName = `[${prefix}] [${statusLabel}] ${sc.title}`;
      const description = [
        `**Campagne :** ${campaign_name || "—"}`,
        `**Statut :** ${statusEmoji} ${statusLabel}`,
        `**Scénario :** ${sc.id || "—"}`,
        `**Feature :** ${sc.feature || "—"}`,
        `**Référence :** ${sc.source_reference || "—"}`,
        "",
        "---",
        "### Given", sc.given || "—",
        "### When",  sc.when  || "—",
        "### Then",  sc.then  || "—",
        ...(item.comment ? ["", "---", "### Commentaire testeur", item.comment] : []),
        "", "---",
        `*Créé automatiquement par TestPilot*`
      ].join("\n");

      const task = await clickupRequest("POST", `/list/${list_id}/task`, api_token, {
        name:     taskName,
        markdown_description: description,
        priority: pMap[sc.priority] || 3,
        tags:     [prefix.toLowerCase(), statusLabel.toLowerCase(), sc.priority || "medium"]
      });
      results.push({ ok: true, scenario_id: sc.id, task_id: task.id, task_url: task.url });
    } catch (e) {
      results.push({ ok: false, scenario_id: item.scenario?.id, error: e.message });
    }
    // Petite pause pour ne pas dépasser le rate limit ClickUp
    if (items.length > 1) await new Promise(r => setTimeout(r, 300));
  }

  const ok    = results.filter(r => r.ok).length;
  const errors = results.filter(r => !r.ok).length;
  res.json({ created: ok, errors, results });
});

// ══════════════════════════════════════════════════════
// ██  API COMEP REPORT (P2.2)
// ══════════════════════════════════════════════════════

/**
 * GET /api/projects/:id/comep-report
 * Génère le rapport COMEP complet :
 *  - Score de confiance (0-100)
 *  - Couverture des exigences
 *  - Risques résiduels (scénarios high priority non passés)
 *  - Synthèse des campagnes
 */
app.get("/api/projects/:id/comep-report", (req, res) => {
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
       FROM scenario_analyses WHERE project_id = ? ORDER BY created_at DESC LIMIT 1`, [projectId])
  ]).then(([project, scenarios, campaigns, analyses]) => {
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
      } : null
    });
  }).catch(err => res.status(500).json({ error: err.message }));
});

// ══════════════════════════════════════════════════════
// ██  P3 — AUTH / USERS / WORKFLOW / NOTIFICATIONS
// ══════════════════════════════════════════════════════

// ── POST /api/auth/register ───────────────────────────
// Premier lancement : si aucun user en BDD, création libre (bootstrap admin)
// Ensuite : accessible uniquement aux admins connectés
app.post("/api/auth/register", (req, res) => {
  const { username, password, display_name, role, email } = req.body;
  if (!username || !password || !display_name) {
    return res.status(400).json({ error: "username, password et display_name requis" });
  }
  db.get("SELECT COUNT(*) AS cnt FROM users", [], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    const isFirstUser = (row.cnt === 0);
    // Si déjà des utilisateurs en BDD → exiger admin
    if (!isFirstUser && (!req.currentUser || req.currentUser.role !== "admin")) {
      return res.status(403).json({ error: "Seul un administrateur peut créer des comptes" });
    }
    const allowedRoles = ["automaticien", "cp", "key_user", "admin"];
    const userRole = allowedRoles.includes(role) ? role : "automaticien";
    const hash = hashPassword(password);
    db.run(
      "INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)",
      [username, hash, display_name, userRole, email || null],
      function(insertErr) {
        if (insertErr) {
          if (insertErr.message.includes("UNIQUE")) return res.status(409).json({ error: "Nom d'utilisateur déjà pris" });
          return res.status(500).json({ error: insertErr.message });
        }
        res.status(201).json({ id: this.lastID, username, display_name, role: userRole, email: email || null });
      }
    );
  });
});

// ── POST /api/auth/login ──────────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "username et password requis" });
  const hash = hashPassword(password);
  db.get("SELECT * FROM users WHERE username = ? AND password_hash = ?", [username, hash], (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(401).json({ error: "Identifiants incorrects" });
    const token = generateToken();
    const expires = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(); // 7 jours
    db.run(
      "INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (?, ?, ?)",
      [user.id, token, expires],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        const { password_hash: _, ...safeUser } = user;
        res.json({ token, user: safeUser });
      }
    );
  });
});

// ── POST /api/auth/logout ─────────────────────────────
app.post("/api/auth/logout", requireAuth, (req, res) => {
  const header = req.headers["authorization"] || "";
  const token  = header.replace(/^Bearer\s+/, "");
  db.run("DELETE FROM auth_sessions WHERE token = ?", [token], () => res.json({ ok: true }));
});

// ── GET /api/auth/me ──────────────────────────────────
app.get("/api/auth/me", requireAuth, (req, res) => {
  const { password_hash: _, ...safeUser } = req.currentUser;
  res.json(safeUser);
});

// ── GET /api/users ────────────────────────────────────
app.get("/api/users", requireAuth, (req, res) => {
  db.all("SELECT id, username, display_name, role, email, created_at FROM users ORDER BY display_name", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ── GET /api/users/:id ────────────────────────────────
app.get("/api/users/:id", requireAuth, (req, res) => {
  db.get("SELECT id, username, display_name, role, email, created_at FROM users WHERE id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json(row);
  });
});

// ── PUT /api/users/:id ────────────────────────────────
app.put("/api/users/:id", requireAuth, (req, res) => {
  const { display_name, role, email, password } = req.body;
  // Seul l'admin ou l'utilisateur lui-même peut modifier
  const isSelf  = req.currentUser.id === parseInt(req.params.id);
  const isAdmin = req.currentUser.role === "admin";
  if (!isSelf && !isAdmin) return res.status(403).json({ error: "Accès refusé" });

  let sql, params;
  if (password) {
    const hash = hashPassword(password);
    sql = "UPDATE users SET display_name=?, role=?, email=?, password_hash=?, updated_at=CURRENT_TIMESTAMP WHERE id=?";
    params = [display_name, role, email || null, hash, req.params.id];
  } else {
    sql = "UPDATE users SET display_name=?, role=?, email=?, updated_at=CURRENT_TIMESTAMP WHERE id=?";
    params = [display_name, role, email || null, req.params.id];
  }
  db.run(sql, params, function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json({ id: parseInt(req.params.id), display_name, role, email });
  });
});

// ── DELETE /api/users/:id ─────────────────────────────
app.delete("/api/users/:id", requireAuth, (req, res) => {
  if (req.currentUser.role !== "admin") return res.status(403).json({ error: "Rôle admin requis" });
  db.run("DELETE FROM users WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
    res.json({ deleted: true });
  });
});

// ── P3.2 : Workflow validation scénarios ─────────────

// PATCH /api/scenarios/:id/submit — soumettre pour validation
app.patch("/api/scenarios/:id/submit", requireAuth, (req, res) => {
  db.get("SELECT * FROM scenarios WHERE id = ?", [req.params.id], (err, sc) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sc) return res.status(404).json({ error: "Scénario non trouvé" });
    db.run(
      "UPDATE scenarios SET validation_status='submitted', updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [req.params.id],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        // Notifier les CPs et admins
        db.all("SELECT id FROM users WHERE role IN ('cp','admin')", [], (err3, cps) => {
          if (!err3 && cps.length > 0) {
            const msg = `Scénario "${sc.title}" soumis pour validation par ${req.currentUser.display_name}`;
            const stmt = db.prepare("INSERT INTO notifications (user_id, type, message, scenario_id) VALUES (?, 'submitted', ?, ?)");
            cps.forEach(cp => stmt.run([cp.id, msg, sc.id]));
            stmt.finalize();
          }
        });
        res.json({ id: parseInt(req.params.id), validation_status: "submitted" });
      }
    );
  });
});

// PATCH /api/scenarios/:id/validate — valider (CP/admin)
app.patch("/api/scenarios/:id/validate", requireCP, (req, res) => {
  db.get("SELECT * FROM scenarios WHERE id = ?", [req.params.id], (err, sc) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sc) return res.status(404).json({ error: "Scénario non trouvé" });
    db.run(
      "UPDATE scenarios SET validation_status='validated', accepted=1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [req.params.id],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        // Notifier l'assigné ou le créateur (assigned_to)
        if (sc.assigned_to) {
          const msg = `Votre scénario "${sc.title}" a été validé par ${req.currentUser.display_name}`;
          db.run("INSERT INTO notifications (user_id, type, message, scenario_id) VALUES (?, 'validated', ?, ?)",
            [sc.assigned_to, msg, sc.id]);
        }
        res.json({ id: parseInt(req.params.id), validation_status: "validated" });
      }
    );
  });
});

// PATCH /api/scenarios/:id/reject — rejeter (CP/admin)
app.patch("/api/scenarios/:id/reject", requireCP, (req, res) => {
  const { reason } = req.body || {};
  db.get("SELECT * FROM scenarios WHERE id = ?", [req.params.id], (err, sc) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sc) return res.status(404).json({ error: "Scénario non trouvé" });
    db.run(
      "UPDATE scenarios SET validation_status='rejected', rejection_reason=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [reason || null, req.params.id],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (sc.assigned_to) {
          const msg = `Votre scénario "${sc.title}" a été rejeté${reason ? " : " + reason : ""}`;
          db.run("INSERT INTO notifications (user_id, type, message, scenario_id) VALUES (?, 'rejected', ?, ?)",
            [sc.assigned_to, msg, sc.id]);
        }
        res.json({ id: parseInt(req.params.id), validation_status: "rejected", rejection_reason: reason });
      }
    );
  });
});

// ── P3.3 : Assignation scénarios ─────────────────────

// PATCH /api/scenarios/:id/assign
app.patch("/api/scenarios/:id/assign", requireCP, (req, res) => {
  const { user_id } = req.body || {};
  db.get("SELECT * FROM scenarios WHERE id = ?", [req.params.id], (err, sc) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!sc) return res.status(404).json({ error: "Scénario non trouvé" });
    db.run(
      "UPDATE scenarios SET assigned_to=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      [user_id || null, req.params.id],
      (err2) => {
        if (err2) return res.status(500).json({ error: err2.message });
        if (user_id) {
          const msg = `Le scénario "${sc.title}" vous a été assigné par ${req.currentUser.display_name}`;
          db.run("INSERT INTO notifications (user_id, type, message, scenario_id) VALUES (?, 'assigned', ?, ?)",
            [user_id, msg, sc.id]);
        }
        res.json({ id: parseInt(req.params.id), assigned_to: user_id || null });
      }
    );
  });
});

// ── P3.3 : Notifications ─────────────────────────────

// GET /api/notifications
app.get("/api/notifications", requireAuth, (req, res) => {
  db.all(
    "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
    [req.currentUser.id],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// PATCH /api/notifications/:id/read
app.patch("/api/notifications/:id/read", requireAuth, (req, res) => {
  db.run(
    "UPDATE notifications SET read=1 WHERE id=? AND user_id=?",
    [req.params.id, req.currentUser.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    }
  );
});

// POST /api/notifications/read-all
app.post("/api/notifications/read-all", requireAuth, (req, res) => {
  db.run(
    "UPDATE notifications SET read=1 WHERE user_id=?",
    [req.currentUser.id],
    (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ ok: true });
    }
  );
});

// ══════════════════════════════════════════════════════
// ██  STATIC FILES
// ══════════════════════════════════════════════════════

// Fichiers statiques React (build Vite)
const reactDist = path.join(__dirname, "src-react", "dist");
if (fs.existsSync(reactDist)) {
  app.use(express.static(reactDist));
}

// Pages HTML vanilla (ancienne interface) — uniquement les .html et assets CSS/JS explicites
app.use(express.static(__dirname, {
  extensions: ["html"],
  index: false, // pas d'index auto depuis la racine
  setHeaders: (res, filePath) => {
    // Bloquer l'accès aux fichiers sensibles
    const blocked = [".js", ".db", ".json", ".sql", ".env"];
    const ext = path.extname(filePath).toLowerCase();
    if (blocked.includes(ext) && !filePath.endsWith(".html")) {
      res.setHeader("Content-Type", "text/plain");
    }
  },
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

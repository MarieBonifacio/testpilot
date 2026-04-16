/**
 * TestPilot — Server API + Proxy LLM
 * ===================================
 * Lance avec : node proxy.js
 * Optionnel  : PORT=8080 node proxy.js
 *
 * Fonctionnalités :
 *   - API REST pour projets, scénarios, sessions de tests
 *   - Proxy vers les APIs LLM (Anthropic, OpenAI, Mistral)
 *   - Proxy local vers Ollama (HTTP, sans dépendance externe)
 *       GET  /api/ollama/health  — santé du serveur Ollama
 *       GET  /api/ollama/models  — liste des modèles installés
 *       POST /api/ollama/chat    — génération (format OpenAI-compatible)
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

// ── API token helpers (CI/CD) ────────────────────────────────────────────────
function hashApiToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function generateApiToken() {
  return "tpt_" + crypto.randomBytes(32).toString("base64url");
}

/** Middleware optionnel — attache req.currentUser si token valide */
function authMiddleware(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.replace(/^Bearer\s+/, "");
  if (!token) return next();

  // ── Token API CI/CD (préfixe tpt_) ──────────────────────────────────────
  if (token.startsWith("tpt_")) {
    const tokenHash   = hashApiToken(token);
    const tokenPrefix = token.slice(0, 12); // "tpt_" + 8 chars
    const now = new Date().toISOString();
    db.get(
      `SELECT t.*, u.id as uid, u.role as urole, u.username, u.display_name
       FROM api_tokens t
       JOIN users u ON t.user_id = u.id
       WHERE t.token_hash = ? AND t.token_prefix = ?`,
      [tokenHash, tokenPrefix],
      (err, apiToken) => {
        if (err || !apiToken) return next(); // laisse requireAuth rejeter
        if (apiToken.expires_at && apiToken.expires_at < now) return next();
        // Mise à jour last_used_at (fire-and-forget)
        db.run("UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?", [apiToken.id]);
        req.currentUser = {
          id: apiToken.uid,
          role: apiToken.urole,
          username: apiToken.username,
          display_name: apiToken.display_name,
        };
        req.apiToken = apiToken;
        req.isApiAuth = true;
        next();
      }
    );
    return;
  }

  // ── Token de session utilisateur ─────────────────────────────────────────
  const nowStr = new Date().toISOString();
  db.get(
    `SELECT u.* FROM users u
     JOIN auth_sessions s ON s.user_id = u.id
     WHERE s.token = ? AND s.expires_at > ?`,
    [token, nowStr],
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
// On passe par module.exports pour permettre jest.spyOn en tests
app.use((req, res, next) => module.exports.authMiddleware(req, res, next));

// ══════════════════════════════════════════════════════
// ██  API PROJECTS
// ══════════════════════════════════════════════════════

// GET /api/projects - Liste tous les projets
app.get("/api/projects", requireAuth, (req, res) => {
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

// GET /api/campaigns/:id/export-rapport — exporter le rapport d'une campagne archivée
app.get('/api/campaigns/:id/export-rapport', requireAuth, async (req, res) => {
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
      if (typeof docGenerator !== 'undefined' && docGenerator.generateRapportCampagne) {
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

// ══════════════════════════════════════════════════════
// ██  API PROJECT CONTEXT
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/context - Récupérer le contexte d'un projet
app.get("/api/projects/:id/context", requireAuth, (req, res) => {
  db.get("SELECT * FROM project_contexts WHERE project_id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { project_id: parseInt(req.params.id), adjacent_features: "", global_constraints: "" });
  });
});

// PUT /api/projects/:id/context - Mettre à jour le contexte
app.put("/api/projects/:id/context", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/scenarios", requireAuth, (req, res) => {
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
app.post("/api/projects/:id/scenarios", requireAuth, (req, res) => {
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
app.put("/api/scenarios/:id", requireAuth, (req, res) => {
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
app.patch("/api/scenarios/:id/accept", requireAuth, (req, res) => {
  db.run("UPDATE scenarios SET accepted = NOT accepted, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
    res.json({ toggled: true });
  });
});

// PATCH /api/scenarios/:id/tnr - Marquer/démarquer comme TNR
app.patch("/api/scenarios/:id/tnr", requireAuth, (req, res) => {
  db.run("UPDATE scenarios SET is_tnr = NOT is_tnr, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
    res.json({ toggled: true });
  });
});

// DELETE /api/scenarios/:id - Supprimer un scénario
app.delete("/api/scenarios/:id", requireAuth, (req, res) => {
  db.run("DELETE FROM scenarios WHERE id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Scénario non trouvé" });
    res.json({ deleted: true });
  });
});

// DELETE /api/projects/:id/scenarios - Supprimer tous les scénarios d'un projet
app.delete("/api/projects/:id/scenarios", requireAuth, (req, res) => {
  db.run("DELETE FROM scenarios WHERE project_id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});

// POST /api/projects/:id/scenarios/accept-all - Accepter tous les scénarios
app.post("/api/projects/:id/scenarios/accept-all", requireAuth, (req, res) => {
  db.run("UPDATE scenarios SET accepted = 1, updated_at = CURRENT_TIMESTAMP WHERE project_id = ?", [req.params.id], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ accepted: this.changes });
  });
});

// ══════════════════════════════════════════════════════
// ██  API ANALYSES
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/analysis - Récupérer la dernière analyse
app.get("/api/projects/:id/analysis", requireAuth, (req, res) => {
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
app.post("/api/projects/:id/analysis", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/sessions", requireAuth, (req, res) => {
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
app.post("/api/projects/:id/sessions", requireAuth, (req, res) => {
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
app.get("/api/sessions/:id", requireAuth, (req, res) => {
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

// PUT /api/sessions/:id/finish - Terminer une session + calculer durée + déclencher flakiness
app.put("/api/sessions/:id/finish", requireAuth, (req, res) => {
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
        // Déclencher la détection flakiness en arrière-plan (non bloquant)
        detectFlakinessForSession(sessionId).catch(e =>
          console.warn("[flakiness] Erreur détection:", e.message)
        );
        res.json({ finished: true, duration_seconds: durationSeconds });
      }
    );
  });
});

// POST /api/sessions/:id/results - Enregistrer un résultat de test
app.post("/api/sessions/:id/results", requireAuth, (req, res) => {
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

// ══════════════════════════════════════════════════════
// ██  API STATS / DASHBOARD
// ══════════════════════════════════════════════════════

// GET /api/projects/:id/stats - Statistiques d'un projet
app.get("/api/projects/:id/stats", requireAuth, (req, res) => {
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
app.post("/api/projects/:id/import-excel", requireAuth, (req, res) => {
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
app.post("/api/projects/:id/campaigns", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/campaigns", requireAuth, (req, res) => {
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
app.get("/api/campaigns/:id", requireAuth, (req, res) => {
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
app.delete("/api/campaigns/:id", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/coverage-matrix", requireAuth, (req, res) => {
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
app.put("/api/scenarios/:id/reference", requireAuth, (req, res) => {
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


app.get("/api/projects/:id/campaigns/kpis", requireAuth, (req, res) => {
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



// ══════════════════════════════════════════════════════
// ██  API OLLAMA (proxy local HTTP)
// ══════════════════════════════════════════════════════

/**
 * Valide que le host Ollama est une URL HTTP(S) acceptable.
 * Rejette les schémas non-HTTP (file://, ftp://, etc.) et les IPs
 * internes sensibles qui ne sont pas localhost.
 * @param {string} host
 * @returns {string} host nettoyé
 * @throws {Error} si le host est invalide
 */
function validateOllamaHost(host) {
  let parsed;
  try {
    parsed = new URL(host);
  } catch {
    throw new Error(`Hôte Ollama invalide : "${host}" n'est pas une URL valide`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Protocole non autorisé : seuls http:// et https:// sont acceptés`);
  }
  // Bloquer les ressources cloud internes (AWS IMDSv1/v2, GCP, Azure)
  const blockedHosts = ["169.254.169.254", "metadata.google.internal", "169.254.170.2"];
  if (blockedHosts.includes(parsed.hostname)) {
    throw new Error(`Hôte refusé pour des raisons de sécurité`);
  }
  return host.replace(/\/$/, "");
}

/**
 * Helper : effectue une requête HTTP (non HTTPS) vers un serveur Ollama local.
 * Ollama tourne en HTTP simple — on ne peut pas utiliser le module `https`.
 * @param {string} method    - GET | POST
 * @param {string} host      - ex : "http://localhost:11434"
 * @param {string} urlPath   - ex : "/api/tags"
 * @param {object|null} body
 * @param {number} timeoutMs
 */
function ollamaRequest(method, host, urlPath, body = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const http  = require("http");
    const urlObj = new URL(host.replace(/\/$/, "") + urlPath);
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || 11434,
      path:     urlPath,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout après ${timeoutMs}ms — Ollama inaccessible sur ${host}`));
    });

    req.on("error", (err) => {
      reject(new Error(`Impossible de joindre Ollama sur ${host} : ${err.message}`));
    });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

/**
 * GET /api/ollama/health?host=http://localhost:11434
 * Vérifie qu'Ollama répond. Retourne { ok: true } ou { ok: false, error: "..." }
 */
app.get("/api/ollama/health", requireAuth, async (req, res) => {
  let host;
  try {
    host = validateOllamaHost(req.query.host || "http://localhost:11434");
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  try {
    const { status } = await module.exports.ollamaRequest("GET", host, "/api/version", null, 5000);
    if (status === 200) {
      res.json({ ok: true });
    } else {
      res.status(502).json({ ok: false, error: `Ollama a répondu HTTP ${status}` });
    }
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/ollama/models?host=http://localhost:11434
 * Retourne la liste des modèles installés sur Ollama.
 * Réponse : { models: ["llama3.2", "mistral:latest", ...] }
 */
app.get("/api/ollama/models", requireAuth, async (req, res) => {
  let host;
  try {
    host = validateOllamaHost(req.query.host || "http://localhost:11434");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    const { status, body } = await module.exports.ollamaRequest("GET", host, "/api/tags", null, 5000);
    if (status !== 200) {
      return res.status(502).json({ error: `Ollama HTTP ${status}` });
    }
    const models = (body.models || []).map(m => m.name);
    res.json({ models });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

/**
 * POST /api/ollama/chat
 * Proxy les requêtes de génération vers Ollama (format OpenAI-compatible).
 * Body attendu : { model, messages, host?, temperature? }
 * Retourne la réponse Ollama telle quelle (format /v1/chat/completions).
 */
app.post("/api/ollama/chat", requireAuth, async (req, res) => {
  const { host, model, messages, temperature } = req.body;

  let ollamaHost;
  try {
    ollamaHost = validateOllamaHost(host || "http://localhost:11434");
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (!model)    return res.status(400).json({ error: "Le champ 'model' est requis" });
  if (!messages) return res.status(400).json({ error: "Le champ 'messages' est requis" });

  const payload = {
    model,
    messages,
    temperature: temperature !== undefined ? temperature : 0.2,
    stream: false
  };

  try {
    const { status, body } = await module.exports.ollamaRequest("POST", ollamaHost, "/v1/chat/completions", payload, 120000);
    if (status !== 200) {
      const errMsg = typeof body === "object" ? (body.error || JSON.stringify(body)) : body;
      return res.status(502).json({ error: `Ollama ${status} : ${errMsg}` });
    }
    res.json(body);
  } catch (err) {
    res.status(502).json({
      error: err.message,
      hint: "Vérifiez qu'Ollama est démarré (`ollama serve`) et que le modèle est installé (`ollama pull <modèle>`)."
    });
  }
});

// POST /api/messages - Proxy Anthropic
app.post("/api/messages", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/clickup-config", requireAuth, (req, res) => {
  db.get("SELECT * FROM clickup_configs WHERE project_id = ?", [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { project_id: parseInt(req.params.id), api_token: null, list_id: null, enabled: 0 });
  });
});

/**
 * PUT /api/projects/:id/clickup-config  — Sauvegarder la config ClickUp
 */
app.put("/api/projects/:id/clickup-config", requireAuth, (req, res) => {
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
app.get("/api/clickup/lists", requireAuth, async (req, res) => {
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
app.post("/api/clickup/create-task", requireAuth, async (req, res) => {
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
app.post("/api/clickup/create-batch", requireAuth, async (req, res) => {
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
// ██  API KPIs P4.2 — Durée TNR + Flakiness
// ══════════════════════════════════════════════════════

// ── Helpers DB promisifiés (locaux) ──────────────────
const dbRunP  = (sql, p=[]) => new Promise((res,rej) => db.run(sql,p,function(e){e?rej(e):res(this)}));
const dbGetP  = (sql, p=[]) => new Promise((res,rej) => db.get(sql,p,(e,r)=>e?rej(e):res(r)));
const dbAllP  = (sql, p=[]) => new Promise((res,rej) => db.all(sql,p,(e,r)=>e?rej(e):res(r)));

// ── Fonction de détection flakiness ──────────────────
/**
 * Après clôture d'une session, compare le statut de chaque résultat
 * avec le dernier statut connu pour ce scénario.
 * Si changement ET intervalle < 24h → marqué flaky.
 */
async function detectFlakinessForSession(sessionId) {
  const results = await dbAllP(
    `SELECT tr.scenario_id, tr.status, s.finished_at AS session_finished
     FROM test_results tr
     JOIN test_sessions s ON s.id = tr.session_id
     WHERE tr.session_id = ?`,
    [sessionId]
  );
  if (!results.length) return;

  for (const r of results) {
    // Dernier résultat connu pour ce scénario dans une session antérieure
    const prev = await dbGetP(
      `SELECT tr.status, s.finished_at
       FROM test_results tr
       JOIN test_sessions s ON s.id = tr.session_id
       WHERE tr.scenario_id = ? AND tr.session_id < ?
       ORDER BY s.finished_at DESC
       LIMIT 1`,
      [r.scenario_id, sessionId]
    );
    if (!prev) {
      // Première exécution — initialiser stats
      await dbRunP(
        `INSERT INTO scenario_flakiness_stats (scenario_id, total_executions, flaky_changes, flakiness_rate, last_status, last_calculated)
         VALUES (?, 1, 0, 0.0, ?, datetime('now'))
         ON CONFLICT(scenario_id) DO UPDATE SET
           total_executions = total_executions + 1,
           last_status = excluded.last_status,
           last_calculated = datetime('now')`,
        [r.scenario_id, r.status]
      );
      continue;
    }

    const hasChanged = prev.status !== r.status;
    let isFlakyChange = 0;
    if (hasChanged && prev.finished_at) {
      const diffMs = new Date(r.session_finished || Date.now()) - new Date(prev.finished_at);
      const diffHours = diffMs / (1000 * 60 * 60);
      isFlakyChange = diffHours < 24 ? 1 : 0;
    }

    // Enregistrer le changement
    if (hasChanged) {
      await dbRunP(
        `INSERT INTO scenario_status_changes (scenario_id, session_id, previous_status, new_status, is_flaky_change)
         VALUES (?, ?, ?, ?, ?)`,
        [r.scenario_id, sessionId, prev.status, r.status, isFlakyChange]
      );
    }

    // Mettre à jour les stats agrégées
    await dbRunP(
      `INSERT INTO scenario_flakiness_stats (scenario_id, total_executions, flaky_changes, flakiness_rate, last_status, last_calculated)
       VALUES (?, 1, ?, ?, ?, datetime('now'))
       ON CONFLICT(scenario_id) DO UPDATE SET
         total_executions = total_executions + 1,
         flaky_changes    = flaky_changes + excluded.flaky_changes,
         flakiness_rate   = CASE WHEN (total_executions + 1) > 0
                              THEN ROUND((flaky_changes + excluded.flaky_changes) * 100.0 / (total_executions + 1), 1)
                              ELSE 0 END,
         last_status      = excluded.last_status,
         last_calculated  = datetime('now')`,
      [r.scenario_id, isFlakyChange, isFlakyChange > 0 ? 100 : 0, r.status]
    );
  }
}

/**
 * PATCH /api/sessions/:id/is-tnr
 * Marque/démarque une session comme TNR
 */
app.patch("/api/sessions/:id/is-tnr", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/kpis/tnr-duration", requireAuth, async (req, res) => {
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
app.post("/api/projects/:id/settings/tnr-target", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/kpis/flakiness", requireAuth, async (req, res) => {
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
app.get("/api/scenarios/:id/flakiness-history", requireAuth, async (req, res) => {
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

// ══════════════════════════════════════════════════════
// ██  API PRODUCTION BUGS (P4.1 — Taux de fuite)
// ══════════════════════════════════════════════════════

/**
 * GET /api/projects/:id/production-bugs
 * Query: ?page=1&limit=20&severity=critical&has_scenario=true|false
 */
app.get("/api/projects/:id/production-bugs", requireAuth, (req, res) => {
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
app.post("/api/projects/:id/production-bugs", requireAuth, (req, res) => {
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
app.put("/api/production-bugs/:id", requireAuth, (req, res) => {
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
app.delete("/api/production-bugs/:id", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/kpis/leak-rate", requireAuth, (req, res) => {
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
app.get("/api/projects/:id/comep-report", requireAuth, (req, res) => {
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

  // Un non-admin ne peut pas s'auto-promouvoir (changer son propre rôle)
  const ALLOWED_ROLES = ["automaticien", "cp", "key_user", "admin"];
  const targetRole = role || req.currentUser.role;
  if (!isAdmin && role && role !== req.currentUser.role) {
    return res.status(403).json({ error: "Modification de rôle réservée aux administrateurs" });
  }
  if (role && !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ error: `Rôle invalide. Valeurs acceptées : ${ALLOWED_ROLES.join(", ")}` });
  }

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

// ══════════════════════════════════════════════════════
// ██  P5.1 — API TOKENS (CI/CD)
// ══════════════════════════════════════════════════════

// GET /api/user/api-tokens — liste les tokens de l'utilisateur courant
app.get("/api/user/api-tokens", requireAuth, (req, res) => {
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

// POST /api/user/api-tokens — créer un token
app.post("/api/user/api-tokens", requireAuth, (req, res) => {
  const { name, scopes = ["trigger"], project_ids = null, expires_in_days = null } = req.body;
  if (!name) return res.status(400).json({ error: "name est requis" });

  const token       = generateApiToken();
  const tokenHash   = hashApiToken(token);
  const tokenPrefix = token.slice(0, 12); // "tpt_" + 8 chars
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
        token,           // ⚠ affiché une seule fois
        token_prefix: tokenPrefix,
        scopes,
        project_ids,
        expires_at:   expiresAt,
        message:      "Sauvegardez ce token maintenant. Il ne sera plus jamais affiché.",
      });
    }
  );
});

// DELETE /api/user/api-tokens/:id — supprimer un token
app.delete("/api/user/api-tokens/:id", requireAuth, (req, res) => {
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

// ══════════════════════════════════════════════════════
// ██  P5.1 — CI/CD TRIGGER
// ══════════════════════════════════════════════════════

// POST /api/trigger — déclencher une campagne depuis un pipeline
app.post("/api/trigger", requireAuth, (req, res) => {
  const {
    project,
    filter       = "all",
    mode         = "full",
    scenario_ids,
    commit_sha,
    branch,
    pipeline_url,
  } = req.body;

  // Vérification scope si auth par token API
  if (req.isApiAuth) {
    let scopes = [];
    try { scopes = JSON.parse(req.apiToken.scopes || "[]"); } catch {}
    if (!scopes.includes("trigger")) {
      return res.status(403).json({ error: "Le token n'a pas le scope 'trigger'" });
    }
  }

  if (!project) return res.status(400).json({ error: "project est requis" });

  // Résolution du projet (id numérique OU nom)
  const projectParam = isNaN(Number(project)) ? null : Number(project);
  db.get(
    `SELECT id, name FROM projects WHERE id = ? OR LOWER(name) = LOWER(?)`,
    [projectParam, String(project)],
    (err, projectRow) => {
      if (err)          return res.status(500).json({ error: err.message });
      if (!projectRow)  return res.status(404).json({ error: `Projet non trouvé : ${project}` });

      // Vérification accès projet si token limité
      if (req.isApiAuth && req.apiToken.project_ids) {
        let allowed = [];
        try { allowed = JSON.parse(req.apiToken.project_ids); } catch {}
        if (!allowed.includes(projectRow.id)) {
          return res.status(403).json({ error: "Le token n'a pas accès à ce projet" });
        }
      }

      // Construction de la requête de filtrage des scénarios
      let scenarioQuery = `SELECT id FROM scenarios WHERE project_id = ? AND accepted = 1`;
      const qp = [projectRow.id];

      if (Array.isArray(scenario_ids) && scenario_ids.length > 0) {
        scenarioQuery += ` AND id IN (${scenario_ids.map(() => "?").join(",")})`;
        qp.push(...scenario_ids);
      } else {
        if (filter === "tnr")      scenarioQuery += ` AND is_tnr = 1`;
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

            // Insérer les résultats initiaux avec statut PENDING
            let inserted = 0;
            const onInserted = () => {
              inserted++;
              if (inserted < scenarios.length) return;

              // Traçabilité triggered_executions
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

// GET /api/sessions/:id/status — statut pour polling CI
app.get("/api/sessions/:id/status", requireAuth, (req, res) => {
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

// GET /api/sessions/:id/junit — export JUnit XML
app.get("/api/sessions/:id/junit", requireAuth, (req, res) => {
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

          const passed  = results.filter(r => r.status === "PASS").length;
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

// POST /api/sessions/:id/bulk-results — soumettre des résultats en masse (exécution automatisée)
app.post("/api/sessions/:id/bulk-results", requireAuth, (req, res) => {
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

        // Vérifier si tous les résultats sont traités (plus de PENDING)
        db.get(
          `SELECT COUNT(*) as cnt FROM test_results WHERE session_id = ? AND status = 'PENDING'`,
          [sid],
          (err, row) => {
            const remaining = row ? row.cnt : 0;
            if (remaining === 0) {
              // Clôturer la session automatiquement
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

// GET /api/trigger/history — historique des déclenchements CI/CD (admin/cp)
app.get("/api/trigger/history", requireAuth, (req, res) => {
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
// ██  P6 — EXPORT DOCUMENTAIRE
// ══════════════════════════════════════════════════════
const docGenerator = require('./exports/doc-generator');

// GET /api/projects/:id/export/cahier-recette
app.get('/api/projects/:id/export/cahier-recette', requireAuth, async (req, res) => {
  try {
    const buffer = await docGenerator.generateCahierRecette(req.params.id, db);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="cahier-recette-${req.params.id}.docx"`
    });
    res.send(buffer);
  } catch (error) {
    console.error('Export cahier-recette error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:id/export/plan-test
app.get('/api/projects/:id/export/plan-test', requireAuth, async (req, res) => {
  try {
    const buffer = await docGenerator.generatePlanTest(req.params.id, db);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="plan-test-${req.params.id}.docx"`
    });
    res.send(buffer);
  } catch (error) {
    console.error('Export plan-test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/sessions/:id/export/rapport
app.get('/api/sessions/:id/export/rapport', requireAuth, async (req, res) => {
  try {
    const buffer = await docGenerator.generateRapportCampagne(req.params.id, db);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="rapport-campagne-${req.params.id}.docx"`
    });
    res.send(buffer);
  } catch (error) {
    console.error('Export rapport-campagne error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/projects/:id/doc-config
app.get('/api/projects/:id/doc-config', requireAuth, async (req, res) => {
  db.get('SELECT * FROM project_doc_config WHERE project_id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { project_id: parseInt(req.params.id), filiale: 'cmt-groupe' });
  });
});

// PUT /api/projects/:id/doc-config
app.put('/api/projects/:id/doc-config', requireAuth, async (req, res) => {
  const { filiale, company_name, company_address, company_postal_code, company_city, company_email, logo_base64 } = req.body;
  const projectId = req.params.id;
  
  db.run(`
    INSERT INTO project_doc_config (project_id, filiale, company_name, company_address, company_postal_code, company_city, company_email, logo_base64, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(project_id) DO UPDATE SET
      filiale = excluded.filiale,
      company_name = excluded.company_name,
      company_address = excluded.company_address,
      company_postal_code = excluded.company_postal_code,
      company_city = excluded.company_city,
      company_email = excluded.company_email,
      logo_base64 = excluded.logo_base64,
      updated_at = datetime('now')
  `, [projectId, filiale || 'cmt-groupe', company_name, company_address, company_postal_code, company_city, company_email, logo_base64], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ updated: true });
  });
});

// ══════════════════════════════════════════════════════
// ██  START SERVER
// ══════════════════════════════════════════════════════

// Export pour les tests (Supertest importe `app` sans démarrer le serveur)
let server;
if (require.main === module) {
  server = app.listen(PORT, () => {
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
}

module.exports = { app, db, ollamaRequest, authMiddleware };

// ── Graceful shutdown ────────────────────────────────
function shutdown(signal) {
  console.log(`\n[${signal}] Arrêt du serveur...`);
  const done = () => {
    db.close((err) => {
      if (err) console.error("Erreur fermeture DB:", err.message);
      else console.log("Base de données fermée proprement.");
      process.exit(0);
    });
  };
  if (server) server.close(done);
  else done();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));

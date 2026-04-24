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

const express    = require("express");
const sqlite3    = require("sqlite3").verbose();
const path       = require("path");
const fs         = require("fs");
const XLSX       = require("xlsx");
const crypto     = require("crypto");
const bcrypt     = require("bcryptjs");
const rateLimit  = require("express-rate-limit");

const createOllamaRouter       = require("./routes/ollama");
const createAuthRouter         = require("./routes/auth");
const createCicdRouter         = require("./routes/cicd");
const createExportRouter       = require("./routes/export");
const createScenariosRouter    = require("./routes/scenarios");
const createImportRouter       = require("./routes/import");
const createCampaignsRouter    = require("./routes/campaigns");
const createClickUpRouter      = require("./routes/clickup");
const createProductionBugsRouter = require("./routes/production-bugs");
const createLlmRouter          = require("./routes/llm");
const createUserStoriesRouter  = require("./routes/user-stories");

const app  = express();
// Désactiver la génération automatique d'ETags — l'API sert des données dynamiques
// qui ne doivent jamais être mises en cache par le navigateur (évite les 304 parasites).
app.set('etag', false);
const PORT = process.env.PORT || 3000;
const ENV_KEY = process.env.ANTHROPIC_API_KEY || null;

// ── Rate limiters ────────────────────────────────────────────────────────────
// Désactivés en mode test pour ne pas bloquer les tests
const isTest = process.env.NODE_ENV === "test" || process.env.JEST_WORKER_ID;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: isTest ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de tentatives de connexion. Réessayez dans 15 minutes." },
  skip: () => Boolean(isTest),
});

const triggerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: isTest ? 10000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Quota de déclenchements CI/CD atteint. Réessayez dans 1 heure." },
  skip: () => Boolean(isTest),
});

const llmLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: isTest ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Trop de requêtes LLM. Attendez 1 minute." },
  skip: () => Boolean(isTest),
});

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

// CORS — configurable via CORS_ORIGINS (virgule-séparé) ou "*" par défaut
const corsOriginsEnv = process.env.CORS_ORIGINS || "";
const allowedOrigins = corsOriginsEnv
  ? corsOriginsEnv.split(",").map(s => s.trim()).filter(Boolean)
  : [];

app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  if (allowedOrigins.length === 0) {
    // Pas de restriction configurée → autoriser tout (comportement historique)
    res.header("Access-Control-Allow-Origin", "*");
  } else if (allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  } else {
    // Origine non autorisée : pas de header CORS (le navigateur bloquera)
  }
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

// ── Auth helpers ─────────────────────────────────────
const BCRYPT_ROUNDS = 10;

/** Hash bcrypt d'un mot de passe — async pour ne pas bloquer l'event loop */
function hashPassword(pw) {
  return bcrypt.hash(pw, BCRYPT_ROUNDS);
}
function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}
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
        // Avertir si le token expire dans moins de 7 jours
        if (apiToken.expires_at) {
          const msLeft = new Date(apiToken.expires_at).getTime() - Date.now();
          if (msLeft < 7 * 24 * 3600 * 1000) {
            res.set("X-Token-Expires-Soon", apiToken.expires_at);
          }
        }
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

// ── Helper Ollama (HTTP vers serveur local) ──────────
/**
 * Effectue une requête HTTP vers un serveur Ollama local.
 * Ollama tourne en HTTP simple — on ne peut pas utiliser le module `https`.
 */
function ollamaRequest(method, host, urlPath, body = null, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(host.replace(/\/$/, "") + urlPath);
    const transport = urlObj.protocol === "https:" ? require("https") : require("http");
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (urlObj.protocol === "https:" ? 443 : 11434),
      path:     urlPath,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
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
 * Like ollamaRequest but returns the raw IncomingMessage for streaming.
 * Resolves with { status, response: IncomingMessage }.
 */
function ollamaStream(method, host, urlPath, body = null, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(host.replace(/\/$/, "") + urlPath);
    const transport = urlObj.protocol === "https:" ? require("https") : require("http");
    const bodyStr = body ? JSON.stringify(body) : null;

    const options = {
      hostname: urlObj.hostname,
      port:     urlObj.port || (urlObj.protocol === "https:" ? 443 : 11434),
      path:     urlPath,
      method,
      headers: {
        "Content-Type": "application/json",
        ...(bodyStr ? { "Content-Length": Buffer.byteLength(bodyStr) } : {})
      }
    };

    const req = transport.request(options, (res) => {
      resolve({ status: res.statusCode, response: res });
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

// ── Helpers DB promisifiés ───────────────────────────
const dbRunP = (sql, p = []) => new Promise((res, rej) => db.run(sql, p, function(e) { e ? rej(e) : res(this); }));
const dbGetP = (sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const dbAllP = (sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));

// ── Audit Log Helper ─────────────────────────────────
/**
 * Enregistre une action dans les logs d'audit (async, non-bloquant)
 * @param {number} userId - ID de l'utilisateur
 * @param {string} action - Action effectuée (ex: 'CREATE_USER_STORY')
 * @param {string} entityType - Type d'entité (ex: 'user_story')
 * @param {number} entityId - ID de l'entité
 * @param {string} details - Détails JSON
 */
function auditLog(userId, action, entityType, entityId, details) {
  db.run(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, action, entityType, entityId, details],
    (err) => {
      if (err) console.warn('[auditLog] Erreur écriture log:', err.message);
    }
  );
}

// ── Détection flakiness ──────────────────────────────
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
      isFlakyChange = (diffMs / (1000 * 60 * 60)) < 24 ? 1 : 0;
    }

    if (hasChanged) {
      await dbRunP(
        `INSERT INTO scenario_status_changes (scenario_id, session_id, previous_status, new_status, is_flaky_change)
         VALUES (?, ?, ?, ?, ?)`,
        [r.scenario_id, sessionId, prev.status, r.status, isFlakyChange]
      );
    }

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

// ══════════════════════════════════════════════════════
// ██  MONTAGE DES ROUTEURS
// ══════════════════════════════════════════════════════

// Scenarios, sessions, stats
app.use(createScenariosRouter(db, requireAuth, requireCP, detectFlakinessForSession));

// User Stories (P9.1)
app.use(createUserStoriesRouter(db, requireAuth, auditLog));

// Ollama proxy
app.use("/api/ollama", createOllamaRouter(requireAuth, () => module.exports.ollamaRequest, llmLimiter, () => module.exports.ollamaStream));

// LLM proxy (Anthropic /api/messages)
app.use(createLlmRouter(requireAuth, llmLimiter, ENV_KEY));

// Import Excel
app.use(createImportRouter(db, requireAuth, XLSX));

// Campagnes, coverage, KPIs TNR/flakiness
const docGenerator = require("./exports/doc-generator");
app.use(createCampaignsRouter(db, requireAuth, docGenerator));

// ClickUp integration
app.use(createClickUpRouter(db, requireAuth));

// Production bugs + KPI taux de fuite + rapport COMEP
app.use(createProductionBugsRouter(db, requireAuth));

// Auth, users, workflow, notifications
// loginLimiter passé au routeur pour être monté EN PREMIER sur /api/auth/login
app.use(createAuthRouter(db, hashPassword, generateToken, requireAuth, requireCP, loginLimiter));

// CI/CD tokens + trigger
// triggerLimiter passé au routeur pour être monté EN PREMIER sur /api/trigger
app.use(createCicdRouter(db, requireAuth, generateApiToken, hashApiToken, triggerLimiter));

// Export documentaire (DOCX)
app.use(createExportRouter(db, requireAuth));

// ══════════════════════════════════════════════════════
// ██  STATIC FILES — React SPA (unique frontend)
// ══════════════════════════════════════════════════════

const reactDist = path.join(__dirname, "src-react", "dist");
if (fs.existsSync(reactDist)) {
  app.use(express.static(reactDist));
  // SPA fallback: routes inconnues (non-API) → index.html (React Router gère le routing)
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Endpoint non trouvé" });
    }
    res.sendFile(path.join(reactDist, "index.html"));
  });
} else {
  app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
      return res.status(404).json({ error: "Endpoint non trouvé" });
    }
    res.status(503).json({
      error: "Frontend build not found. Run: cd src-react && npm run build",
    });
  });
}

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

module.exports = { app, db, ollamaRequest, ollamaStream, authMiddleware };

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

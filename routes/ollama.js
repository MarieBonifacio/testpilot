"use strict";

const express = require("express");

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
 * @param {Function} requireAuth      - middleware requireAuth de proxy.js
 * @param {Function} getOllamaRequest - () => ollamaRequest (bufferisé)
 * @param {Function} llmLimiter       - express-rate-limit middleware (appliqué uniquement à /chat)
 * @param {Function} getOllamaStream  - () => ollamaStream (streaming brut)
 */
module.exports = function createOllamaRouter(requireAuth, getOllamaRequest, llmLimiter, getOllamaStream) {
  const router = express.Router();

  // GET /api/ollama/health?host=http://localhost:11434
  router.get("/health", requireAuth, async (req, res) => {
    let host;
    try {
      host = validateOllamaHost(req.query.host || "http://localhost:11434");
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
    try {
      const { status } = await getOllamaRequest()("GET", host, "/api/version", null, 5000);
      if (status === 200) {
        res.json({ ok: true });
      } else {
        res.status(502).json({ ok: false, error: `Ollama a répondu HTTP ${status}` });
      }
    } catch (err) {
      res.status(502).json({ ok: false, error: err.message });
    }
  });

  // GET /api/ollama/models?host=http://localhost:11434
  router.get("/models", requireAuth, async (req, res) => {
    let host;
    try {
      host = validateOllamaHost(req.query.host || "http://localhost:11434");
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    try {
      const { status, body } = await getOllamaRequest()("GET", host, "/api/tags", null, 5000);
      if (status !== 200) {
        return res.status(502).json({ error: `Ollama HTTP ${status}` });
      }
      const models = (body.models || []).map(m => m.name);
      res.json({ models });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  // POST /api/ollama/chat
  // llmLimiter est appliqué ici uniquement (health + models sont non limités)
  router.post("/chat", requireAuth, llmLimiter, async (req, res) => {
    const { host, model, messages, temperature, stream: wantStream } = req.body;

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
      stream: !!wantStream
    };

    try {
      if (wantStream) {
        // ── Mode streaming SSE ────────────────────────────
        const { status, response: ollamaRes } = await getOllamaStream()(
          "POST", ollamaHost, "/v1/chat/completions", payload, 120000
        );
        if (status !== 200) {
          let errBody = "";
          for await (const chunk of ollamaRes) errBody += chunk;
          try { errBody = JSON.parse(errBody).error || errBody; } catch { /* keep raw */ }
          return res.status(502).json({ error: `Ollama ${status} : ${errBody}` });
        }
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");
        ollamaRes.pipe(res);
        req.on("close", () => ollamaRes.destroy());
      } else {
        // ── Mode bufferisé (défaut) ───────────────────────
        const { status, body } = await getOllamaRequest()(
          "POST", ollamaHost, "/v1/chat/completions", payload, 120000
        );
        if (status !== 200) {
          const errMsg = typeof body === "object" ? (body.error || JSON.stringify(body)) : body;
          return res.status(502).json({ error: `Ollama ${status} : ${errMsg}` });
        }
        res.json(body);
      }
    } catch (err) {
      res.status(502).json({
        error: err.message,
        hint: "Vérifiez qu'Ollama est démarré (`ollama serve`) et que le modèle est installé (`ollama pull <modèle>`)."
      });
    }
  });

  return router;
};

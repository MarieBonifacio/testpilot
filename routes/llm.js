"use strict";

const express = require("express");
const https   = require("https");

module.exports = function createLlmRouter(requireAuth, llmLimiter, ENV_KEY) {
  const router = express.Router();

  // POST /api/messages - Proxy Anthropic
  router.post("/api/messages", requireAuth, llmLimiter, (req, res) => {
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

  return router;
};

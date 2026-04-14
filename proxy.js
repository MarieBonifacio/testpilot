/**
 * TestPilot — Proxy API Anthropic
 * ================================
 * Lance avec : node proxy.js
 * Optionnel   : PORT=8080 node proxy.js
 *
 * Deux modes de clé API :
 *   1. Variable d'environnement ANTHROPIC_API_KEY (recommandé en équipe)
 *   2. Header x-api-key transmis par le client (mode solo / dev)
 *
 * Sert aussi les fichiers statiques du projet (index.html, dashboard.html, etc.)
 * → http://localhost:3000 ouvre directement l'app
 */

"use strict";

const http  = require("http");
const https = require("https");
const fs    = require("fs");
const path  = require("path");
const url   = require("url");

const PORT   = process.env.PORT || 3000;
const ENV_KEY = process.env.ANTHROPIC_API_KEY || null;

// Types MIME pour le serveur statique
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".ico":  "image/x-icon",
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-api-key, anthropic-version",
  };
}

function log(method, path, status) {
  const t = new Date().toLocaleTimeString("fr-FR");
  const color = status >= 400 ? "\x1b[31m" : status >= 300 ? "\x1b[33m" : "\x1b[32m";
  console.log(`${color}[${t}] ${method} ${path} → ${status}\x1b[0m`);
}

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const method = req.method;

  // ── CORS preflight ─────────────────────────────────
  if (method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // ── Proxy API Anthropic ────────────────────────────
  if (method === "POST" && parsed.pathname === "/api/messages") {
    const apiKey = ENV_KEY || req.headers["x-api-key"];
    if (!apiKey) {
      res.writeHead(401, { ...corsHeaders(), "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Clé API manquante. Définissez ANTHROPIC_API_KEY ou transmettez x-api-key." }));
      log(method, parsed.pathname, 401);
      return;
    }

    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      const options = {
        hostname: "api.anthropic.com",
        path:     "/v1/messages",
        method:   "POST",
        headers:  {
          "Content-Type":      "application/json",
          "Content-Length":    Buffer.byteLength(body),
          "x-api-key":         apiKey,
          "anthropic-version": req.headers["anthropic-version"] || "2023-06-01",
        },
      };

      const proxyReq = https.request(options, proxyRes => {
        res.writeHead(proxyRes.statusCode, { ...corsHeaders(), "Content-Type": "application/json" });
        proxyRes.pipe(res);
        log(method, parsed.pathname, proxyRes.statusCode);
      });

      proxyReq.on("error", err => {
        res.writeHead(502, { ...corsHeaders(), "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
        log(method, parsed.pathname, 502);
      });

      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ── Serveur statique ───────────────────────────────
  if (method === "GET") {
    let filePath = parsed.pathname === "/" ? "/index.html" : parsed.pathname;
    filePath = path.join(__dirname, filePath);

    // Sécurité : interdire la sortie du dossier courant
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403); res.end("Forbidden");
      log(method, parsed.pathname, 403);
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("404 — Fichier non trouvé");
        log(method, parsed.pathname, 404);
        return;
      }
      const ext  = path.extname(filePath);
      const mime = MIME[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime });
      res.end(data);
      log(method, parsed.pathname, 200);
    });
    return;
  }

  res.writeHead(405); res.end("Method Not Allowed");
});

server.listen(PORT, () => {
  console.log("\x1b[32m");
  console.log("  ✈  TestPilot Proxy");
  console.log("  ─────────────────────────────────────────");
  console.log(`  App       → http://localhost:${PORT}`);
  console.log(`  Proxy API → http://localhost:${PORT}/api/messages`);
  console.log(`  Clé API   → ${ENV_KEY ? "✓ Variable d'environnement ANTHROPIC_API_KEY" : "⚠  Transmise par le client (mode dev)"}`);
  console.log("  ─────────────────────────────────────────");
  console.log("  Ctrl+C pour arrêter");
  console.log("\x1b[0m");
});

"use strict";

const express = require("express");
const https   = require("https");

module.exports = function createClickUpRouter(db, requireAuth) {
  const router = express.Router();

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
  router.get("/api/projects/:id/clickup-config", requireAuth, (req, res) => {
    db.get("SELECT * FROM clickup_configs WHERE project_id = ?", [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || { project_id: parseInt(req.params.id), api_token: null, list_id: null, enabled: 0 });
    });
  });

  /**
   * PUT /api/projects/:id/clickup-config  — Sauvegarder la config ClickUp
   */
  router.put("/api/projects/:id/clickup-config", requireAuth, (req, res) => {
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
  router.get("/api/clickup/lists", requireAuth, async (req, res) => {
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
  router.post("/api/clickup/create-task", requireAuth, async (req, res) => {
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
  router.post("/api/clickup/create-batch", requireAuth, async (req, res) => {
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

  return router;
};

"use strict";

const express      = require("express");
const docGenerator = require("../exports/doc-generator");

/**
 * @param {object}   db          - connexion SQLite3
 * @param {Function} requireAuth - middleware auth obligatoire
 */
module.exports = function createExportRouter(db, requireAuth) {
  const router = express.Router();

  // GET /api/projects/:id/export/cahier-recette
  router.get("/api/projects/:id/export/cahier-recette", requireAuth, async (req, res) => {
    try {
      const buffer = await docGenerator.generateCahierRecette(req.params.id, db);
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="cahier-recette-${req.params.id}.docx"`
      });
      res.send(buffer);
    } catch (error) {
      console.error("Export cahier-recette error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/projects/:id/export/plan-test
  router.get("/api/projects/:id/export/plan-test", requireAuth, async (req, res) => {
    try {
      const buffer = await docGenerator.generatePlanTest(req.params.id, db);
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="plan-test-${req.params.id}.docx"`
      });
      res.send(buffer);
    } catch (error) {
      console.error("Export plan-test error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:id/export/rapport
  router.get("/api/sessions/:id/export/rapport", requireAuth, async (req, res) => {
    try {
      const buffer = await docGenerator.generateRapportCampagne(req.params.id, db);
      res.set({
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="rapport-campagne-${req.params.id}.docx"`
      });
      res.send(buffer);
    } catch (error) {
      console.error("Export rapport-campagne error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/projects/:id/doc-config
  router.get("/api/projects/:id/doc-config", requireAuth, (req, res) => {
    db.get("SELECT * FROM project_doc_config WHERE project_id = ?", [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(row || { project_id: parseInt(req.params.id), filiale: "cmt-groupe" });
    });
  });

  // PUT /api/projects/:id/doc-config
  router.put("/api/projects/:id/doc-config", requireAuth, (req, res) => {
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
    `, [projectId, filiale || "cmt-groupe", company_name, company_address, company_postal_code, company_city, company_email, logo_base64], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: true });
    });
  });

  return router;
};

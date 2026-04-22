"use strict";

const express = require("express");

module.exports = function createImportRouter(db, requireAuth, XLSX) {
  const router = express.Router();

  /**
   * POST /api/projects/:id/import-excel
   * Corps : application/octet-stream (fichier .xlsx brut)
   * Analyse chaque ligne du premier onglet et retourne un tableau
   * de cas de tests normalisés en Given/When/Then via l'IA.
   * Sans clé IA : retourne les lignes brutes sans normalisation.
   */
  router.post("/api/projects/:id/import-excel", requireAuth, (req, res) => {
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

  return router;
};

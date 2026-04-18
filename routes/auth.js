"use strict";

const express = require("express");

/**
 * @param {object}   db              - connexion SQLite3
 * @param {Function} hashPassword    - hash SHA-256 d'un mot de passe
 * @param {Function} generateToken   - génère un token de session aléatoire
 * @param {Function} requireAuth     - middleware d'authentification obligatoire
 * @param {Function} requireCP       - middleware rôle CP/admin obligatoire
 */
module.exports = function createAuthRouter(db, hashPassword, generateToken, requireAuth, requireCP) {
  const router = express.Router();

  // ── POST /api/auth/register ───────────────────────────
  // Premier lancement : si aucun user en BDD, création libre (bootstrap admin)
  // Ensuite : accessible uniquement aux admins connectés
  router.post("/api/auth/register", (req, res) => {
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
  router.post("/api/auth/login", (req, res) => {
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
  router.post("/api/auth/logout", requireAuth, (req, res) => {
    const header = req.headers["authorization"] || "";
    const token  = header.replace(/^Bearer\s+/, "");
    db.run("DELETE FROM auth_sessions WHERE token = ?", [token], () => res.json({ ok: true }));
  });

  // ── GET /api/auth/me ──────────────────────────────────
  router.get("/api/auth/me", requireAuth, (req, res) => {
    const { password_hash: _, ...safeUser } = req.currentUser;
    res.json(safeUser);
  });

  // ── GET /api/users ────────────────────────────────────
  router.get("/api/users", requireAuth, (req, res) => {
    db.all("SELECT id, username, display_name, role, email, created_at FROM users ORDER BY display_name", [], (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    });
  });

  // ── GET /api/users/:id ────────────────────────────────
  router.get("/api/users/:id", requireAuth, (req, res) => {
    db.get("SELECT id, username, display_name, role, email, created_at FROM users WHERE id = ?", [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Utilisateur non trouvé" });
      res.json(row);
    });
  });

  // ── PUT /api/users/:id ────────────────────────────────
  router.put("/api/users/:id", requireAuth, (req, res) => {
    const { display_name, role, email, password } = req.body;
    const isSelf  = req.currentUser.id === parseInt(req.params.id);
    const isAdmin = req.currentUser.role === "admin";
    if (!isSelf && !isAdmin) return res.status(403).json({ error: "Accès refusé" });

    const ALLOWED_ROLES = ["automaticien", "cp", "key_user", "admin"];
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
  router.delete("/api/users/:id", requireAuth, (req, res) => {
    if (req.currentUser.role !== "admin") return res.status(403).json({ error: "Rôle admin requis" });
    db.run("DELETE FROM users WHERE id = ?", [req.params.id], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
      res.json({ deleted: true });
    });
  });

  // ── Workflow validation scénarios ─────────────────────

  // PATCH /api/scenarios/:id/submit — soumettre pour validation
  router.patch("/api/scenarios/:id/submit", requireAuth, (req, res) => {
    db.get("SELECT * FROM scenarios WHERE id = ?", [req.params.id], (err, sc) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!sc) return res.status(404).json({ error: "Scénario non trouvé" });
      db.run(
        "UPDATE scenarios SET validation_status='submitted', updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [req.params.id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
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
  router.patch("/api/scenarios/:id/validate", requireCP, (req, res) => {
    db.get("SELECT * FROM scenarios WHERE id = ?", [req.params.id], (err, sc) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!sc) return res.status(404).json({ error: "Scénario non trouvé" });
      db.run(
        "UPDATE scenarios SET validation_status='validated', accepted=1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [req.params.id],
        (err2) => {
          if (err2) return res.status(500).json({ error: err2.message });
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
  router.patch("/api/scenarios/:id/reject", requireCP, (req, res) => {
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

  // PATCH /api/scenarios/:id/assign
  router.patch("/api/scenarios/:id/assign", requireCP, (req, res) => {
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

  // ── Notifications ─────────────────────────────────────

  // GET /api/notifications
  router.get("/api/notifications", requireAuth, (req, res) => {
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
  router.patch("/api/notifications/:id/read", requireAuth, (req, res) => {
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
  router.post("/api/notifications/read-all", requireAuth, (req, res) => {
    db.run(
      "UPDATE notifications SET read=1 WHERE user_id=?",
      [req.currentUser.id],
      (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ ok: true });
      }
    );
  });

  return router;
};

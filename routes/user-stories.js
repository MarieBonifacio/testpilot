"use strict";

const express = require("express");

/**
 * Routes pour la gestion des User Stories (P9.1)
 * @param {object}   db          - connexion SQLite3
 * @param {Function} requireAuth - middleware auth obligatoire
 * @param {Function} auditLog    - fonction d'audit log (userId, action, entityType, entityId, details)
 */
module.exports = function createUserStoriesRouter(db, requireAuth, auditLog) {
  const router = express.Router();

  // ── Helper: Populate criteria & linked scenarios ─────
  async function populateUserStory(story) {
    return new Promise((resolve, reject) => {
      // Fetch criteria
      db.all(
        `SELECT * FROM user_story_criteria WHERE user_story_id = ? ORDER BY display_order ASC`,
        [story.id],
        (err, criteria) => {
          if (err) return reject(err);
          
          // Fetch linked scenarios
          db.all(
            `SELECT scenario_id FROM user_story_scenarios WHERE user_story_id = ?`,
            [story.id],
            (err2, links) => {
              if (err2) return reject(err2);
              
              // Fetch creator and assignee names
              const creatorId = story.created_by;
              const assigneeId = story.assigned_to;
              
              let query = `SELECT id, display_name FROM users WHERE id IN (?, ?)`;
              db.all(query, [creatorId, assigneeId], (err3, users) => {
                if (err3) return reject(err3);
                
                const creator = users.find(u => u.id === creatorId);
                const assignee = users.find(u => u.id === assigneeId);
                
                resolve({
                  ...story,
                  criteria: criteria || [],
                  linked_scenarios: links.map(l => l.scenario_id),
                  creator_name: creator?.display_name || null,
                  assignee_name: assignee?.display_name || null
                });
              });
            }
          );
        }
      );
    });
  }

  // ── GET /api/projects/:id/user-stories ───────────────
  router.get("/api/projects/:id/user-stories", requireAuth, async (req, res) => {
    const { status, priority, epic } = req.query;
    let sql = `SELECT * FROM user_stories WHERE project_id = ?`;
    const params = [req.params.id];

    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    if (priority) {
      sql += " AND priority = ?";
      params.push(priority);
    }
    if (epic) {
      sql += " AND epic = ?";
      params.push(epic);
    }

    sql += " ORDER BY created_at DESC";

    db.all(sql, params, async (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      
      try {
        // Populate criteria and linked scenarios for each story
        const populated = await Promise.all(rows.map(row => populateUserStory(row)));
        res.json(populated);
      } catch (popErr) {
        res.status(500).json({ error: popErr.message });
      }
    });
  });

  // ── GET /api/user-stories/:id ─────────────────────────
  router.get("/api/user-stories/:id", requireAuth, (req, res) => {
    db.get(
      `SELECT * FROM user_stories WHERE id = ?`,
      [req.params.id],
      async (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "User story not found" });
        
        try {
          const populated = await populateUserStory(row);
          res.json(populated);
        } catch (popErr) {
          res.status(500).json({ error: popErr.message });
        }
      }
    );
  });

  // ── POST /api/projects/:id/user-stories ──────────────
  router.post("/api/projects/:id/user-stories", requireAuth, (req, res) => {
    const projectId = parseInt(req.params.id);
    const {
      title,
      description,
      epic,
      priority = 'medium',
      story_points,
      status = 'draft',
      criteria = []
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    const createdBy = req.currentUser?.id || null;

    db.run(
      `INSERT INTO user_stories (
        project_id, title, description, epic, priority, story_points, status, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [projectId, title, description, epic, priority, story_points, status, createdBy],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        const storyId = this.lastID;
        
        // Insert criteria
        if (criteria.length > 0) {
          const stmt = db.prepare(
            `INSERT INTO user_story_criteria (user_story_id, criterion, display_order) VALUES (?, ?, ?)`
          );
          
          criteria.forEach((criterion, index) => {
            stmt.run([storyId, criterion, index], (critErr) => {
              if (critErr) console.error('Error inserting criterion:', critErr);
            });
          });
          
          stmt.finalize(async (finalErr) => {
            if (finalErr) return res.status(500).json({ error: finalErr.message });
            
            // Audit log
            if (auditLog && req.currentUser) {
              auditLog(req.currentUser.id, 'CREATE_USER_STORY', 'user_story', storyId, JSON.stringify({ title, project_id: projectId }));
            }
            
            // Fetch and return the created story
            db.get(`SELECT * FROM user_stories WHERE id = ?`, [storyId], async (getErr, row) => {
              if (getErr) return res.status(500).json({ error: getErr.message });
              try {
                const populated = await populateUserStory(row);
                res.status(201).json(populated);
              } catch (popErr) {
                res.status(500).json({ error: popErr.message });
              }
            });
          });
        } else {
          // No criteria, return immediately
          if (auditLog && req.currentUser) {
            auditLog(req.currentUser.id, 'CREATE_USER_STORY', 'user_story', storyId, JSON.stringify({ title, project_id: projectId }));
          }
          
          db.get(`SELECT * FROM user_stories WHERE id = ?`, [storyId], async (getErr, row) => {
            if (getErr) return res.status(500).json({ error: getErr.message });
            try {
              const populated = await populateUserStory(row);
              res.status(201).json(populated);
            } catch (popErr) {
              res.status(500).json({ error: popErr.message });
            }
          });
        }
      }
    );
  });

  // ── PUT /api/user-stories/:id ─────────────────────────
  router.put("/api/user-stories/:id", requireAuth, (req, res) => {
    const storyId = parseInt(req.params.id);
    const {
      title,
      description,
      epic,
      priority,
      story_points,
      status,
      assigned_to,
      criteria
    } = req.body;

    // Build dynamic UPDATE query
    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push("title = ?");
      params.push(title);
    }
    if (description !== undefined) {
      updates.push("description = ?");
      params.push(description);
    }
    if (epic !== undefined) {
      updates.push("epic = ?");
      params.push(epic);
    }
    if (priority !== undefined) {
      updates.push("priority = ?");
      params.push(priority);
    }
    if (story_points !== undefined) {
      updates.push("story_points = ?");
      params.push(story_points);
    }
    if (status !== undefined) {
      updates.push("status = ?");
      params.push(status);
    }
    if (assigned_to !== undefined) {
      updates.push("assigned_to = ?");
      params.push(assigned_to);
    }

    if (updates.length === 0 && !criteria) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push("updated_at = datetime('now')");
    params.push(storyId);

    const sql = `UPDATE user_stories SET ${updates.join(", ")} WHERE id = ?`;

    db.run(sql, params, function(err) {
      if (err) return res.status(500).json({ error: err.message });
      if (this.changes === 0) return res.status(404).json({ error: "User story not found" });

      // Update criteria if provided
      if (criteria) {
        // Delete old criteria
        db.run(`DELETE FROM user_story_criteria WHERE user_story_id = ?`, [storyId], (delErr) => {
          if (delErr) return res.status(500).json({ error: delErr.message });
          
          // Insert new criteria
          if (criteria.length > 0) {
            const stmt = db.prepare(
              `INSERT INTO user_story_criteria (user_story_id, criterion, display_order) VALUES (?, ?, ?)`
            );
            
            criteria.forEach((criterion, index) => {
              stmt.run([storyId, criterion, index]);
            });
            
            stmt.finalize(async (finalErr) => {
              if (finalErr) return res.status(500).json({ error: finalErr.message });
              
              // Audit log
              if (auditLog && req.currentUser) {
                auditLog(req.currentUser.id, 'UPDATE_USER_STORY', 'user_story', storyId, JSON.stringify({ ...req.body }));
              }
              
              // Return updated story
              db.get(`SELECT * FROM user_stories WHERE id = ?`, [storyId], async (getErr, row) => {
                if (getErr) return res.status(500).json({ error: getErr.message });
                try {
                  const populated = await populateUserStory(row);
                  res.json(populated);
                } catch (popErr) {
                  res.status(500).json({ error: popErr.message });
                }
              });
            });
          } else {
            // No criteria, return updated story
            if (auditLog && req.currentUser) {
              auditLog(req.currentUser.id, 'UPDATE_USER_STORY', 'user_story', storyId, JSON.stringify({ ...req.body }));
            }
            
            db.get(`SELECT * FROM user_stories WHERE id = ?`, [storyId], async (getErr, row) => {
              if (getErr) return res.status(500).json({ error: getErr.message });
              try {
                const populated = await populateUserStory(row);
                res.json(populated);
              } catch (popErr) {
                res.status(500).json({ error: popErr.message });
              }
            });
          }
        });
      } else {
        // No criteria update, return story
        if (auditLog && req.currentUser) {
          auditLog(req.currentUser.id, 'UPDATE_USER_STORY', 'user_story', storyId, JSON.stringify({ ...req.body }));
        }
        
        db.get(`SELECT * FROM user_stories WHERE id = ?`, [storyId], async (getErr, row) => {
          if (getErr) return res.status(500).json({ error: getErr.message });
          try {
            const populated = await populateUserStory(row);
            res.json(populated);
          } catch (popErr) {
            res.status(500).json({ error: popErr.message });
          }
        });
      }
    });
  });

  // ── DELETE /api/user-stories/:id ──────────────────────
  router.delete("/api/user-stories/:id", requireAuth, (req, res) => {
    const storyId = parseInt(req.params.id);

    // Fetch title for audit log
    db.get(`SELECT title, project_id FROM user_stories WHERE id = ?`, [storyId], (getErr, row) => {
      if (getErr) return res.status(500).json({ error: getErr.message });
      if (!row) return res.status(404).json({ error: "User story not found" });

      db.run(`DELETE FROM user_stories WHERE id = ?`, [storyId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        
        if (auditLog && req.currentUser) {
          auditLog(req.currentUser.id, 'DELETE_USER_STORY', 'user_story', storyId, JSON.stringify({ title: row.title, project_id: row.project_id }));
        }
        
        res.json({ deleted: true, id: storyId });
      });
    });
  });

  // ── POST /api/user-stories/:id/link-scenario ──────────
  router.post("/api/user-stories/:id/link-scenario", requireAuth, (req, res) => {
    const storyId = parseInt(req.params.id);
    const { scenario_id } = req.body;

    if (!scenario_id) {
      return res.status(400).json({ error: "scenario_id is required" });
    }

    db.run(
      `INSERT OR IGNORE INTO user_story_scenarios (user_story_id, scenario_id) VALUES (?, ?)`,
      [storyId, scenario_id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ linked: true, user_story_id: storyId, scenario_id });
      }
    );
  });

  // ── DELETE /api/user-stories/:id/unlink-scenario/:scenarioId ──
  router.delete("/api/user-stories/:id/unlink-scenario/:scenarioId", requireAuth, (req, res) => {
    const storyId = parseInt(req.params.id);
    const scenarioId = parseInt(req.params.scenarioId);

    db.run(
      `DELETE FROM user_story_scenarios WHERE user_story_id = ? AND scenario_id = ?`,
      [storyId, scenarioId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ unlinked: true, user_story_id: storyId, scenario_id: scenarioId });
      }
    );
  });

  return router;
};

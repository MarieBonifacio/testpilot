'use strict';

/**
 * middleware/audit.js
 * ====================
 * Middleware de journalisation des actions sensibles.
 *
 * Usage : audit(db, 'action_name', 'entity_type')(req, res, next)
 * Ou comme middleware after-action via res.on('finish').
 *
 * Les logs sont écrits de manière asynchrone et non-bloquante.
 * Un échec d'écriture de log ne bloque jamais la requête principale.
 */

/**
 * Crée un middleware d'audit pour une action donnée.
 *
 * @param {object} db           - connexion SQLite3
 * @param {string} action       - nom de l'action (ex: 'user.login', 'scenario.delete')
 * @param {string} entityType   - type d'entité (ex: 'user', 'scenario', 'project')
 * @param {function} [getEntityId] - function(req) => id de l'entité (optionnel)
 */
function createAuditMiddleware(db, action, entityType, getEntityId) {
  return function auditMiddleware(req, res, next) {
    // On enregistre après que la réponse est envoyée
    res.on('finish', () => {
      // N'auditer que les actions réussies (2xx) ou les tentatives importantes (401, 403)
      const status = res.statusCode;
      if (status >= 500) return; // Erreurs serveur : pas d'audit

      const userId    = req.currentUser ? req.currentUser.id   : null;
      const username  = req.currentUser ? req.currentUser.username : (req.body && req.body.username) || null;
      const entityId  = getEntityId ? getEntityId(req) : null;
      const ipAddress = req.ip || req.connection?.remoteAddress || null;
      const userAgent = req.headers['user-agent'] || null;
      const details   = JSON.stringify({ status, method: req.method, path: req.path });

      db.run(
        `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, username, action, entityType || null, entityId, details, ipAddress, userAgent],
        (err) => {
          if (err) {
            // Silencieux — un échec d'audit ne doit pas impacter l'application
            console.warn('[audit] Erreur écriture log:', err.message);
          }
        }
      );
    });
    next();
  };
}

/**
 * Middleware d'audit générique pour les actions sur utilisateurs.
 */
function userAction(db, action) {
  return createAuditMiddleware(db, action, 'user', (req) => req.params.id || null);
}

/**
 * Middleware d'audit pour les actions sur scénarios.
 */
function scenarioAction(db, action) {
  return createAuditMiddleware(db, action, 'scenario', (req) => req.params.id || null);
}

/**
 * Middleware d'audit pour les connexions (login/logout).
 */
function authAction(db, action) {
  return createAuditMiddleware(db, action, 'session', null);
}

module.exports = { createAuditMiddleware, userAction, scenarioAction, authAction };

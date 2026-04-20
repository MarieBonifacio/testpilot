'use strict';

/**
 * middleware/validate.js
 * ======================
 * Validateurs d'entrées pour les routes critiques.
 * Usage : router.post('/path', validate.scenario, handler)
 *
 * Chaque validateur retourne 400 avec un message descriptif
 * si la validation échoue, sinon appelle next().
 */

/**
 * Validateur pour la création/modification de scénario.
 * Champs obligatoires : title, given_text, when_text, then_text
 */
function scenario(req, res, next) {
  const { title, given_text, when_text, then_text } = req.body;
  const errors = [];

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('title est requis');
  } else if (title.length > 500) {
    errors.push('title ne peut pas dépasser 500 caractères');
  }

  if (!given_text || typeof given_text !== 'string' || given_text.trim().length === 0) {
    errors.push('given_text est requis');
  }

  if (!when_text || typeof when_text !== 'string' || when_text.trim().length === 0) {
    errors.push('when_text est requis');
  }

  if (!then_text || typeof then_text !== 'string' || then_text.trim().length === 0) {
    errors.push('then_text est requis');
  }

  const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
  if (req.body.priority && !VALID_PRIORITIES.includes(req.body.priority)) {
    errors.push(`priority doit être l'une de : ${VALID_PRIORITIES.join(', ')}`);
  }

  const VALID_TYPES = ['functional', 'regression', 'performance', 'security', 'accessibility', 'tnr'];
  if (req.body.scenario_type && !VALID_TYPES.includes(req.body.scenario_type)) {
    errors.push(`scenario_type doit être l'un de : ${VALID_TYPES.join(', ')}`);
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  next();
}

/**
 * Validateur pour la création d'utilisateur (register).
 * Champs obligatoires : username, password, display_name
 * Règles : username alphanumérique (3-50 chars), password >= 8 chars
 */
function user(req, res, next) {
  const { username, password, display_name } = req.body;
  const errors = [];

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    errors.push('username est requis');
  } else if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username.trim())) {
    errors.push('username doit contenir entre 3 et 50 caractères alphanumériques (_, ., - autorisés)');
  }

  if (!password || typeof password !== 'string') {
    errors.push('password est requis');
  } else if (password.length < 8) {
    errors.push('password doit contenir au moins 8 caractères');
  } else if (password.length > 128) {
    errors.push('password ne peut pas dépasser 128 caractères');
  }

  if (!display_name || typeof display_name !== 'string' || display_name.trim().length === 0) {
    errors.push('display_name est requis');
  } else if (display_name.length > 100) {
    errors.push('display_name ne peut pas dépasser 100 caractères');
  }

  const VALID_ROLES = ['automaticien', 'cp', 'key_user', 'admin'];
  if (req.body.role && !VALID_ROLES.includes(req.body.role)) {
    errors.push(`role doit être l'un de : ${VALID_ROLES.join(', ')}`);
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  next();
}

/**
 * Validateur pour la création de token API CI/CD.
 * Champs obligatoires : name
 * Règles : name (1-100 chars), scopes tableau valide
 */
function apiToken(req, res, next) {
  const { name, scopes, expires_in_days } = req.body;
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name est requis');
  } else if (name.length > 100) {
    errors.push('name ne peut pas dépasser 100 caractères');
  }

  const VALID_SCOPES = ['trigger', 'read', 'write', 'admin'];
  if (scopes !== undefined) {
    if (!Array.isArray(scopes)) {
      errors.push('scopes doit être un tableau');
    } else {
      const invalid = scopes.filter(s => !VALID_SCOPES.includes(s));
      if (invalid.length > 0) {
        errors.push(`Scopes invalides : ${invalid.join(', ')}. Valides : ${VALID_SCOPES.join(', ')}`);
      }
    }
  }

  if (expires_in_days !== undefined && expires_in_days !== null) {
    const days = Number(expires_in_days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      errors.push('expires_in_days doit être un entier entre 1 et 365');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  next();
}

/**
 * Validateur pour la création de projet.
 */
function project(req, res, next) {
  const { name } = req.body;
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name est requis');
  } else if (name.length > 200) {
    errors.push('name ne peut pas dépasser 200 caractères');
  }

  if (errors.length > 0) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  next();
}

module.exports = { scenario, user, apiToken, project };

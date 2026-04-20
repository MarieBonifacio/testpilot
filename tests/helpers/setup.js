'use strict';

/**
 * Helpers partagés pour les tests TestPilot
 * ==========================================
 * Fournit des utilitaires pour créer des fixtures de test
 * (utilisateurs, projets, scénarios) et des wrappers promisifiés
 * autour des callbacks SQLite3.
 *
 * Pattern : utilise la vraie DB (testpilot.db) avec insertion/nettoyage
 * explicite, même approche que tests/leak-rate.test.js.
 *
 * Les modules proxy et proxyModule sont importés une seule fois
 * depuis la racine du projet, conformément au pattern des tests existants.
 */

const request = require('supertest');
const crypto = require('crypto');

// ── Helpers DB promisifiés ────────────────────────────

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// ── Auth mock installer ───────────────────────────────

/**
 * Installe un mock pour authMiddleware qui injecte
 * un utilisateur fictif sur chaque requête.
 * À appeler dans beforeEach (sera restauré par restoreAllMocks).
 */
function installAuthMock(proxyModule, userOverrides = {}) {
  const user = {
    id: 9000,
    username: 'testuser',
    role: 'admin',
    display_name: 'Test User',
    ...userOverrides,
  };
  jest.spyOn(proxyModule, 'authMiddleware').mockImplementation((req, _res, next) => {
    req.currentUser = user;
    next();
  });
  return user;
}

// ── Fixtures ──────────────────────────────────────────

const TEST_PREFIX = '__test__';

/**
 * Crée un projet de test unique dans la DB.
 * Retourne { id, name }.
 */
async function createTestProject(db, overrides = {}) {
  const name = overrides.name || `${TEST_PREFIX}proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const result = await dbRun(
    db,
    `INSERT INTO projects (name, tech_stack, business_domain, description) VALUES (?, ?, ?, ?)`,
    [name, overrides.tech_stack || 'Node.js', overrides.business_domain || 'Test', overrides.description || '']
  );
  return { id: result.lastID, name };
}

/**
 * Crée un utilisateur de test dans la DB avec un token de session valide.
 * Retourne { id, username, role, token }.
 */
async function createTestUser(db, overrides = {}) {
  const username = overrides.username || `${TEST_PREFIX}user_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const password = overrides.password || 'Test1234!';
  const role = overrides.role || 'automaticien';
  // SHA-256 (format existant avant migration bcrypt)
  const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

  const result = await dbRun(
    db,
    `INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)`,
    [username, passwordHash, overrides.display_name || username, role, overrides.email || `${username}@test.local`]
  );
  const userId = result.lastID;

  // Créer une session valide (expire dans 7 jours)
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
  await dbRun(
    db,
    `INSERT INTO auth_sessions (user_id, token, expires_at) VALUES (?, ?, ?)`,
    [userId, token, expiresAt]
  );

  return { id: userId, username, role, token, password };
}

/**
 * Crée un scénario de test dans un projet.
 * Retourne { id }.
 */
async function createTestScenario(db, projectId, overrides = {}) {
  const scenarioId = overrides.scenario_id || `${TEST_PREFIX}sc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const result = await dbRun(
    db,
    `INSERT INTO scenarios (project_id, scenario_id, title, given_text, when_text, then_text, feature_name, priority, scenario_type, accepted, validation_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      scenarioId,
      overrides.title || 'Test Scenario',
      overrides.given_text || 'Given a test context',
      overrides.when_text || 'When an action occurs',
      overrides.then_text || 'Then a result is expected',
      overrides.feature_name || 'TestFeature',
      overrides.priority || 'medium',
      overrides.scenario_type || 'functional',
      overrides.accepted !== undefined ? (overrides.accepted ? 1 : 0) : 1,
      overrides.validation_status || 'validated',
    ]
  );
  return { id: result.lastID };
}

/**
 * Crée une session de test.
 * Retourne { id }.
 */
async function createTestSession(db, projectId, overrides = {}) {
  const result = await dbRun(
    db,
    `INSERT INTO test_sessions (project_id, session_name, started_at, is_tnr) VALUES (?, ?, datetime('now'), ?)`,
    [projectId, overrides.name || overrides.session_name || 'Test Session', overrides.is_tnr ? 1 : 0]
  );
  return { id: result.lastID };
}

/**
 * Supprime toutes les données de test dont le nom commence par TEST_PREFIX.
 * À appeler dans afterAll.
 */
async function cleanupTestData(db) {
  // L'ordre est important à cause des foreign keys
  await dbRun(db, `DELETE FROM test_results WHERE session_id IN (
    SELECT ts.id FROM test_sessions ts
    JOIN projects p ON ts.project_id = p.id
    WHERE p.name LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM test_sessions WHERE project_id IN (
    SELECT id FROM projects WHERE name LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM scenarios WHERE project_id IN (
    SELECT id FROM projects WHERE name LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM campaigns WHERE project_id IN (
    SELECT id FROM projects WHERE name LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM production_bugs WHERE project_id IN (
    SELECT id FROM projects WHERE name LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM project_doc_config WHERE project_id IN (
    SELECT id FROM projects WHERE name LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM auth_sessions WHERE user_id IN (
    SELECT id FROM users WHERE username LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM notifications WHERE user_id IN (
    SELECT id FROM users WHERE username LIKE '${TEST_PREFIX}%'
  )`);
  await dbRun(db, `DELETE FROM users WHERE username LIKE '${TEST_PREFIX}%'`);
  await dbRun(db, `DELETE FROM projects WHERE name LIKE '${TEST_PREFIX}%'`);
}

module.exports = {
  dbRun,
  dbGet,
  dbAll,
  installAuthMock,
  createTestProject,
  createTestUser,
  createTestScenario,
  createTestSession,
  cleanupTestData,
  TEST_PREFIX,
};

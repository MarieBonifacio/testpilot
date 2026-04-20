'use strict';

/**
 * Tests d'authentification et gestion utilisateurs
 * ==================================================
 * Couvre : register, login, logout, me, users CRUD, rôles, workflow.
 * Utilise la vraie DB avec cleanup dans afterAll.
 *
 * Les tests de register/login n'utilisent PAS le mock authMiddleware
 * car ils testent précisément le mécanisme d'authentification réel.
 */

const request = require('supertest');
const proxyModule = require('../proxy');
const { app, db } = proxyModule;

const {
  dbRun,
  dbGet,
  installAuthMock,
  createTestProject,
  createTestUser,
  createTestScenario,
  cleanupTestData,
  TEST_PREFIX,
} = require('./helpers/setup');

// Données persistées pour les tests qui en ont besoin
let adminUser, regularUser, cpUser;

beforeAll(async () => {
  // Créer des utilisateurs réutilisables
  adminUser = await createTestUser(db, { role: 'admin', username: `${TEST_PREFIX}auth_admin` });
  regularUser = await createTestUser(db, { role: 'automaticien', username: `${TEST_PREFIX}auth_user` });
  cpUser = await createTestUser(db, { role: 'cp', username: `${TEST_PREFIX}auth_cp` });
});

afterAll(async () => {
  await cleanupTestData(db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Test 1 : Login valide retourne un token ───────────────────────────────
describe('POST /api/auth/login', () => {
  it('retourne un token et les infos user sans password_hash', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminUser.username, password: adminUser.password });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.user.username).toBe(adminUser.username);
  });

  // ── Test 2 : Mauvais mot de passe → 401 ──────────────────────────────
  it('retourne 401 avec un mauvais mot de passe', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminUser.username, password: 'wrongpassword123' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('retourne 400 si username ou password manquant', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: adminUser.username });

    expect(res.status).toBe(400);
  });
});

// ── Test 3 : GET /api/auth/me avec token valide ───────────────────────────
describe('GET /api/auth/me', () => {
  it('retourne le profil utilisateur sans password_hash', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('password_hash');
    expect(res.body.username).toBe(adminUser.username);
  });

  // ── Test 4 : Sans token → 401 ────────────────────────────────────────
  it('retourne 401 sans token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});

// ── Test 5 : Logout invalide le token ────────────────────────────────────
describe('POST /api/auth/logout', () => {
  it('invalide le token — appel suivant à /me retourne 401', async () => {
    // Créer un user temporaire avec son propre token
    const tmpUser = await createTestUser(db, { username: `${TEST_PREFIX}auth_logout_tmp` });

    // Vérifier que le token fonctionne
    const beforeLogout = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tmpUser.token}`);
    expect(beforeLogout.status).toBe(200);

    // Logout
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tmpUser.token}`);
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.ok).toBe(true);

    // Le token ne doit plus être valide
    const afterLogout = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tmpUser.token}`);
    expect(afterLogout.status).toBe(401);
  });
});

// ── Test 6 : Création d'utilisateur par admin ────────────────────────────
describe('POST /api/auth/register', () => {
  it('un admin peut créer un nouvel utilisateur', async () => {
    const newUsername = `${TEST_PREFIX}auth_new_${Date.now()}`;
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${adminUser.token}`)
      .send({
        username: newUsername,
        password: 'NewPass123!',
        display_name: 'Nouvel Utilisateur',
        role: 'automaticien',
      });

    expect(res.status).toBe(201);
    expect(res.body.username).toBe(newUsername);
    expect(res.body).not.toHaveProperty('password_hash');

    // Cleanup de cet user créé
    await dbRun(db, 'DELETE FROM users WHERE username = ?', [newUsername]);
  });

  // ── Test 7 : Un non-admin ne peut pas créer un user ──────────────────
  it('un automaticien ne peut pas créer de compte → 403', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set('Authorization', `Bearer ${regularUser.token}`)
      .send({
        username: `${TEST_PREFIX}auth_forbidden`,
        password: 'Test1234!',
        display_name: 'Forbidden User',
      });

    expect(res.status).toBe(403);
  });
});

// ── Test 8 : Suppression d'utilisateur réservée aux admins ───────────────
describe('DELETE /api/users/:id', () => {
  it('admin peut supprimer un utilisateur', async () => {
    // Créer un user à supprimer
    const toDelete = await createTestUser(db, { username: `${TEST_PREFIX}auth_todelete` });

    const res = await request(app)
      .delete(`/api/users/${toDelete.id}`)
      .set('Authorization', `Bearer ${adminUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Vérifier qu'il n'existe plus
    const check = await dbGet(db, 'SELECT id FROM users WHERE id = ?', [toDelete.id]);
    expect(check).toBeUndefined();
  });

  it('non-admin ne peut pas supprimer → 403', async () => {
    const res = await request(app)
      .delete(`/api/users/${adminUser.id}`)
      .set('Authorization', `Bearer ${regularUser.token}`);

    expect(res.status).toBe(403);
  });
});

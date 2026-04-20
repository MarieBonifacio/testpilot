'use strict';

/**
 * Tests CI/CD intégration
 * ========================
 * Couvre : gestion tokens API (CRUD), trigger CI/CD,
 *          bulk-results, historique executions.
 */

const request = require('supertest');
const proxyModule = require('../proxy');
const { app, db } = proxyModule;

const {
  installAuthMock,
  createTestProject,
  createTestScenario,
  createTestUser,
  cleanupTestData,
  dbRun,
} = require('./helpers/setup');

let project;
let scenario;
let apiUser;

beforeAll(async () => {
  project = await createTestProject(db);
  // Créer un scénario accepté (accepted=1) pour que le trigger le trouve
  scenario = await createTestScenario(db, project.id, { accepted: true, priority: 'high' });
  apiUser = await createTestUser(db, { role: 'key_user' });
});

afterAll(async () => {
  await cleanupTestData(db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── 1 : Créer un token API ────────────────────────────────────────────────
describe('POST /api/user/api-tokens', () => {
  it('crée un token CI/CD et retourne le token en clair une seule fois', async () => {
    installAuthMock(proxyModule, { id: apiUser.id });

    const res = await request(app)
      .post('/api/user/api-tokens')
      .send({ name: '__test__ci_token', scopes: ['trigger'] });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('token');
    expect(res.body.token).toMatch(/^tpt_/);
    expect(res.body.name).toBe('__test__ci_token');
    expect(res.body).toHaveProperty('message');
  });

  it('retourne 400 si name manquant', async () => {
    installAuthMock(proxyModule, { id: apiUser.id });

    const res = await request(app)
      .post('/api/user/api-tokens')
      .send({ scopes: ['trigger'] });

    expect(res.status).toBe(400);
  });
});

// ── 2 : Lister les tokens API ────────────────────────────────────────────
describe('GET /api/user/api-tokens', () => {
  it('retourne les tokens de l\'utilisateur sans hash', async () => {
    installAuthMock(proxyModule, { id: apiUser.id });

    const res = await request(app).get('/api/user/api-tokens');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Vérifier que le hash n'est pas exposé
    res.body.forEach(t => {
      expect(t).not.toHaveProperty('token_hash');
    });
  });
});

// ── 3 : Supprimer un token API ────────────────────────────────────────────
describe('DELETE /api/user/api-tokens/:id', () => {
  it('supprime un token existant', async () => {
    installAuthMock(proxyModule, { id: apiUser.id });

    // Créer un token à supprimer
    const createRes = await request(app)
      .post('/api/user/api-tokens')
      .send({ name: '__test__token_to_delete', scopes: ['trigger'] });
    expect(createRes.status).toBe(201);
    const tokenId = createRes.body.id;

    const deleteRes = await request(app).delete(`/api/user/api-tokens/${tokenId}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.deleted).toBe(true);
  });

  it('retourne 404 pour un token inexistant', async () => {
    installAuthMock(proxyModule, { id: apiUser.id });
    const res = await request(app).delete('/api/user/api-tokens/999999');
    expect(res.status).toBe(404);
  });
});

// ── 4 : Trigger CI/CD ───────────────────────────────────────────────────
describe('POST /api/trigger', () => {
  it('crée une session CI/CD pour le projet et retourne session_id', async () => {
    installAuthMock(proxyModule);

    const res = await request(app)
      .post('/api/trigger')
      .send({ project: project.id, filter: 'all', mode: 'full' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('session_id');
    expect(res.body).toHaveProperty('scenario_count');
    expect(res.body.scenario_count).toBeGreaterThan(0);
  });

  it('retourne 404 si projet introuvable', async () => {
    installAuthMock(proxyModule);

    const res = await request(app)
      .post('/api/trigger')
      .send({ project: 999999 });

    expect(res.status).toBe(404);
  });

  it('retourne 400 si project manquant', async () => {
    installAuthMock(proxyModule);

    const res = await request(app).post('/api/trigger').send({});
    expect(res.status).toBe(400);
  });
});

// ── 5 : Bulk results ────────────────────────────────────────────────────
describe('POST /api/sessions/:id/bulk-results', () => {
  it('insère les résultats en masse', async () => {
    installAuthMock(proxyModule);

    // D'abord créer une session via trigger
    const triggerRes = await request(app)
      .post('/api/trigger')
      .send({ project: project.id, filter: 'all', mode: 'full' });
    expect(triggerRes.status).toBe(201);
    const sessionId = triggerRes.body.session_id;

    // Bulk results
    const results = [{ scenario_id: scenario.id, status: 'PASS', duration_ms: 100 }];
    const res = await request(app)
      .post(`/api/sessions/${sessionId}/bulk-results`)
      .send({ results });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('updated');
  });
});

// ── 6 : Statut CI/CD session ─────────────────────────────────────────────
describe('GET /api/sessions/:id/status', () => {
  it('retourne le statut de la session CI/CD', async () => {
    installAuthMock(proxyModule);

    // Créer une session via trigger
    const triggerRes = await request(app)
      .post('/api/trigger')
      .send({ project: project.id });
    expect(triggerRes.status).toBe(201);
    const sessionId = triggerRes.body.session_id;

    const res = await request(app).get(`/api/sessions/${sessionId}/status`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('state');
    expect(res.body).toHaveProperty('session_id');
  });
});

// ── 7 : Rotation de token API ────────────────────────────────────────────
describe('POST /api/user/api-tokens/:id/rotate', () => {
  it('invalide l\'ancien token et retourne un nouveau token en clair', async () => {
    installAuthMock(proxyModule, { id: apiUser.id });

    // Créer un token à faire tourner
    const createRes = await request(app)
      .post('/api/user/api-tokens')
      .send({ name: '__test__token_to_rotate', scopes: ['trigger'], expires_in_days: 30 });
    expect(createRes.status).toBe(201);
    const { id: tokenId, token: oldToken, token_prefix: oldPrefix } = createRes.body;

    const rotateRes = await request(app).post(`/api/user/api-tokens/${tokenId}/rotate`);
    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body).toHaveProperty('token');
    expect(rotateRes.body.token).toMatch(/^tpt_/);
    // Nouveau token doit être différent de l'ancien
    expect(rotateRes.body.token).not.toBe(oldToken);
    expect(rotateRes.body.token_prefix).not.toBe(oldPrefix);
    expect(rotateRes.body.id).toBe(tokenId);
    expect(rotateRes.body).toHaveProperty('expires_at');
    expect(rotateRes.body.expires_at).not.toBeNull();
    expect(rotateRes.body).toHaveProperty('message');
  });

  it('retourne 404 pour un token inexistant', async () => {
    installAuthMock(proxyModule, { id: apiUser.id });
    const res = await request(app).post('/api/user/api-tokens/999999/rotate');
    expect(res.status).toBe(404);
  });
});

'use strict';

/**
 * Tests sessions de test et résultats
 * =====================================
 * Couvre : créer/lister sessions, ajouter résultats,
 *          finir session, export JUnit, campagnes.
 */

const request = require('supertest');
const proxyModule = require('../proxy');
const { app, db } = proxyModule;

const {
  installAuthMock,
  createTestProject,
  createTestScenario,
  createTestSession,
  cleanupTestData,
  dbRun,
} = require('./helpers/setup');

let project;
let scenario;

beforeAll(async () => {
  project = await createTestProject(db);
  scenario = await createTestScenario(db, project.id);
});

afterAll(async () => {
  await cleanupTestData(db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── 1 : Lister les sessions d'un projet ──────────────────────────────────
describe('GET /api/projects/:id/sessions', () => {
  it('retourne la liste des sessions', async () => {
    installAuthMock(proxyModule);
    await createTestSession(db, project.id, { name: '__test__session_list' });

    const res = await request(app).get(`/api/projects/${project.id}/sessions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── 2 : Créer une session ─────────────────────────────────────────────────
describe('POST /api/projects/:id/sessions', () => {
  it('crée une session et retourne 201', async () => {
    installAuthMock(proxyModule);

    const res = await request(app)
      .post(`/api/projects/${project.id}/sessions`)
      .send({ session_name: '__test__new_session', scenario_count: 5 });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.session_name).toBe('__test__new_session');
  });
});

// ── 3 : Ajouter un résultat de test ──────────────────────────────────────
describe('POST /api/sessions/:id/results', () => {
  it('ajoute un résultat PASS à une session', async () => {
    installAuthMock(proxyModule);
    const session = await createTestSession(db, project.id);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/results`)
      .send({ scenario_id: scenario.id, status: 'PASS', comment: 'OK' });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PASS');
  });

  it('retourne 400 si statut invalide', async () => {
    installAuthMock(proxyModule);
    const session = await createTestSession(db, project.id);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/results`)
      .send({ scenario_id: scenario.id, status: 'INVALID_STATUS' });

    expect(res.status).toBe(400);
  });

  it('retourne 400 si scenario_id manquant', async () => {
    installAuthMock(proxyModule);
    const session = await createTestSession(db, project.id);

    const res = await request(app)
      .post(`/api/sessions/${session.id}/results`)
      .send({ status: 'PASS' });

    expect(res.status).toBe(400);
  });
});

// ── 4 : Récupérer une session avec ses résultats ─────────────────────────
describe('GET /api/sessions/:id', () => {
  it('retourne la session avec ses résultats', async () => {
    installAuthMock(proxyModule);
    const session = await createTestSession(db, project.id);

    // Ajouter un résultat
    await dbRun(db,
      "INSERT INTO test_results (session_id, scenario_id, status) VALUES (?, ?, 'PASS')",
      [session.id, scenario.id]
    );

    const res = await request(app).get(`/api/sessions/${session.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('results');
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
  });

  it('retourne 404 pour une session inexistante', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get('/api/sessions/999999');
    expect(res.status).toBe(404);
  });
});

// ── 5 : Terminer une session ─────────────────────────────────────────────
describe('PUT /api/sessions/:id/finish', () => {
  it('marque la session comme terminée avec une durée', async () => {
    installAuthMock(proxyModule);
    const session = await createTestSession(db, project.id);

    const res = await request(app).put(`/api/sessions/${session.id}/finish`);
    expect(res.status).toBe(200);
    expect(res.body.finished).toBe(true);
  });
});

// ── 6 : Export JUnit ─────────────────────────────────────────────────────
describe('GET /api/sessions/:id/junit', () => {
  it('génère un rapport JUnit XML', async () => {
    installAuthMock(proxyModule);
    const session = await createTestSession(db, project.id);
    await dbRun(db,
      "INSERT INTO test_results (session_id, scenario_id, status) VALUES (?, ?, 'PASS')",
      [session.id, scenario.id]
    );

    const res = await request(app).get(`/api/sessions/${session.id}/junit`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/xml/);
    expect(res.text).toContain('<testsuite');
  });
});

// ── 7 : Campagnes — créer et lister ──────────────────────────────────────
describe('Campagnes', () => {
  it('crée une campagne et la liste', async () => {
    installAuthMock(proxyModule);

    const createRes = await request(app)
      .post(`/api/projects/${project.id}/campaigns`)
      .send({ name: '__test__campagne', description: 'Test campaign' });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const listRes = await request(app).get(`/api/projects/${project.id}/campaigns`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
  });
});

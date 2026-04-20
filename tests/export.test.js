'use strict';

/**
 * Tests d'export DOCX et configuration document
 * ================================================
 * Couvre : export cahier-recette, plan-test, rapport-campagne,
 *          doc-config GET/PUT.
 * Note : les exports DOCX nécessitent un projet avec données.
 *        On teste surtout le Content-Type et la réponse non-vide.
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
let session;

beforeAll(async () => {
  project = await createTestProject(db);
  const scenario = await createTestScenario(db, project.id, { accepted: true });

  // Créer une session avec des résultats pour le rapport
  session = await createTestSession(db, project.id, { session_name: '__test__export_session' });
  await dbRun(db,
    "INSERT INTO test_results (session_id, scenario_id, status) VALUES (?, ?, 'PASS')",
    [session.id, scenario.id]
  );
  // Marquer la session comme terminée
  await dbRun(db,
    "UPDATE test_sessions SET finished_at = datetime('now'), duration_seconds = 60 WHERE id = ?",
    [session.id]
  );
});

afterAll(async () => {
  await cleanupTestData(db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── 1 : Export cahier de recette ─────────────────────────────────────────
describe('GET /api/projects/:id/export/cahier-recette', () => {
  it('génère un fichier DOCX avec le bon Content-Type', async () => {
    installAuthMock(proxyModule);

    const res = await request(app)
      .get(`/api/projects/${project.id}/export/cahier-recette`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml|octet-stream/);
    expect(res.body).toBeDefined();
  }, 20000); // timeout plus long car génération DOCX
});

// ── 2 : Export plan de test ──────────────────────────────────────────────
describe('GET /api/projects/:id/export/plan-test', () => {
  it('génère un plan de test DOCX', async () => {
    installAuthMock(proxyModule);

    const res = await request(app)
      .get(`/api/projects/${project.id}/export/plan-test`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml|octet-stream/);
  }, 20000);
});

// ── 3 : Export rapport de campagne ───────────────────────────────────────
describe('GET /api/sessions/:id/export/rapport', () => {
  it('génère un rapport de campagne DOCX', async () => {
    installAuthMock(proxyModule);

    const res = await request(app)
      .get(`/api/sessions/${session.id}/export/rapport`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml|octet-stream/);
  }, 20000);
});

// ── 4 : Doc config GET/PUT ───────────────────────────────────────────────
describe('Doc config', () => {
  it('retourne la config par défaut si absente', async () => {
    installAuthMock(proxyModule);

    const res = await request(app)
      .get(`/api/projects/${project.id}/doc-config`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('project_id');
  });

  it('sauvegarde et relit la configuration document', async () => {
    installAuthMock(proxyModule);

    const putRes = await request(app)
      .put(`/api/projects/${project.id}/doc-config`)
      .send({
        filiale: '__test__filiale',
        company_name: 'Test Corp',
        company_address: '123 Rue Test',
        company_postal_code: '75001',
        company_city: 'Paris',
        company_email: 'test@test.local',
      });

    expect(putRes.status).toBe(200);
    expect(putRes.body.updated).toBe(true);

    const getRes = await request(app)
      .get(`/api/projects/${project.id}/doc-config`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.company_name).toBe('Test Corp');
  });
});

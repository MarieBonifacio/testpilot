'use strict';

/**
 * Tests KPIs et analytics
 * ========================
 * Couvre : stats projet, TNR duration, flakiness,
 *          campagnes KPIs, COMEP report, leak-rate.
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

// ── 1 : Stats du projet ──────────────────────────────────────────────────
describe('GET /api/projects/:id/stats', () => {
  it('retourne les compteurs de scénarios', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get(`/api/projects/${project.id}/stats`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('accepted');
    expect(res.body).toHaveProperty('features');
    expect(typeof res.body.total).toBe('number');
  });
});

// ── 2 : KPI TNR duration ─────────────────────────────────────────────────
describe('GET /api/projects/:id/kpis/tnr-duration', () => {
  it('retourne les données de durée TNR (vides si pas de sessions TNR)', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get(`/api/projects/${project.id}/kpis/tnr-duration`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('average_duration_seconds');
    expect(Array.isArray(res.body.last_10_sessions)).toBe(true);
  });
});

// ── 3 : KPI Flakiness ────────────────────────────────────────────────────
describe('GET /api/projects/:id/kpis/flakiness', () => {
  it('retourne les données de flakiness', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get(`/api/projects/${project.id}/kpis/flakiness`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('most_flaky');
    expect(Array.isArray(res.body.most_flaky)).toBe(true);
  });
});

// ── 4 : KPI Leak rate ────────────────────────────────────────────────────
describe('GET /api/projects/:id/kpis/leak-rate', () => {
  it('retourne le taux de fuite (calculé ou vide)', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get(`/api/projects/${project.id}/kpis/leak-rate`);

    expect(res.status).toBe(200);
    // La réponse est un objet avec des données de leak rate
    expect(typeof res.body).toBe('object');
  });
});

// ── 5 : COMEP report ────────────────────────────────────────────────────
describe('GET /api/projects/:id/comep-report', () => {
  it('retourne le rapport COMEP du projet', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get(`/api/projects/${project.id}/comep-report`);

    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });
});

// ── 6 : KPI avec sessions TNR réelles ────────────────────────────────────
describe('KPIs TNR avec données réelles', () => {
  it('calcule la durée moyenne TNR avec une session terminée', async () => {
    installAuthMock(proxyModule);

    // Créer une session TNR avec durée
    const sessionResult = await dbRun(
      db,
      `INSERT INTO test_sessions (project_id, session_name, is_tnr, started_at, finished_at, duration_seconds, scenario_count)
       VALUES (?, '__test__tnr_session', 1, datetime('now', '-5 minutes'), datetime('now'), 300, 1)`,
      [project.id]
    );
    const sessionId = sessionResult.lastID;

    await dbRun(db,
      "INSERT INTO test_results (session_id, scenario_id, status) VALUES (?, ?, 'PASS')",
      [sessionId, scenario.id]
    );

    const res = await request(app).get(`/api/projects/${project.id}/kpis/tnr-duration`);
    expect(res.status).toBe(200);
    expect(res.body.last_10_sessions.length).toBeGreaterThan(0);
    expect(res.body.average_duration_seconds).toBeGreaterThan(0);
  });
});

// ── 7 : Campagnes KPIs ──────────────────────────────────────────────────
describe('GET /api/projects/:id/campaigns', () => {
  it('retourne les campagnes du projet', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get(`/api/projects/${project.id}/campaigns`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

// ── 8 : Production bugs ──────────────────────────────────────────────────
describe('Production bugs', () => {
  it('crée et liste les bugs de production', async () => {
    installAuthMock(proxyModule);

    const createRes = await request(app)
      .post(`/api/projects/${project.id}/production-bugs`)
      .send({
        title: '__test__bug',
        severity: 'high',
        description: 'Test bug',
        detected_date: new Date().toISOString().slice(0, 10),
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const listRes = await request(app).get(`/api/projects/${project.id}/production-bugs`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.bugs)).toBe(true);
  });
});

'use strict';

/**
 * Tests CRUD scénarios + workflow validation
 * ==========================================
 * Couvre : liste, création, mise à jour, suppression,
 *          toggle accept/TNR, workflow submit/validate/reject,
 *          protection rôle CP pour validate/reject.
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
  dbGet,
} = require('./helpers/setup');

let project;
let cpUser;

beforeAll(async () => {
  project = await createTestProject(db);
  cpUser = await createTestUser(db, { role: 'cp' });
});

afterAll(async () => {
  await cleanupTestData(db);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── 1 : Lister les scénarios d'un projet ─────────────────────────────────
describe('GET /api/projects/:id/scenarios', () => {
  it('retourne la liste des scénarios du projet', async () => {
    installAuthMock(proxyModule);
    await createTestScenario(db, project.id, { title: '__test__scenario_list' });

    const res = await request(app).get(`/api/projects/${project.id}/scenarios`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

// ── 2 : Créer un scénario ─────────────────────────────────────────────────
describe('POST /api/projects/:id/scenarios', () => {
  it('crée un scénario et retourne 201', async () => {
    installAuthMock(proxyModule);

    const payload = {
      id: `__test__sc_${Date.now()}`,
      title: '__test__created_scenario',
      given_text: 'Given a context',
      when_text: 'When something happens',
      then_text: 'Then result is expected',
      feature_name: 'TestFeature',
      priority: 'high',
      scenario_type: 'functional',
    };

    const res = await request(app)
      .post(`/api/projects/${project.id}/scenarios`)
      .send(payload);

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toHaveProperty('_dbId');
  });
});

// ── 3 : Mettre à jour un scénario ─────────────────────────────────────────
describe('PUT /api/scenarios/:id', () => {
  it('met à jour un scénario existant', async () => {
    installAuthMock(proxyModule);
    const scenario = await createTestScenario(db, project.id, { title: '__test__to_update' });

    const res = await request(app)
      .put(`/api/scenarios/${scenario.id}`)
      .send({ title: '__test__updated_title', priority: 'low' });

    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);

    const row = await dbGet(db, 'SELECT title FROM scenarios WHERE id = ?', [scenario.id]);
    expect(row.title).toBe('__test__updated_title');
  });

  it('retourne 404 si le scénario n\'existe pas', async () => {
    installAuthMock(proxyModule);
    const res = await request(app)
      .put('/api/scenarios/999999')
      .send({ title: 'ghost' });
    expect(res.status).toBe(404);
  });
});

// ── 4 : Supprimer un scénario ─────────────────────────────────────────────
describe('DELETE /api/scenarios/:id', () => {
  it('supprime un scénario existant', async () => {
    installAuthMock(proxyModule);
    const scenario = await createTestScenario(db, project.id, { title: '__test__to_delete' });

    const res = await request(app).delete(`/api/scenarios/${scenario.id}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);

    const row = await dbGet(db, 'SELECT id FROM scenarios WHERE id = ?', [scenario.id]);
    expect(row).toBeUndefined();
  });
});

// ── 5 : Toggle accept ────────────────────────────────────────────────────
describe('PATCH /api/scenarios/:id/accept', () => {
  it('inverse le flag accepted', async () => {
    installAuthMock(proxyModule);
    const scenario = await createTestScenario(db, project.id, { accepted: true });

    const before = await dbGet(db, 'SELECT accepted FROM scenarios WHERE id = ?', [scenario.id]);
    const res = await request(app).patch(`/api/scenarios/${scenario.id}/accept`);
    expect(res.status).toBe(200);
    expect(res.body.toggled).toBe(true);

    const after = await dbGet(db, 'SELECT accepted FROM scenarios WHERE id = ?', [scenario.id]);
    expect(after.accepted).not.toBe(before.accepted);
  });
});

// ── 6 : Toggle TNR ───────────────────────────────────────────────────────
describe('PATCH /api/scenarios/:id/tnr', () => {
  it('inverse le flag is_tnr', async () => {
    installAuthMock(proxyModule);
    const scenario = await createTestScenario(db, project.id);

    const res = await request(app).patch(`/api/scenarios/${scenario.id}/tnr`);
    expect(res.status).toBe(200);
    expect(res.body.toggled).toBe(true);
  });
});

// ── 7 : Workflow submit ───────────────────────────────────────────────────
describe('PATCH /api/scenarios/:id/submit', () => {
  it('passe le statut à submitted', async () => {
    installAuthMock(proxyModule);
    const scenario = await createTestScenario(db, project.id, { validation_status: 'draft' });

    const res = await request(app).patch(`/api/scenarios/${scenario.id}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.validation_status).toBe('submitted');
  });
});

// ── 8 : Workflow validate (CP) ────────────────────────────────────────────
describe('PATCH /api/scenarios/:id/validate', () => {
  it('un CP peut valider un scénario soumis', async () => {
    // Utiliser le vrai token CP (pas de mock auth pour tester la protection de rôle)
    const scenario = await createTestScenario(db, project.id, { validation_status: 'submitted' });

    const res = await request(app)
      .patch(`/api/scenarios/${scenario.id}/validate`)
      .set('Authorization', `Bearer ${cpUser.token}`);

    expect(res.status).toBe(200);
    expect(res.body.validation_status).toBe('validated');
  });

  it('un automaticien ne peut pas valider → 403', async () => {
    installAuthMock(proxyModule, { role: 'automaticien' });
    const scenario = await createTestScenario(db, project.id, { validation_status: 'submitted' });

    const res = await request(app).patch(`/api/scenarios/${scenario.id}/validate`);
    expect(res.status).toBe(403);
  });
});

// ── 9 : Workflow reject (CP) ──────────────────────────────────────────────
describe('PATCH /api/scenarios/:id/reject', () => {
  it('un CP peut rejeter un scénario avec une raison', async () => {
    const scenario = await createTestScenario(db, project.id, { validation_status: 'submitted' });

    const res = await request(app)
      .patch(`/api/scenarios/${scenario.id}/reject`)
      .set('Authorization', `Bearer ${cpUser.token}`)
      .send({ reason: 'Scénario incomplet' });

    expect(res.status).toBe(200);
    expect(res.body.validation_status).toBe('rejected');
    expect(res.body.rejection_reason).toBe('Scénario incomplet');
  });
});

// ── 10 : Stats projet ────────────────────────────────────────────────────
describe('GET /api/projects/:id/stats', () => {
  it('retourne les statistiques du projet', async () => {
    installAuthMock(proxyModule);
    const res = await request(app).get(`/api/projects/${project.id}/stats`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('accepted');
    expect(res.body).toHaveProperty('features');
    expect(typeof res.body.total).toBe('number');
  });
});

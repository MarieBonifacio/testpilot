/**
 * Tests unitaires — Calcul du taux de fuite (LeakRate KPI)
 * ==========================================================
 * Vérifie la logique du endpoint GET /api/projects/:id/kpis/leak-rate
 * en utilisant une base SQLite in-memory et Supertest.
 *
 * Lance avec : npm test
 */

"use strict";

const request = require("supertest");
const proxyModule = require("../proxy");
const { app, db } = proxyModule;

// ── Auth mock ─────────────────────────────────────────
function installAuthMock() {
  jest.spyOn(proxyModule, "authMiddleware").mockImplementation((req, _res, next) => {
    req.currentUser = { id: 1, username: "test", role: "admin", display_name: "Test" };
    next();
  });
}

// ── Helpers DB ────────────────────────────────────────
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function (err) { err ? reject(err) : resolve(this); })
  );
}
function dbGet(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)))
  );
}

// ── Setup / Teardown ──────────────────────────────────
let projectId;
let scenarioId;

beforeAll(async () => {
  // Migrations éventuelles (table production_bugs)
  await dbRun(`CREATE TABLE IF NOT EXISTS production_bugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    external_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    severity TEXT DEFAULT 'major',
    scenario_id INTEGER,
    detected_date TEXT NOT NULL,
    feature TEXT,
    root_cause TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`).catch(() => {});
  await dbRun(`CREATE INDEX IF NOT EXISTS idx_production_bugs_project ON production_bugs(project_id)`).catch(() => {});

  // Créer un projet de test
  const proj = await dbRun(
    "INSERT INTO projects (name) VALUES (?)",
    ["__test_leak_rate__"]
  );
  projectId = proj.lastID;

  // Créer un scénario accepté lié
  const sc = await dbRun(
    `INSERT INTO scenarios (project_id, scenario_id, title, scenario_type, priority, given_text, when_text, then_text, accepted)
     VALUES (?, 'SC-TEST-01', 'Calcul TVA', 'functional', 'high', 'G', 'W', 'T', 1)`,
    [projectId]
  );
  scenarioId = sc.lastID;
});

afterAll(async () => {
  // Nettoyage
  await dbRun("DELETE FROM production_bugs WHERE project_id = ?", [projectId]).catch(() => {});
  await dbRun("DELETE FROM scenarios     WHERE project_id = ?", [projectId]).catch(() => {});
  await dbRun("DELETE FROM projects      WHERE id = ?",         [projectId]).catch(() => {});
});

beforeEach(() => {
  installAuthMock();
  // Supprimer les bugs de test entre chaque cas
  return dbRun("DELETE FROM production_bugs WHERE project_id = ?", [projectId]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────

describe("LeakRate KPI — GET /api/projects/:id/kpis/leak-rate", () => {

  it("devrait retourner 0% quand aucun bug n'existe", async () => {
    const res = await request(app)
      .get(`/api/projects/${projectId}/kpis/leak-rate`)
      .expect(200);

    expect(res.body.total_bugs).toBe(0);
    expect(res.body.bugs_with_scenario).toBe(0);
    expect(res.body.bugs_without_scenario).toBe(0);
    expect(res.body.leak_rate_percent).toBe(0);
    expect(res.body.trend_30d).toHaveLength(30);
    expect(res.body.trend_30d.every(v => v === null)).toBe(true);
  });

  it("devrait retourner 100% quand tous les bugs ont un scénario lié", async () => {
    // 3 bugs, tous liés au scénario
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, severity, scenario_id, detected_date) VALUES (?, ?, ?, ?, date('now'))",
      [projectId, "Bug A", "critical", scenarioId]
    );
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, severity, scenario_id, detected_date) VALUES (?, ?, ?, ?, date('now'))",
      [projectId, "Bug B", "major", scenarioId]
    );
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, severity, scenario_id, detected_date) VALUES (?, ?, ?, ?, date('now'))",
      [projectId, "Bug C", "minor", scenarioId]
    );

    const res = await request(app)
      .get(`/api/projects/${projectId}/kpis/leak-rate`)
      .expect(200);

    expect(res.body.total_bugs).toBe(3);
    expect(res.body.bugs_with_scenario).toBe(3);
    expect(res.body.bugs_without_scenario).toBe(0);
    expect(res.body.leak_rate_percent).toBe(100);
  });

  it("devrait calculer correctement un taux de fuite partiel (2/5 = 40%)", async () => {
    // 2 bugs liés, 3 non liés
    for (let i = 0; i < 2; i++) {
      await dbRun(
        "INSERT INTO production_bugs (project_id, title, scenario_id, detected_date) VALUES (?, ?, ?, date('now'))",
        [projectId, `Fuite ${i}`, scenarioId]
      );
    }
    for (let i = 0; i < 3; i++) {
      await dbRun(
        "INSERT INTO production_bugs (project_id, title, scenario_id, detected_date) VALUES (?, ?, NULL, date('now'))",
        [projectId, `Non couvert ${i}`]
      );
    }

    const res = await request(app)
      .get(`/api/projects/${projectId}/kpis/leak-rate`)
      .expect(200);

    expect(res.body.total_bugs).toBe(5);
    expect(res.body.bugs_with_scenario).toBe(2);
    expect(res.body.bugs_without_scenario).toBe(3);
    expect(res.body.leak_rate_percent).toBe(40);
  });

  it("devrait ventiler correctement par sévérité", async () => {
    // 1 critical lié, 1 major non lié, 1 minor non lié
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, severity, scenario_id, detected_date) VALUES (?, 'Crit', 'critical', ?, date('now'))",
      [projectId, scenarioId]
    );
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, severity, scenario_id, detected_date) VALUES (?, 'Maj', 'major', NULL, date('now'))",
      [projectId]
    );
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, severity, scenario_id, detected_date) VALUES (?, 'Min', 'minor', NULL, date('now'))",
      [projectId]
    );

    const res = await request(app)
      .get(`/api/projects/${projectId}/kpis/leak-rate`)
      .expect(200);

    expect(res.body.by_severity.critical.total).toBe(1);
    expect(res.body.by_severity.critical.leaked).toBe(1);
    expect(res.body.by_severity.major.total).toBe(1);
    expect(res.body.by_severity.major.leaked).toBe(0);
    expect(res.body.by_severity.minor.total).toBe(1);
    expect(res.body.by_severity.minor.leaked).toBe(0);
    expect(res.body.by_severity.trivial.total).toBe(0);
  });

  it("devrait générer un tableau trend_30d de 30 entrées avec les bons taux quotidiens", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // 2 bugs aujourd'hui : 1 lié (50%), 1 non lié
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, scenario_id, detected_date) VALUES (?, 'T1', ?, ?)",
      [projectId, scenarioId, today]
    );
    await dbRun(
      "INSERT INTO production_bugs (project_id, title, scenario_id, detected_date) VALUES (?, 'T2', NULL, ?)",
      [projectId, today]
    );

    const res = await request(app)
      .get(`/api/projects/${projectId}/kpis/leak-rate`)
      .expect(200);

    expect(res.body.trend_30d).toHaveLength(30);
    // Le dernier élément (aujourd'hui) doit être 50
    const lastVal = res.body.trend_30d[29];
    expect(lastVal).toBe(50);
    // Les jours sans bug doivent être null
    const nullDays = res.body.trend_30d.slice(0, 29).filter(v => v === null);
    expect(nullDays.length).toBe(29);
  });

});

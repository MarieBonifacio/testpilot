"use strict";

const express = require("express");
const request = require("supertest");
const createUserStoriesRouter = require("../routes/user-stories");

function makeDb() {
  return {
    all: jest.fn(),
    get: jest.fn(),
    run: jest.fn(),
    prepare: jest.fn(),
  };
}

function makeApp(db, auditLog = jest.fn()) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = { id: 42, username: "tester", role: "admin" };
    next();
  });
  app.use(createUserStoriesRouter(db, (req, _res, next) => next(), auditLog));
  return app;
}

function mockStatement(db) {
  const stmt = {
    run: jest.fn((_params, cb) => cb && cb(null)),
    finalize: jest.fn(cb => cb && cb(null)),
  };
  db.prepare.mockReturnValue(stmt);
  return stmt;
}

describe("user-stories routes", () => {
  test("GET /api/projects/:id/user-stories retourne une story enrichie", async () => {
    const db = makeDb();
    db.all
      .mockImplementationOnce((_sql, _params, cb) => cb(null, [{
        id: 1,
        project_id: 7,
        title: "US 1",
        description: "desc",
        epic: "Auth",
        priority: "medium",
        story_points: 3,
        status: "draft",
        created_by: 42,
        assigned_to: 99,
      }]))
      .mockImplementationOnce((_sql, _params, cb) => cb(null, [{ criterion: "C1" }]))
      .mockImplementationOnce((_sql, _params, cb) => cb(null, [{ scenario_id: 123 }]))
      .mockImplementationOnce((_sql, _params, cb) => cb(null, [{ id: 42, display_name: "Tester", role: "admin" }, { id: 99, display_name: "Assignee", role: "cp" }]));

    const app = makeApp(db);
    const res = await request(app).get("/api/projects/7/user-stories");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      id: 1,
      title: "US 1",
      criteria: [{ criterion: "C1" }],
      linked_scenarios: [123],
      creator_name: "Tester",
      assignee_name: "Assignee",
    });
  });

  test("POST /api/projects/:id/user-stories crée une story avec critères", async () => {
    const db = makeDb();
    const auditLog = jest.fn();
    const stmt = mockStatement(db);

    db.all
      .mockImplementationOnce((_sql, _params, cb) => cb(null, [{ criterion: "C1" }, { criterion: "C2" }]))
      .mockImplementationOnce((_sql, _params, cb) => cb(null, [{ scenario_id: 11 }]))
      .mockImplementationOnce((_sql, _params, cb) => cb(null, [{ id: 42, display_name: "Tester" }]));

    db.run.mockImplementationOnce((_sql, _params, cb) => {
      cb.call({ lastID: 77 }, null);
    });
    db.get.mockImplementation((_sql, _params, cb) => cb(null, {
      id: 77,
      project_id: 7,
      title: "US créée",
      description: "desc",
      epic: "Payments",
      priority: "high",
      story_points: 5,
      status: "draft",
      created_by: 42,
      assigned_to: null,
    }));

    const app = makeApp(db, auditLog);
    const res = await request(app)
      .post("/api/projects/7/user-stories")
      .send({
        title: "US créée",
        description: "desc",
        epic: "Payments",
        priority: "high",
        story_points: 5,
        criteria: ["Critère A", "Critère B"],
      });

    expect(res.status).toBe(201);
    expect(auditLog).toHaveBeenCalledWith(42, "CREATE_USER_STORY", "user_story", 77, expect.stringContaining("US créée"));
    expect(db.prepare).toHaveBeenCalled();
    expect(stmt.run).toHaveBeenCalledTimes(2);
    expect(res.body).toMatchObject({ id: 77, title: "US créée" });
  });

  test("PUT /api/user-stories/:id renvoie 400 quand aucun champ n'est fourni", async () => {
    const db = makeDb();
    const app = makeApp(db);
    const res = await request(app).put("/api/user-stories/1").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/No fields to update/);
  });

  test("POST /api/user-stories/:id/link-scenario valide scenario_id", async () => {
    const db = makeDb();
    const app = makeApp(db);
    const res = await request(app).post("/api/user-stories/1/link-scenario").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/scenario_id/);
  });

  test("DELETE /api/user-stories/:id/unlink-scenario/:scenarioId supprime le lien", async () => {
    const db = makeDb();
    db.run.mockImplementation(function (_sql, _params, cb) {
      cb(null);
    });

    const app = makeApp(db);
    const res = await request(app).delete("/api/user-stories/1/unlink-scenario/12");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ unlinked: true, user_story_id: 1, scenario_id: 12 });
  });
});

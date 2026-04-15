/**
 * Tests des endpoints Ollama proxy
 * =================================
 * Teste les 3 endpoints /api/ollama/* sans avoir besoin
 * d'un vrai serveur Ollama — on mocke ollamaRequest()
 * directement via jest.spyOn pour éviter tout conflit
 * avec les connexions TCP internes de Supertest.
 *
 * L'authentification est contournée en mockant authMiddleware :
 * chaque requête de test se voit attribuer un utilisateur fictif
 * via req.currentUser, ce qui satisfait requireAuth sans toucher la DB.
 *
 * Lance avec : npm test
 */

"use strict";

const request = require("supertest");

// Charger l'app et la fonction à mocker
const proxyModule = require("../proxy");
const { app, db } = proxyModule;

// ── Auth mock ─────────────────────────────────────────
// Injecte un utilisateur fictif sur chaque requête de test
// pour que requireAuth() passe sans accès réel à la base.
// Réinstallé dans beforeEach car afterEach appelle restoreAllMocks.
function installAuthMock() {
  jest
    .spyOn(proxyModule, "authMiddleware")
    .mockImplementation((req, _res, next) => {
      req.currentUser = { id: 999, username: "test", role: "admin" };
      next();
    });
}

beforeEach(() => {
  installAuthMock();
});

// Fermer la DB après tous les tests
afterAll(done => {
  jest.restoreAllMocks();
  if (db && db.close) db.close(() => done());
  else done();
});

// ── Helpers ───────────────────────────────────────────
/**
 * Monte un mock pour ollamaRequest qui résout avec { status, body }.
 * Retourne le spy jest pour pouvoir l'effacer après chaque test.
 */
function mockOllama(statusCode, body) {
  return jest
    .spyOn(proxyModule, "ollamaRequest")
    .mockResolvedValue({ status: statusCode, body });
}

/**
 * Monte un mock pour ollamaRequest qui rejette avec une erreur réseau.
 */
function mockOllamaError(message) {
  return jest
    .spyOn(proxyModule, "ollamaRequest")
    .mockRejectedValue(new Error(message));
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ══════════════════════════════════════════════════════
// GET /api/ollama/health
// ══════════════════════════════════════════════════════
describe("GET /api/ollama/health", () => {
  test("retourne { ok: true } quand Ollama répond 200", async () => {
    mockOllama(200, { version: "0.5.0" });
    const res = await request(app).get("/api/ollama/health?host=http://localhost:11434");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("retourne { ok: false } avec HTTP 502 quand Ollama répond 500", async () => {
    mockOllama(500, { error: "internal error" });
    const res = await request(app).get("/api/ollama/health?host=http://localhost:11434");
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/HTTP 500/);
  });

  test("utilise localhost:11434 par défaut si host absent", async () => {
    mockOllama(200, { version: "0.5.0" });
    const res = await request(app).get("/api/ollama/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test("retourne 502 si Ollama est inaccessible (erreur réseau)", async () => {
    mockOllamaError("Impossible de joindre Ollama sur http://localhost:11434 : ECONNREFUSED");
    const res = await request(app).get("/api/ollama/health");
    expect(res.status).toBe(502);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/ECONNREFUSED/);
  });
});

// ══════════════════════════════════════════════════════
// GET /api/ollama/models
// ══════════════════════════════════════════════════════
describe("GET /api/ollama/models", () => {
  test("retourne la liste des modèles depuis Ollama", async () => {
    mockOllama(200, {
      models: [
        { name: "llama3.2:latest", size: 2000000000 },
        { name: "mistral:latest",  size: 4000000000 }
      ]
    });
    const res = await request(app).get("/api/ollama/models?host=http://localhost:11434");
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual(["llama3.2:latest", "mistral:latest"]);
  });

  test("retourne un tableau vide si Ollama n'a aucun modèle", async () => {
    mockOllama(200, { models: [] });
    const res = await request(app).get("/api/ollama/models");
    expect(res.status).toBe(200);
    expect(res.body.models).toEqual([]);
  });

  test("retourne HTTP 502 si Ollama répond avec une erreur", async () => {
    mockOllama(503, { error: "service unavailable" });
    const res = await request(app).get("/api/ollama/models");
    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
  });

  test("retourne 502 si Ollama est inaccessible (erreur réseau)", async () => {
    mockOllamaError("Impossible de joindre Ollama : ECONNREFUSED");
    const res = await request(app).get("/api/ollama/models");
    expect(res.status).toBe(502);
    expect(res.body.error).toBeDefined();
  });
});

// ══════════════════════════════════════════════════════
// POST /api/ollama/chat
// ══════════════════════════════════════════════════════
describe("POST /api/ollama/chat", () => {
  const validPayload = {
    model: "llama3.2",
    messages: [{ role: "user", content: "Bonjour" }]
  };

  const ollamaSuccessResponse = {
    id: "chatcmpl-123",
    object: "chat.completion",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "Bonjour ! Comment puis-je vous aider ?" },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 }
  };

  test("proxifie la requête vers Ollama et retourne la réponse", async () => {
    mockOllama(200, ollamaSuccessResponse);
    const res = await request(app)
      .post("/api/ollama/chat")
      .send(validPayload);
    expect(res.status).toBe(200);
    expect(res.body.choices[0].message.content).toBe("Bonjour ! Comment puis-je vous aider ?");
  });

  test("utilise l'hôte personnalisé si fourni dans le body", async () => {
    const spy = mockOllama(200, ollamaSuccessResponse);
    const res = await request(app)
      .post("/api/ollama/chat")
      .send({ ...validPayload, host: "http://192.168.1.10:11434" });
    expect(res.status).toBe(200);
    expect(res.body.choices).toBeDefined();
    // Vérifier que l'hôte personnalisé a bien été transmis à ollamaRequest
    expect(spy).toHaveBeenCalledWith("POST", "http://192.168.1.10:11434", expect.any(String), expect.any(Object), expect.any(Number));
  });

  test("retourne 400 si model est absent", async () => {
    const res = await request(app)
      .post("/api/ollama/chat")
      .send({ messages: [{ role: "user", content: "test" }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/model/);
  });

  test("retourne 400 si messages est absent", async () => {
    const res = await request(app)
      .post("/api/ollama/chat")
      .send({ model: "llama3.2" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/messages/);
  });

  test("retourne 502 avec hint si Ollama retourne une erreur", async () => {
    mockOllama(404, { error: "model 'unknown' not found" });
    const res = await request(app)
      .post("/api/ollama/chat")
      .send(validPayload);
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/404/);
  });

  test("retourne 502 avec hint si Ollama est inaccessible", async () => {
    mockOllamaError("Timeout après 120000ms — Ollama inaccessible sur http://localhost:11434");
    const res = await request(app)
      .post("/api/ollama/chat")
      .send(validPayload);
    expect(res.status).toBe(502);
    expect(res.body.hint).toBeDefined();
  });

  test("applique temperature 0.2 par défaut", async () => {
    const spy = mockOllama(200, ollamaSuccessResponse);
    await request(app)
      .post("/api/ollama/chat")
      .send({ model: "llama3.2", messages: [{ role: "user", content: "test" }] });
    // Le payload transmis à ollamaRequest doit contenir temperature: 0.2
    const callArgs = spy.mock.calls[0];
    expect(callArgs[3].temperature).toBe(0.2);
  });

  test("accepte une temperature personnalisée", async () => {
    const spy = mockOllama(200, ollamaSuccessResponse);
    await request(app)
      .post("/api/ollama/chat")
      .send({ ...validPayload, temperature: 0.8 });
    const callArgs = spy.mock.calls[0];
    expect(callArgs[3].temperature).toBe(0.8);
  });
});

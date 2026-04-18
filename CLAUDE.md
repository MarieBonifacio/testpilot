# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TestPilot is a web-based AI-assisted test scenario management system for QA teams. It supports multi-project test automation with AI-driven scenario generation (GWT format), validation workflows, campaign execution, and quality analytics.

## Commands

### Backend

```bash
npm install          # Install backend dependencies
node init_db.js      # Initialize/migrate SQLite DB (idempotent — safe to re-run)
node proxy.js        # Start backend API server on port 3000
npm start            # Start backend (same as node proxy.js)
npm test             # Run Jest tests (tests/ollama.test.js, 16 tests)
npm run test:watch   # Run tests in watch mode
node --check proxy.js  # Syntax check only
```

### Frontend (src-react/)

```bash
cd src-react
npm install
npm run dev          # Vite dev server on port 5173 (proxies /api to :3000)
npm run build        # TypeScript compile + production Vite build → dist/
npx tsc --noEmit     # Type-check without building
```

### Full Dev Setup

Run backend (`node proxy.js`) and frontend (`cd src-react && npm run dev`) in separate terminals. The React dev server proxies all `/api` calls to the Express backend.

## Architecture

### Two Frontends (Legacy + React)

The project has **two coexisting UIs**:
- **Legacy HTML/JS** (`index.html`, `campagne.html`, etc. in root) — vanilla JS, still functional
- **React SPA** (`src-react/`) — React 18 + TypeScript + Tailwind CSS, the primary active frontend

Both share the same backend API. New features should go into the React SPA (`src-react/src/pages/`).

### Backend: `proxy.js` (monolithic, ~2,900 lines)

Single Express 5 file containing all REST API routes + three LLM proxy surfaces:
- **Anthropic** — server-side via `ANTHROPIC_API_KEY` env var
- **OpenAI / Mistral** — client-side keys passed through; stored only in browser localStorage, never on server
- **Ollama** — proxied via `/api/ollama/{health,models,chat}` with server-side blocklist for cloud metadata URLs

Exports `{ app, db, ollamaRequest, authMiddleware }` for test injection.

### Database: SQLite (`testpilot.db`)

Initialized by `init_db.js` (idempotent). Schema reference in `db_schema.sql`. Key table groups:
- **Core:** `projects`, `scenarios`, `test_sessions`, `test_results`, `campaigns`
- **AI/Analytics:** `scenario_analyses`, `scenario_flakiness_stats`, `scenario_status_changes`
- **Users/Auth:** `users` (SHA-256 passwords — no salt, migration needed for production), `auth_sessions` (bearer tokens), `api_tokens` (CI/CD, prefix `tpt_`)
- **Integration:** `llm_providers`, `project_contexts`, `clickup_configs`

Foreign keys enabled via `PRAGMA foreign_keys = ON`.

### React Frontend (`src-react/src/`)

- **`App.tsx`** — Router + `RequireAuth` / `RequireRole` guards + theme toggle
- **`lib/api.ts`** — All typed HTTP calls to the backend
- **`lib/hooks.tsx`** — `ProjectProvider` (global project context), `AuthProvider`, `useNotifications`
- **`types/index.ts`** — All shared TypeScript interfaces
- **`pages/`** — 18 page components (Redaction, Dashboard, Campagne, Import, Historique, Tracabilite, ClickUp, Comep, Export, ProductionBugs, etc.)
- **`components/`** — Shared components: `ProjectSelector`, `NotificationBell`, `FlakyScenariosList`

Theme uses a custom Tailwind palette with `pl-*` color prefix, supporting dark/light mode toggled via localStorage.

### Authentication

Two auth mechanisms:
1. **Bearer tokens** — session-based; users log in via `/api/auth/login`, token stored in localStorage
2. **API tokens** — CI/CD integration; `tpt_` prefix + hash; managed in `ApiTokens.tsx`

Roles: `automaticien` < `key_user` < `cp` < `admin`. The `RequireRole` component enforces page-level access.

### Document Generation

`cmt-generator-v3.js` produces Word DOCX output (test plan "cahier de recette" + campaign report). Uses the `xlsx` library for Excel import and `docx`-compatible generation.

## Testing

Tests live in `tests/ollama.test.js` and cover Ollama proxy endpoints only. Pattern:
- `jest.spyOn()` mocks `ollamaRequest` to avoid real Ollama dependency
- `authMiddleware` is mocked to inject a synthetic `req.currentUser`
- Supertest exercises the Express app without starting a real server

To run a single test: `npm test -- --testNamePattern="<pattern>"` or `npm test -- --testPathPattern=ollama`

## CI/CD

- **CI** (`.github/workflows/ci.yml`): Triggers on push/PR to `master`/`main`/`develop`. Runs backend lint → `npm test` → frontend `tsc --noEmit` + Vite build sequentially.
- **CD** (`.github/workflows/cd.yml`): Triggers on `v*.*.*` tags; builds and publishes a release zip containing the backend + compiled frontend.

## Environment

Copy `.env.example` to `.env`. Only `ANTHROPIC_API_KEY` and `PORT` (default 3000) are required. OpenAI/Mistral keys are **never stored server-side** — they live only in the user's browser localStorage.

## Key Conventions

- **Scenario format:** Given/When/Then (GWT), generated and normalized by AI
- **Workflow states:** `draft` → `submitted` → `validated` / `rejected`
- **Project isolation:** All data is scoped by `project_id`; the `ProjectProvider` context gates the entire UI
- **TypeScript:** Strict mode (`strict: true`, `noUnusedLocals: true`). All new React code must type-check cleanly before committing.
- **`init_db.js` migrations:** All schema changes must be added as idempotent `ALTER TABLE ... IF NOT EXISTS` or `CREATE TABLE IF NOT EXISTS` blocks — the file runs on every server start in some deployments.

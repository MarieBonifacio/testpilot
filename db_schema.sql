-- TestPilot Database Schema
-- SQLite schema for persisting projects, scenarios, and test execution data

-- Projects table - stores information about different Carter-Cash applications
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,           -- e.g., "ATHENA", "HERMES", "HADES", "Open Bravo"
    tech_stack TEXT,                     -- e.g., ".NET 4.8 (C#)", "Python/Robocorp"
    business_domain TEXT,                -- e.g., "Gestion de la base clients", "Encaissement"
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Project contexts - stores the contextual information used for AI prompting
CREATE TABLE IF NOT EXISTS project_contexts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    adjacent_features TEXT,              -- Features at regression risk
    global_constraints TEXT,             -- Global constraints
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id)
);

-- LLM provider configurations per project
CREATE TABLE IF NOT EXISTS llm_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    provider_name TEXT NOT NULL,         -- anthropic, openai, mistral, ollama
    api_key TEXT,                        -- Encrypted in production
    model_name TEXT,                     -- e.g., claude-sonnet-4-20250514
    custom_model_name TEXT,              -- Custom model override
    endpoint_url TEXT,                   -- Custom endpoint (for Ollama/Azure)
    is_active BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, provider_name)
);

-- Scenarios table - stores generated test scenarios
CREATE TABLE IF NOT EXISTS scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    scenario_id TEXT NOT NULL,           -- Original ID like "SC-001"
    title TEXT NOT NULL,
    scenario_type TEXT NOT NULL,         -- functional, negative, edge-case, boundary
    priority TEXT NOT NULL,              -- high, medium, low
    given_text TEXT NOT NULL,
    when_text TEXT NOT NULL,
    then_text TEXT NOT NULL,
    feature_name TEXT,                   -- Extracted from AI analysis
    accepted BOOLEAN DEFAULT 0,
    is_tnr BOOLEAN DEFAULT 0,            -- Marked as TNR (Test de Non Régression)
    source_reference TEXT,               -- Reference to source document (SFD, user story, etc.)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, scenario_id)
);

-- AI analysis results linked to scenarios
CREATE TABLE IF NOT EXISTS scenario_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    feature_detected TEXT,
    complexity TEXT,                     -- simple, moyenne, complexe
    ambiguities TEXT,                    -- JSON array of ambiguities
    regression_risks TEXT,               -- JSON array of regression risks
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Test execution sessions
CREATE TABLE IF NOT EXISTS test_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    session_name TEXT,                   -- e.g., "Sprint 23 - Recette ATHENA v2.1"
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    finished_at DATETIME,
    scenario_count INTEGER DEFAULT 0,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Individual test results within a session
CREATE TABLE IF NOT EXISTS test_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    scenario_id INTEGER NOT NULL,
    status TEXT NOT NULL,                -- PASS, FAIL, BLOQUE, SKIP
    comment TEXT,
    executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES test_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_scenarios_project ON scenarios(project_id);
CREATE INDEX IF NOT EXISTS idx_scenarios_accepted ON scenarios(accepted);
CREATE INDEX IF NOT EXISTS idx_scenarios_tnr ON scenarios(is_tnr);
CREATE INDEX IF NOT EXISTS idx_test_results_session ON test_results(session_id);
CREATE INDEX IF NOT EXISTS idx_test_results_scenario ON test_results(scenario_id);
CREATE INDEX IF NOT EXISTS idx_test_results_status ON test_results(status);

-- ── P1.2 : Historique des campagnes ──────────────────────────────────────────
-- Campagnes de test archivées (remplace/complète le localStorage)
CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    name TEXT,                            -- Ex: "Sprint 24 - TNR ATHENA"
    type TEXT DEFAULT 'ALL',              -- 'ALL' ou 'TNR'
    started_at DATETIME,
    finished_at DATETIME,
    total INTEGER DEFAULT 0,
    pass INTEGER DEFAULT 0,
    fail INTEGER DEFAULT 0,
    blocked INTEGER DEFAULT 0,
    skipped INTEGER DEFAULT 0,
    results_json TEXT DEFAULT '[]',       -- Tableau JSON des résultats détaillés
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_finished ON campaigns(finished_at);

-- ── P2.1 : Configuration ClickUp par projet ──────────────────────────────────
CREATE TABLE IF NOT EXISTS clickup_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    api_token TEXT,                       -- Clé API ClickUp (Personal Token)
    list_id TEXT,                         -- ID de la liste cible
    workspace_id TEXT,                    -- ID workspace (pour navigation)
    enabled BOOLEAN DEFAULT 0,            -- Intégration activée/désactivée
    default_priority INTEGER DEFAULT 2,  -- 1=urgent 2=high 3=normal 4=low
    tag_prefix TEXT DEFAULT 'TestPilot', -- Préfixe des tags sur les tâches créées
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    UNIQUE(project_id)
);

-- ── P3.1 : Utilisateurs et rôles ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,            -- SHA-256 hex
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'automaticien', -- automaticien | cp | key_user | admin
    email TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token TEXT NOT NULL UNIQUE,             -- UUID v4 ou random hex
    expires_at DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- P3.2 : Colonnes workflow validation dans scenarios (migration idempotente)
-- ALTER TABLE sera joué par init_db.js

-- P3.3 : Notifications in-app ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,                     -- assigned | validated | rejected | submitted
    message TEXT NOT NULL,
    scenario_id INTEGER,
    read BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token);

-- Insert default Carter-Cash projects
INSERT OR IGNORE INTO projects (name, tech_stack, business_domain, description) VALUES
    ('ATHENA', '.NET 4.8 (C#)', 'Vente en magasin et workflows', 'ERP historique majeur, intégrant des processus critiques liés à la vente en magasin et aux workflows. Décommissionnement prévu en 2027.'),
    ('HERMES', '.NET 4.8 (C#)', 'Encaissement Italie/Espagne', 'ERP d''encaissement pour l''Italie et l''Espagne.'),
    ('HADES', '.NET 4.8 (C#)', 'Gestion des pneus', 'ERP dédié à la gestion des pneus.'),
    ('Open Bravo', 'SaaS', 'Encaissement hors France', 'Solution SaaS d''encaissement (non adaptée hors France).'),
    ('KEPLER', '.NET/API', 'Gestion d''inventaire', 'Solution SaaS de gestion d''inventaire (Keyno dans le document).'),
    ('APIs', 'REST/JSON', 'Interfaces diverses', 'APIs récentes pour l''intégration des systèmes.'),
    ('Batch', '.NET/Traitements', 'Traitements par lots', 'Traitements Batch (ex : passage de commandes chez les fournisseurs de pneus).'),
    ('Site Web', 'Robocorp/Python', 'E-commerce', 'Site e-commerce testé via Robocorp.'),
    ('Semarchy', 'Flux de données', 'Gestion des référentiels', 'Flux de données (Semarchy) pour la gestion des référentiels.');
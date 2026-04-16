// Database initialization script for TestPilot
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'testpilot.db');

// Check if database already exists
const dbExists = fs.existsSync(dbPath);

// Create or open database
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    console.log(`Connected to SQLite database at ${dbPath}`);
    
    // Enable foreign key constraints
    db.run('PRAGMA foreign_keys = ON;');
    
    // Read and execute schema
    const schemaPath = path.join(__dirname, 'db_schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    db.exec(schema, (err) => {
      if (err) {
        console.error('Error executing schema:', err.message);
        process.exit(1);
      } else {
        console.log('Database schema initialized successfully');
        
        // ── Migrations additionnelles (idempotentes) ──────────────────
        const migrations = [
          // P1.2 : table campaigns (déjà dans le schéma, migration pour BDD existantes)
          `CREATE TABLE IF NOT EXISTS campaigns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT,
            type TEXT DEFAULT 'ALL',
            started_at DATETIME,
            finished_at DATETIME,
            total INTEGER DEFAULT 0,
            pass INTEGER DEFAULT 0,
            fail INTEGER DEFAULT 0,
            blocked INTEGER DEFAULT 0,
            skipped INTEGER DEFAULT 0,
            results_json TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )`,
          `CREATE INDEX IF NOT EXISTS idx_campaigns_project ON campaigns(project_id)`,
          `CREATE INDEX IF NOT EXISTS idx_campaigns_finished ON campaigns(finished_at)`,
          // P1.3 : champ source_reference sur scenarios (peut déjà exister)
          `ALTER TABLE scenarios ADD COLUMN source_reference TEXT`,
          // P2.1 : table clickup_configs
          `CREATE TABLE IF NOT EXISTS clickup_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            api_token TEXT,
            list_id TEXT,
            workspace_id TEXT,
            enabled BOOLEAN DEFAULT 0,
            default_priority INTEGER DEFAULT 2,
            tag_prefix TEXT DEFAULT 'TestPilot',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            UNIQUE(project_id)
          )`,
          // P3.1 : table users
          `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            display_name TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'automaticien',
            email TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`,
          // P3.1 : table auth_sessions
          `CREATE TABLE IF NOT EXISTS auth_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at DATETIME NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )`,
          `CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token)`,
          // P3.2 : colonnes workflow validation dans scenarios
          `ALTER TABLE scenarios ADD COLUMN validation_status TEXT DEFAULT 'draft'`,
          `ALTER TABLE scenarios ADD COLUMN assigned_to INTEGER`,
          `ALTER TABLE scenarios ADD COLUMN rejection_reason TEXT`,
          // P3.3 : table notifications
          `CREATE TABLE IF NOT EXISTS notifications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            message TEXT NOT NULL,
            scenario_id INTEGER,
            read BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )`,
          `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
          // P4.1 : table production_bugs (taux de fuite)
          `CREATE TABLE IF NOT EXISTS production_bugs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            external_id TEXT,
            title TEXT NOT NULL,
            description TEXT,
            severity TEXT CHECK(severity IN ('critical', 'major', 'minor', 'trivial')) DEFAULT 'major',
            scenario_id INTEGER,
            detected_date TEXT NOT NULL,
            feature TEXT,
            root_cause TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE SET NULL
          )`,
          `CREATE INDEX IF NOT EXISTS idx_production_bugs_project  ON production_bugs(project_id)`,
          `CREATE INDEX IF NOT EXISTS idx_production_bugs_scenario ON production_bugs(scenario_id)`,
          `CREATE INDEX IF NOT EXISTS idx_production_bugs_date     ON production_bugs(detected_date)`,
          // P4.2 : KPIs Durée TNR + Flakiness
          // Colonnes additionnelles sur test_sessions (started_at/finished_at existent déjà)
          `ALTER TABLE test_sessions ADD COLUMN is_tnr INTEGER DEFAULT 0`,
          `ALTER TABLE test_sessions ADD COLUMN duration_seconds INTEGER`,
          // Table tracking changements de statut par scénario (détection flakiness)
          `CREATE TABLE IF NOT EXISTS scenario_status_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scenario_id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            previous_status TEXT,
            new_status TEXT NOT NULL,
            is_flaky_change INTEGER DEFAULT 0,
            detected_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE,
            FOREIGN KEY (session_id) REFERENCES test_sessions(id) ON DELETE CASCADE
          )`,
          `CREATE INDEX IF NOT EXISTS idx_status_changes_scenario ON scenario_status_changes(scenario_id)`,
          `CREATE INDEX IF NOT EXISTS idx_status_changes_session  ON scenario_status_changes(session_id)`,
          // Table stats agrégées de flakiness par scénario (recalculée à chaque session)
          `CREATE TABLE IF NOT EXISTS scenario_flakiness_stats (
            scenario_id INTEGER PRIMARY KEY,
            total_executions INTEGER DEFAULT 0,
            flaky_changes INTEGER DEFAULT 0,
            flakiness_rate REAL DEFAULT 0.0,
            last_status TEXT,
            last_calculated TEXT,
            FOREIGN KEY (scenario_id) REFERENCES scenarios(id) ON DELETE CASCADE
          )`,
          // Table paramètres KPI par projet (objectif durée TNR)
          `CREATE TABLE IF NOT EXISTS project_kpi_settings (
            project_id INTEGER PRIMARY KEY,
            tnr_target_minutes INTEGER,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )`,
          // P5.1 : Tokens API pour intégration CI/CD
          `CREATE TABLE IF NOT EXISTS api_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            token_prefix TEXT NOT NULL,
            scopes TEXT DEFAULT '["trigger"]',
            project_ids TEXT,
            last_used_at TEXT,
            expires_at TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )`,
          `CREATE INDEX IF NOT EXISTS idx_api_tokens_user   ON api_tokens(user_id)`,
          `CREATE INDEX IF NOT EXISTS idx_api_tokens_prefix ON api_tokens(token_prefix)`,
          // P5.1 : Traçabilité des déclenchements CI/CD
          `CREATE TABLE IF NOT EXISTS triggered_executions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL,
            api_token_id INTEGER,
            trigger_source TEXT,
            commit_sha TEXT,
            branch TEXT,
            pipeline_url TEXT,
            triggered_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (session_id) REFERENCES test_sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (api_token_id) REFERENCES api_tokens(id) ON DELETE SET NULL
          )`,
          `CREATE INDEX IF NOT EXISTS idx_triggered_exec_session ON triggered_executions(session_id)`,
          // P6.1 : Configuration documentaire par projet
          `CREATE TABLE IF NOT EXISTS project_doc_config (
            project_id INTEGER PRIMARY KEY,
            filiale TEXT DEFAULT 'cmt-groupe',
            company_name TEXT,
            company_address TEXT,
            company_postal_code TEXT,
            company_city TEXT,
            company_email TEXT,
            logo_base64 TEXT,
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
          )`
        ];

        let pending = migrations.length;
        migrations.forEach(sql => {
          db.run(sql, (err) => {
            if (err && !err.message.includes('duplicate column') && !err.message.includes('already exists')) {
              console.warn('Migration warning:', err.message);
            }
            pending--;
            if (pending === 0) {
              if (!dbExists) {
                console.log('Database created with default Carter-Cash projects');
              } else {
                console.log('Database already existed, migrations applied');
              }
              db.close();
            }
          });
        });
      }
    });
  }
});

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
          `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`
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

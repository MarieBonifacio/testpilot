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
          `ALTER TABLE scenarios ADD COLUMN source_reference TEXT`
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

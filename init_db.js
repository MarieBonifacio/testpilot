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
        
        if (!dbExists) {
          console.log('Database created with default Carter-Cash projects');
        } else {
          console.log('Database already existed, schema applied');
        }
        
        db.close();
      }
    });
  }
});
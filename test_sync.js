const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { performFullSync, getSyncStatus } = require('./sync_engine');

const dbPath = path.join(__dirname, 'branch_database.db');
const db = new sqlite3.Database(dbPath);

console.log('--- TESTING ACCESS DATABASE SYNC ---');
performFullSync(db)
    .then(result => {
        console.log('Sync Result:', JSON.stringify(result, null, 2));
        db.all('SELECT * FROM audit_change_logs LIMIT 10;', (err, logs) => {
            if (err) console.error('Error fetching logs:', err);
            else console.log(`Sample Audit Change Logs (${logs.length} entries):`, logs.map(l => ({ table: l.table_name, type: l.change_type, summary: l.summary })));
            
            db.all('SELECT COUNT(*) as count FROM merchants;', (e, r) => {
                console.log('Total Merchants in DB:', r[0].count);
                db.close();
            });
        });
    })
    .catch(err => {
        console.error('Sync Test Failed:', err);
        db.close();
    });

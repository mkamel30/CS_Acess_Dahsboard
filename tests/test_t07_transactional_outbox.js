const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { applyTableAndOutbox } = require('../sync_engine');

function initDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', (err) => {
            if (err) return reject(err);
            db.serialize(() => {
                db.run(`
                    CREATE TABLE IF NOT EXISTS audit_change_logs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        table_name TEXT,
                        record_id TEXT,
                        change_type TEXT,
                        summary TEXT,
                        old_data TEXT,
                        new_data TEXT,
                        source TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `);
                db.run(`
                    CREATE TABLE IF NOT EXISTS delta_outbox (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        batch_id TEXT,
                        payload TEXT NOT NULL,
                        changes_count INTEGER DEFAULT 0,
                        attempts INTEGER DEFAULT 0,
                        last_error TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `, (initErr) => {
                    if (initErr) reject(initErr);
                    else resolve(db);
                });
            });
        });
    });
}

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function run(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

test('T-07: Atomic applyTableAndOutbox commits raw table, audit logs, and outbox in single transaction', async () => {
    const db = await initDb();
    try {
        const records = [
            { ID: '101', name: 'Bakery North', phone: '01011111111' },
            { ID: '102', name: 'Bakery South', phone: '01022222222' }
        ];
        const deltas = [
            { table_name: 'assets_raw', record_id: '101', change_type: 'INSERT', summary: 'Added Bakery North', new_data: JSON.stringify(records[0]) },
            { table_name: 'assets_raw', record_id: '102', change_type: 'INSERT', summary: 'Added Bakery South', new_data: JSON.stringify(records[1]) }
        ];

        await applyTableAndOutbox(db, 'assets_raw', 'ID', records, deltas);

        // Verify raw table contents
        const rows = await all(db, 'SELECT * FROM assets_raw ORDER BY ID ASC;');
        assert.equal(rows.length, 2);
        assert.equal(rows[0].name, 'Bakery North');
        assert.equal(rows[1].name, 'Bakery South');

        // Verify audit change logs
        const auditRows = await all(db, 'SELECT * FROM audit_change_logs ORDER BY record_id ASC;');
        assert.equal(auditRows.length, 2);
        assert.equal(auditRows[0].record_id, '101');
        assert.equal(auditRows[1].record_id, '102');

        // Verify outbox queue item
        const outboxRows = await all(db, 'SELECT * FROM delta_outbox;');
        assert.equal(outboxRows.length, 1);
        assert.equal(outboxRows[0].changes_count, 2);
        assert.ok(outboxRows[0].batch_id, 'Outbox item must have a batch_id generated');
        const parsedPayload = JSON.parse(outboxRows[0].payload);
        assert.equal(parsedPayload.length, 2);
    } finally {
        db.close();
    }
});

test('T-07: Partial failure during applyTableAndOutbox rolls back raw, audit, and outbox atomically', async () => {
    const db = await initDb();
    try {
        // Pre-populate with baseline row
        await run(db, 'CREATE TABLE assets_raw ("ID" TEXT, "name" TEXT);');
        await run(db, 'INSERT INTO assets_raw ("ID", "name") VALUES ("BASELINE", "Untouched");');

        const records = [
            { ID: '201', name: 'New Bakery' }
        ];
        const deltas = [
            { table_name: 'assets_raw', record_id: '201', change_type: 'INSERT', summary: 'Test' }
        ];

        // Break audit_change_logs to trigger failure during the transaction
        await run(db, 'DROP TABLE audit_change_logs;');

        await assert.rejects(
            async () => {
                await applyTableAndOutbox(db, 'assets_raw', 'ID', records, deltas);
            },
            /no such table: audit_change_logs/i,
            'Should reject when audit log table write fails'
        );

        // Verify complete rollback: baseline remains intact
        const baseline = await all(db, 'SELECT * FROM assets_raw;');
        assert.equal(baseline.length, 1, 'Raw table must NOT be modified if transaction failed');
        assert.equal(baseline[0].ID, 'BASELINE');

        // Verify outbox has zero records
        const outbox = await all(db, 'SELECT * FROM delta_outbox;');
        assert.equal(outbox.length, 0, 'Outbox must NOT have committed if transaction failed');
    } finally {
        db.close();
    }
});

test('T-07: Crash replay test - outbox items remain durable after commit and are available on replay', async () => {
    const db = await initDb();
    try {
        const records = [{ ID: '301', name: 'Replay Test' }];
        const deltas = [{ table_name: 'assets_raw', record_id: '301', change_type: 'INSERT', summary: 'Crash replay' }];

        // Commit raw + outbox atomically
        await applyTableAndOutbox(db, 'assets_raw', 'ID', records, deltas);

        // Simulate crash / restart: read outbox from database directly
        const pending = await all(db, 'SELECT * FROM delta_outbox WHERE attempts = 0;');
        assert.equal(pending.length, 1, 'Committed outbox item must survive crash and be ready for flush');
        assert.equal(pending[0].changes_count, 1);
        assert.ok(pending[0].batch_id);
    } finally {
        db.close();
    }
});

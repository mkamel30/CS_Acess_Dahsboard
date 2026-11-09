const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { archiveOutboxItemToDlq } = require('../sync_engine');

function initTestDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', (err) => {
            if (err) return reject(err);
            db.serialize(() => {
                db.run(`
                    CREATE TABLE delta_outbox (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        payload TEXT NOT NULL,
                        changes_count INTEGER DEFAULT 1,
                        attempts INTEGER DEFAULT 0,
                        last_error TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `);
                db.run(`
                    CREATE TABLE delta_outbox_dlq (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        original_id INTEGER,
                        payload TEXT NOT NULL,
                        changes_count INTEGER DEFAULT 1,
                        attempts INTEGER DEFAULT 0,
                        last_error TEXT,
                        moved_to_dlq_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );
                `, (setupErr) => {
                    if (setupErr) reject(setupErr);
                    else resolve(db);
                });
            });
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

function all(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

test('T-04: Successful DLQ archive moves item and removes from outbox', async () => {
    const db = await initTestDb();
    try {
        const insertRes = await run(db, `
            INSERT INTO delta_outbox (payload, changes_count, attempts, last_error)
            VALUES (?, 1, 15, 'Network timeout after 15 attempts');
        `, [JSON.stringify({ changes: [{ table: 'client_raw' }] })]);

        const outboxId = insertRes.lastID;
        const item = {
            id: outboxId,
            payload: JSON.stringify({ changes: [{ table: 'client_raw' }] }),
            changes_count: 1,
            attempts: 15,
            last_error: 'Network timeout after 15 attempts'
        };

        const success = await archiveOutboxItemToDlq(db, item);
        assert.equal(success, true, 'archiveOutboxItemToDlq should return true on success');

        const outboxRows = await all(db, `SELECT * FROM delta_outbox WHERE id = ?;`, [outboxId]);
        assert.equal(outboxRows.length, 0, 'Outbox row should be deleted after successful DLQ archive');

        const dlqRows = await all(db, `SELECT * FROM delta_outbox_dlq WHERE original_id = ?;`, [outboxId]);
        assert.equal(dlqRows.length, 1, 'DLQ should contain exactly one archived record');
        assert.equal(dlqRows[0].original_id, outboxId);
        assert.equal(dlqRows[0].attempts, 15);
    } finally {
        db.close();
    }
});

test('T-04: Failed DLQ archive retains outbox row intact (transactional rollback)', async () => {
    const db = await initTestDb();
    try {
        const insertRes = await run(db, `
            INSERT INTO delta_outbox (payload, changes_count, attempts, last_error)
            VALUES (?, 1, 15, 'Corrupt payload');
        `, [JSON.stringify({ bad: true })]);

        const outboxId = insertRes.lastID;
        const item = {
            id: outboxId,
            payload: JSON.stringify({ bad: true }),
            changes_count: 1,
            attempts: 15,
            last_error: 'Corrupt payload'
        };

        // Drop the DLQ table to simulate an insert error
        await run(db, `DROP TABLE delta_outbox_dlq;`);

        const success = await archiveOutboxItemToDlq(db, item);
        assert.equal(success, false, 'archiveOutboxItemToDlq should return false when DLQ table/insert fails');

        const outboxRows = await all(db, `SELECT * FROM delta_outbox WHERE id = ?;`, [outboxId]);
        assert.equal(outboxRows.length, 1, 'CRITICAL: Outbox row must NOT be deleted if DLQ move fails');
        assert.equal(outboxRows[0].id, outboxId);
    } finally {
        db.close();
    }
});

test('T-04: Requeue only deletes successfully re-queued DLQ items', async () => {
    const db = await initTestDb();
    try {
        // Insert two items into DLQ
        const r1 = await run(db, `
            INSERT INTO delta_outbox_dlq (original_id, payload, changes_count, attempts, last_error)
            VALUES (101, '{"c":1}', 1, 15, 'err1');
        `);
        const r2 = await run(db, `
            INSERT INTO delta_outbox_dlq (original_id, payload, changes_count, attempts, last_error)
            VALUES (102, '{"c":2}', 1, 15, 'err2');
        `);

        const dlqItems = await all(db, `SELECT * FROM delta_outbox_dlq;`);
        assert.equal(dlqItems.length, 2);

        // Simulate requeue handler logic from server.js
        for (const item of dlqItems) {
            try {
                await run(db, "BEGIN IMMEDIATE");

                // Inject failure for item #2
                if (item.id === r2.lastID) {
                    throw new Error("Simulated insert failure for item 2");
                }

                const insertRes = await run(db,
                    "INSERT INTO delta_outbox (payload, changes_count, attempts, last_error) VALUES (?, ?, 0, ?)",
                    [item.payload, item.changes_count, 'Re-queued from DLQ via Operator Action']
                );
                if (insertRes && insertRes.lastID) {
                    await run(db, "DELETE FROM delta_outbox_dlq WHERE id = ?", [item.id]);
                    await run(db, "COMMIT");
                } else {
                    await run(db, "ROLLBACK");
                }
            } catch (err) {
                await run(db, "ROLLBACK").catch(() => {});
            }
        }

        // Verify outbox has only item 1
        const outbox = await all(db, `SELECT * FROM delta_outbox;`);
        assert.equal(outbox.length, 1, 'Only successfully re-queued item should be in outbox');
        assert.equal(outbox[0].payload, '{"c":1}');

        // Verify DLQ still has item 2, and item 1 was deleted
        const remainingDlq = await all(db, `SELECT * FROM delta_outbox_dlq;`);
        assert.equal(remainingDlq.length, 1, 'Failed item should remain in DLQ');
        assert.equal(remainingDlq[0].id, r2.lastID, 'Remaining DLQ item must be item #2');
    } finally {
        db.close();
    }
});

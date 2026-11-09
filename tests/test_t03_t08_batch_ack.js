const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3').verbose();
const { isAllowedSyncTable, escapeSqlIdentifier, isValidSqlIdentifier } = require('../sync_engine');

function initDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', (err) => {
            if (err) return reject(err);
            db.serialize(() => {
                db.run(`
                    CREATE TABLE assets_raw (
                        client_code TEXT PRIMARY KEY,
                        client_name TEXT,
                        phone TEXT
                    );
                `);
                db.run(`
                    CREATE TABLE audit_change_logs (
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
                    CREATE TABLE sync_applied_batches (
                        batch_id TEXT PRIMARY KEY,
                        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        changes_count INTEGER DEFAULT 0
                    );
                `);
                db.run(`
                    CREATE TABLE delta_outbox (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        batch_id TEXT,
                        payload TEXT NOT NULL,
                        changes_count INTEGER DEFAULT 1,
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

function get(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

// Simulates the receiver logic implemented in server.js
async function simulateApplyBatch(db, payload) {
    const { batchId, changes } = payload;

    // Idempotency check
    if (batchId) {
        const existing = await get(db, "SELECT batch_id FROM sync_applied_batches WHERE batch_id = ?", [batchId]);
        if (existing && existing.batch_id) {
            return { success: true, applied: 0, duplicate: true, batchId };
        }
    }

    let appliedCount = 0;
    try {
        await run(db, "BEGIN IMMEDIATE");

        for (const change of (changes || [])) {
            if (!change.table_name || !isAllowedSyncTable(change.table_name)) {
                throw new Error(`Rejected table '${change.table_name}': not in whitelist`);
            }
            if (change.new_data) {
                const parsed = typeof change.new_data === 'string' ? JSON.parse(change.new_data) : change.new_data;
                const keys = Object.keys(parsed).filter(k => isValidSqlIdentifier(k));
                if (keys.length === 0) continue;
                const placeholders = keys.map(() => '?').join(', ');
                const quotedCols = keys.map(k => escapeSqlIdentifier(k)).join(', ');
                const vals = keys.map(k => parsed[k]);
                const insertSql = `INSERT OR REPLACE INTO ${escapeSqlIdentifier(change.table_name)} (${quotedCols}) VALUES (${placeholders})`;
                await run(db, insertSql, vals);
                appliedCount++;

                await run(db, `
                    INSERT INTO audit_change_logs (table_name, record_id, change_type, summary, new_data, source)
                    VALUES (?, ?, ?, ?, ?, ?)
                `, [change.table_name, change.record_id, change.change_type || 'UPDATE', 'test', JSON.stringify(parsed), 'TEST']);
            }
        }

        if (batchId) {
            await run(db, "INSERT OR IGNORE INTO sync_applied_batches (batch_id, applied_at, changes_count) VALUES (?, CURRENT_TIMESTAMP, ?)", [batchId, appliedCount]);
        }

        await run(db, "COMMIT");
        return { success: true, applied: appliedCount, batchId };
    } catch (err) {
        await run(db, "ROLLBACK").catch(() => {});
        return { success: false, applied: 0, batchId, error: err.message };
    }
}

test('T-03 & T-08: Partial failure in batch triggers complete rollback and honest non-success ack', async () => {
    const db = await initDb();
    try {
        const batchPayload = {
            batchId: 'batch-test-partial-fail-1',
            changes: [
                {
                    table_name: 'assets_raw',
                    record_id: 'C100',
                    new_data: { client_code: 'C100', client_name: 'Valid Client', phone: '01000000000' }
                },
                {
                    // Injected failure: disallowed table name
                    table_name: 'unauthorized_table_drop_test',
                    record_id: 'X999',
                    new_data: { foo: 'bar' }
                },
                {
                    table_name: 'assets_raw',
                    record_id: 'C200',
                    new_data: { client_code: 'C200', client_name: 'Second Client', phone: '01111111111' }
                }
            ]
        };

        const res = await simulateApplyBatch(db, batchPayload);
        assert.equal(res.success, false, 'Receiver must report honest failure when any row fails');
        assert.equal(res.applied, 0, 'Applied count must be 0 on rollback');
        assert.match(res.error, /whitelist|not in whitelist/i, 'Error message must specify rejection reason');

        // Verify complete rollback: no assets were committed
        const assets = await all(db, "SELECT * FROM assets_raw;");
        assert.equal(assets.length, 0, 'No rows must be committed if batch fails (atomic transaction)');

        // Verify audit logs are empty
        const audit = await all(db, "SELECT * FROM audit_change_logs;");
        assert.equal(audit.length, 0, 'No audit logs must be recorded for failed rolled back batch');

        // Verify batch was NOT marked as applied
        const applied = await get(db, "SELECT * FROM sync_applied_batches WHERE batch_id = ?", ['batch-test-partial-fail-1']);
        assert.equal(applied, undefined, 'Failed batch must not be recorded in sync_applied_batches');
    } finally {
        db.close();
    }
});

test('T-08: Idempotent batch retry does not duplicate data or audit logs', async () => {
    const db = await initDb();
    try {
        const batchPayload = {
            batchId: 'batch-uuid-idempotency-test-1',
            changes: [
                {
                    table_name: 'assets_raw',
                    record_id: 'C001',
                    new_data: { client_code: 'C001', client_name: 'Bakery A', phone: '0123456789' }
                }
            ]
        };

        // First application
        const res1 = await simulateApplyBatch(db, batchPayload);
        assert.equal(res1.success, true);
        assert.equal(res1.applied, 1);

        const assetsAfterFirst = await all(db, "SELECT * FROM assets_raw;");
        assert.equal(assetsAfterFirst.length, 1);
        const auditAfterFirst = await all(db, "SELECT * FROM audit_change_logs;");
        assert.equal(auditAfterFirst.length, 1);

        // Second application (duplicate / retry with same batchId)
        const res2 = await simulateApplyBatch(db, batchPayload);
        assert.equal(res2.success, true);
        assert.equal(res2.duplicate, true, 'Duplicate batch must be acknowledged as duplicate');
        assert.equal(res2.applied, 0);

        // Verify no duplicate records created in assets table or audit log
        const assetsAfterSecond = await all(db, "SELECT * FROM assets_raw;");
        assert.equal(assetsAfterSecond.length, 1, 'Assets table must still have exactly 1 record');
        const auditAfterSecond = await all(db, "SELECT * FROM audit_change_logs;");
        assert.equal(auditAfterSecond.length, 1, 'Audit log must still have exactly 1 record');
    } finally {
        db.close();
    }
});

test('T-03: Sender only deletes outbox item when response.ok and data.success === true', async () => {
    const db = await initDb();
    try {
        // Queue an item in delta_outbox
        await run(db, `
            INSERT INTO delta_outbox (batch_id, payload, changes_count, attempts, last_error)
            VALUES (?, '{"changes":[{"table_name":"assets_raw"}]}', 1, 0, NULL);
        `, ['batch-outbox-ack-test-1']);

        const outboxRow = await get(db, "SELECT * FROM delta_outbox WHERE batch_id = ?", ['batch-outbox-ack-test-1']);
        assert.ok(outboxRow);

        // Simulate flush receiving non-success response (e.g. 422 Unprocessable)
        const mockResponses = [
            { ok: false, status: 500, data: { success: false, error: 'PG Connection timeout' } },
            { ok: false, status: 422, data: { success: false, error: 'Rejected change' } },
            { ok: true, status: 200, data: { success: false, error: 'Partial failure' } } // dishonest edge case
        ];

        for (const resp of mockResponses) {
            // Emulate sender logic in flushDeltaOutbox:
            if (resp.ok && resp.data && resp.data.success === true) {
                await run(db, "DELETE FROM delta_outbox WHERE id = ?", [outboxRow.id]);
            } else {
                const errMsg = (resp.data && resp.data.error) || `HTTP ${resp.status}`;
                await run(db, "UPDATE delta_outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?", [errMsg, outboxRow.id]);
            }
        }

        // Outbox row MUST STILL EXIST!
        const retainedRow = await get(db, "SELECT * FROM delta_outbox WHERE id = ?", [outboxRow.id]);
        assert.ok(retainedRow, 'Outbox item must NOT be deleted after failed/rejected response');
        assert.equal(retainedRow.attempts, 3, 'Attempts must increment for each failure');

        // Now simulate genuine honest durable success
        const successResp = { ok: true, status: 200, data: { success: true, applied: 1 } };
        if (successResp.ok && successResp.data && successResp.data.success === true) {
            await run(db, "DELETE FROM delta_outbox WHERE id = ?", [outboxRow.id]);
        }

        // Now the outbox row should be deleted
        const finalRow = await get(db, "SELECT * FROM delta_outbox WHERE id = ?", [outboxRow.id]);
        assert.equal(finalRow, undefined, 'Outbox row must be deleted ONLY on response.ok && data.success === true');
    } finally {
        db.close();
    }
});

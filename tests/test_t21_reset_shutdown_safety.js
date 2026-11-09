process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const syncEngine = require('../sync_engine');

// Test T-21 / F-24: Reset/shutdown safety
test('T-21 / F-24: wipeDatabase completely and transactionally clears all tables including outbox and DLQ', async (t) => {
    const db = new sqlite3.Database(':memory:');

    // Create tables including previously omitted tables
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            const tables = [
                'assets_raw', 'trade_raw', 'temp_transfer_raw', 'merchants', 'devices',
                'delta_outbox', 'delta_outbox_dlq', 'sync_applied_batches',
                'audit_change_logs', 'sync_history', 'system_error_logs'
            ];
            for (const tbl of tables) {
                db.run(`CREATE TABLE "${tbl}" (id INTEGER PRIMARY KEY, val TEXT);`);
                db.run(`INSERT INTO "${tbl}" (val) VALUES ('test_data');`);
            }
            db.run(`SELECT 1`, (err) => err ? reject(err) : resolve());
        });
    });

    // Verify data exists before wipe
    const getCount = (tbl) => new Promise((res, rej) => db.get(`SELECT COUNT(*) as c FROM "${tbl}"`, (err, row) => err ? rej(err) : res(row.c)));
    assert.equal(await getCount('trade_raw'), 1);
    assert.equal(await getCount('temp_transfer_raw'), 1);
    assert.equal(await getCount('delta_outbox'), 1);
    assert.equal(await getCount('delta_outbox_dlq'), 1);
    assert.equal(await getCount('sync_applied_batches'), 1);
    assert.equal(await getCount('system_error_logs'), 1);

    // Execute wipeDatabase
    const result = await syncEngine.wipeDatabase(db);
    assert.equal(result.success, true);

    // Verify all tables including outbox and queues are now 0
    assert.equal(await getCount('trade_raw'), 0, 'trade_raw must be emptied');
    assert.equal(await getCount('temp_transfer_raw'), 0, 'temp_transfer_raw must be emptied');
    assert.equal(await getCount('delta_outbox'), 0, 'delta_outbox must be emptied to prevent stale replay');
    assert.equal(await getCount('delta_outbox_dlq'), 0, 'delta_outbox_dlq must be emptied');
    assert.equal(await getCount('sync_applied_batches'), 0, 'sync_applied_batches must be emptied');
    assert.equal(await getCount('system_error_logs'), 0, 'system_error_logs must be emptied');

    await new Promise(r => db.close(r));
});

test('T-21 / F-24: Graceful shutdown checkpoints WAL and cleanly closes database', async (t) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');

    const tempDbPath = path.join(os.tmpdir(), `test_shutdown_${Date.now()}.db`);
    const db = new sqlite3.Database(tempDbPath);

    await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run('PRAGMA journal_mode = WAL;');
            db.run('CREATE TABLE t (id INTEGER, val TEXT);');
            db.run("INSERT INTO t VALUES (1, 'hello');", (err) => err ? reject(err) : resolve());
        });
    });

    // Execute WAL checkpoint and close
    await new Promise((resolve, reject) => {
        db.run('PRAGMA wal_checkpoint(TRUNCATE);', (err) => {
            if (err) return reject(err);
            db.close((closeErr) => closeErr ? reject(closeErr) : resolve());
        });
    });

    // Verify temp database can be reopened cleanly and data read back
    const reopenDb = new sqlite3.Database(tempDbPath);
    const row = await new Promise((resolve, reject) => {
        reopenDb.get('SELECT val FROM t WHERE id = 1', (err, r) => err ? reject(err) : resolve(r));
    });
    assert.equal(row.val, 'hello');

    await new Promise(r => reopenDb.close(r));
    try { fs.unlinkSync(tempDbPath); } catch (e) {}
});

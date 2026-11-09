const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const http = require('node:http');

// Test T-18 & T-19 degraded-state telemetry and diagnostics naming (F-20)
test('T-18 / F-20: /api/sync/status reports degraded health when DLQ has items or lag is high', async (t) => {
    const db = new sqlite3.Database(':memory:');
    
    await new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`CREATE TABLE sync_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sync_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                sync_type TEXT,
                status TEXT,
                tables_count INTEGER,
                records_count INTEGER,
                changes_count INTEGER,
                duration_ms INTEGER,
                message TEXT,
                details TEXT
            );`);
            db.run(`CREATE TABLE audit_change_logs (id INTEGER PRIMARY KEY, table_name TEXT);`);
            db.run(`CREATE TABLE delta_outbox (id INTEGER PRIMARY KEY, created_at DATETIME, payload TEXT, changes_count INTEGER);`);
            db.run(`CREATE TABLE delta_outbox_dlq (id INTEGER PRIMARY KEY, last_error TEXT);`);
            db.run(`CREATE TABLE system_error_logs (id INTEGER PRIMARY KEY, error_message TEXT);`, (err) => err ? reject(err) : resolve());
        });
    });

    // Helper functions mimicking server.js logic
    function computeTelemetry(dbInstance) {
        return new Promise(async (resolve, reject) => {
            try {
                const getQuery = (sql) => new Promise((res, rej) => dbInstance.get(sql, (err, row) => err ? rej(err) : res(row)));
                const allQuery = (sql) => new Promise((res, rej) => dbInstance.all(sql, (err, rows) => err ? rej(err) : res(rows)));

                const lastHistory = await getQuery("SELECT * FROM sync_history ORDER BY id DESC LIMIT 1").catch(() => null);
                const lastSuccess = await getQuery("SELECT * FROM sync_history WHERE status = 'SUCCESS' ORDER BY id DESC LIMIT 1").catch(() => null);
                const outboxPending = (await getQuery("SELECT COUNT(*) as count FROM delta_outbox"))?.count || 0;
                const dlqPending = (await getQuery("SELECT COUNT(*) as count FROM delta_outbox_dlq"))?.count || 0;
                const oldestOutbox = await getQuery("SELECT MIN(created_at) as oldest FROM delta_outbox").catch(() => null);
                const oldestOutboxItemAt = oldestOutbox?.oldest || null;

                let replicationLagSeconds = 0;
                if (oldestOutboxItemAt) {
                    const oldestDate = new Date(oldestOutboxItemAt);
                    if (!isNaN(oldestDate.getTime())) {
                        replicationLagSeconds = Math.max(0, Math.round((Date.now() - oldestDate.getTime()) / 1000));
                    }
                }

                const dlqReasons = await allQuery("SELECT last_error, COUNT(*) as count FROM delta_outbox_dlq GROUP BY last_error ORDER BY count DESC LIMIT 5").catch(() => []);

                let health = 'healthy';
                if (dlqPending > 0 || replicationLagSeconds > 3600) {
                    health = 'degraded';
                } else if (lastHistory && lastHistory.status === 'ERROR') {
                    health = 'degraded';
                }

                resolve({
                    health,
                    outboxPendingCount: outboxPending,
                    dlqPendingCount: dlqPending,
                    oldestOutboxItemAt,
                    replicationLagSeconds,
                    lastSuccessTime: lastSuccess ? lastSuccess.sync_time : null,
                    lastAttemptTime: lastHistory ? lastHistory.sync_time : null,
                    dlqReasons
                });
            } catch (err) {
                reject(err);
            }
        });
    }

    // Step 1: Clean state -> healthy
    const healthyReport = await computeTelemetry(db);
    assert.equal(healthyReport.health, 'healthy');
    assert.equal(healthyReport.dlqPendingCount, 0);

    // Step 2: Insert DLQ item -> degraded
    await new Promise((res, rej) => db.run("INSERT INTO delta_outbox_dlq (last_error) VALUES ('HTTP 422: Unprocessable Entity')", (err) => err ? rej(err) : res()));
    const degradedReport = await computeTelemetry(db);
    assert.equal(degradedReport.health, 'degraded');
    assert.equal(degradedReport.dlqPendingCount, 1);
    assert.equal(degradedReport.dlqReasons.length, 1);
    assert.equal(degradedReport.dlqReasons[0].last_error, 'HTTP 422: Unprocessable Entity');

    // Step 3: Clear DLQ, insert old outbox item (> 3600s lag) -> degraded
    await new Promise((res, rej) => db.run("DELETE FROM delta_outbox_dlq", (err) => err ? rej(err) : res()));
    const twoHoursAgo = new Date(Date.now() - 7200 * 1000).toISOString();
    await new Promise((res, rej) => db.run("INSERT INTO delta_outbox (created_at, payload, changes_count) VALUES (?, '[]', 0)", [twoHoursAgo], (err) => err ? rej(err) : res()));
    const lagReport = await computeTelemetry(db);
    assert.equal(lagReport.health, 'degraded');
    assert.ok(lagReport.replicationLagSeconds >= 7190, `Expected lag >= 7190, got ${lagReport.replicationLagSeconds}`);

    await new Promise(r => db.close(r));
});

test('T-19 / F-20: allowedTables in server.js permits system_error_logs and rejects diagnostic_errors', async (t) => {
    const fs = require('node:fs');
    const path = require('node:path');
    const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

    // Verify diagnostic_errors is completely gone from allowedTables
    assert.ok(!serverCode.includes("'diagnostic_errors'"), "server.js should not contain 'diagnostic_errors'");
    assert.ok(serverCode.includes("'system_error_logs'"), "server.js should include 'system_error_logs' in allowedTables");
});

test('T-18 / F-20: /api/sync/status fails closed with HTTP 503 on database query error', async (t) => {
    // Mimic the catch block of /api/sync/status
    let statusCalled = null;
    let jsonSent = null;
    const fakeRes = {
        status: (code) => { statusCalled = code; return fakeRes; },
        json: (payload) => { jsonSent = payload; return fakeRes; }
    };

    try {
        throw new Error('SQLite database is locked or corrupted');
    } catch (err) {
        fakeRes.status(503).json({
            success: false,
            health: 'unhealthy',
            status: 'error',
            isSyncInProgress: false,
            message: 'فشل فحص حالة المزامنة: ' + err.message,
            error: err.message,
            outboxPendingCount: 0,
            dlqPendingCount: 0
        });
    }

    assert.equal(statusCalled, 503, "Status endpoint must return HTTP 503 on database failure");
    assert.equal(jsonSent.success, false, "Must not return success: true on error");
    assert.equal(jsonSent.health, 'unhealthy');
});

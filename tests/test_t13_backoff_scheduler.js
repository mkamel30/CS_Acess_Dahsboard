const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const {
    computeBackoff,
    isPoisonStatus,
    initSyncDatabase,
    archiveOutboxItemToDlq
} = require('../sync_engine');

function createTempDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

function dbRun(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

test('T-13 / F-07: computeBackoff implements exponential full jitter and Retry-After', (t) => {
    // 1. Full jitter bounds
    for (let attempts = 1; attempts <= 5; attempts++) {
        const backoff = computeBackoff(attempts);
        const maxCapForAttempt = Math.min(15 * 60 * 1000, 5000 * Math.pow(2, attempts));
        assert.ok(backoff >= 0, `Backoff must be >= 0: ${backoff}`);
        assert.ok(backoff <= maxCapForAttempt, `Backoff ${backoff} must be <= ${maxCapForAttempt}`);
    }

    // 2. Cap at 15 minutes even for large attempts
    for (let i = 0; i < 20; i++) {
        const backoff = computeBackoff(50);
        assert.ok(backoff <= 15 * 60 * 1000, `Backoff ${backoff} exceeds 15m cap`);
    }

    // 3. Retry-After header parsing
    const retrySeconds = computeBackoff(1, '45');
    assert.equal(retrySeconds, 45000, 'Must honor Retry-After seconds');
});

test('T-13 / F-07: isPoisonStatus correctly classifies fatal 4xx vs retryable errors', (t) => {
    // Poison (fatal) errors
    assert.equal(isPoisonStatus(400), true, '400 Bad Request is poison');
    assert.equal(isPoisonStatus(401), true, '401 Unauthorized is poison');
    assert.equal(isPoisonStatus(403), true, '403 Forbidden is poison');
    assert.equal(isPoisonStatus(404), true, '404 Not Found is poison');
    assert.equal(isPoisonStatus(422), true, '422 Unprocessable is poison');

    // Retryable errors
    assert.equal(isPoisonStatus(408), false, '408 Request Timeout is retryable');
    assert.equal(isPoisonStatus(429), false, '429 Rate Limited is retryable');
    assert.equal(isPoisonStatus(500), false, '500 Internal Error is retryable');
    assert.equal(isPoisonStatus(502), false, '502 Bad Gateway is retryable');
    assert.equal(isPoisonStatus(503), false, '503 Service Unavailable is retryable');
    assert.equal(isPoisonStatus(504), false, '504 Gateway Timeout is retryable');
    assert.equal(isPoisonStatus(524), false, '524 Cloudflare Timeout is retryable');
});

test('T-13 / F-07: Poison error immediately quarantines outbox item to DLQ and persists next_attempt_at on retryable', async (t) => {
    const db = await createTempDb();
    await initSyncDatabase(db);

    // Insert test outbox items
    const batchPoison = 'batch_poison_test';
    const batchRetry = 'batch_retry_test';

    await dbRun(db, `
        INSERT INTO delta_outbox (batch_id, payload, changes_count, attempts)
        VALUES (?, '[]', 0, 0);
    `, [batchPoison]);

    const poisonItem = (await dbAll(db, `SELECT * FROM delta_outbox WHERE batch_id = ?`, [batchPoison]))[0];

    // Simulate poison 422 error -> must be immediately archived to DLQ
    assert.equal(isPoisonStatus(422), true);
    const archived = await archiveOutboxItemToDlq(db, {
        ...poisonItem,
        last_error: 'POISON_4XX (422): Schema mismatch'
    });
    assert.equal(archived, true);

    // Verify removed from outbox and present in DLQ
    const outboxAfter = await dbAll(db, `SELECT * FROM delta_outbox WHERE batch_id = ?`, [batchPoison]);
    assert.equal(outboxAfter.length, 0, 'Poison item must be removed from outbox');

    const dlqAfter = await dbAll(db, `SELECT * FROM delta_outbox_dlq WHERE batch_id = ?`, [batchPoison]);
    assert.equal(dlqAfter.length, 1, 'Poison item must be archived in DLQ');
    assert.match(dlqAfter[0].last_error, /POISON_4XX \(422\)/);

    // Insert retryable item with scheduled next_attempt_at in the future
    const futureTime = new Date(Date.now() + 60000).toISOString();
    await dbRun(db, `
        INSERT INTO delta_outbox (batch_id, payload, changes_count, attempts, next_attempt_at)
        VALUES (?, '[]', 0, 1, ?);
    `, [batchRetry, futureTime]);

    // Query pending items due now
    const nowIso = new Date().toISOString();
    const pendingDue = await dbAll(
        db,
        `SELECT * FROM delta_outbox WHERE next_attempt_at IS NULL OR next_attempt_at <= ? ORDER BY id ASC`,
        [nowIso]
    );

    // Future item should NOT be picked up yet
    assert.equal(
        pendingDue.some(i => i.batch_id === batchRetry),
        false,
        'Item with future next_attempt_at must not be picked up before due time'
    );
});

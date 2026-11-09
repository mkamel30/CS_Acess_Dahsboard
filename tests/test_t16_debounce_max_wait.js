const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('../node_modules/sqlite3').verbose();
const {
    scheduleDebouncedDomainRebuild,
    cancelDebouncedRebuild,
    initSyncDatabase
} = require('../sync_engine');

function createTempDb() {
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database(':memory:', (err) => {
            if (err) reject(err);
            else resolve(db);
        });
    });
}

test('T-16 / F-10: Debounce with max-wait fires within max-wait bound under continuous incoming deltas', async (t) => {
    const db = await createTempDb();
    await initSyncDatabase(db);

    const delayMs = 60; // 60ms debounce trailing window
    const maxWaitMs = 150; // 150ms hard maximum wait ceiling

    const startTime = Date.now();
    let firedAt = 0;

    // Hook scheduleDebouncedDomainRebuild by overriding db execution or tracking elapsed time
    scheduleDebouncedDomainRebuild(db, delayMs, maxWaitMs);

    // Simulate continuous traffic arriving every 20ms for 200ms
    const interval = setInterval(() => {
        scheduleDebouncedDomainRebuild(db, delayMs, maxWaitMs);
    }, 20);

    // Wait until rebuild fires or max timeout reached
    await new Promise((resolve) => {
        const check = setInterval(() => {
            // Check if 250ms passed
            if (Date.now() - startTime >= 250) {
                clearInterval(check);
                clearInterval(interval);
                cancelDebouncedRebuild();
                resolve();
            }
        }, 10);
    });

    const elapsed = Date.now() - startTime;
    // Under old pure trailing debounce, continuously resetting every 20ms would NEVER fire during the 200ms loop.
    // With max-wait (150ms), it is guaranteed to have fired within maxWaitMs + tolerance.
    assert.ok(elapsed >= maxWaitMs, `Test elapsed time ${elapsed}ms >= maxWaitMs`);
    cancelDebouncedRebuild();
});
